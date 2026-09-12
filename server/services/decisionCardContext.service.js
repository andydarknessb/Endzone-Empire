const pool = require('../modules/pool');
const { requireMember } = require('./leagueMembership.service');
const { impliedTeamPoints } = require('./vegasOdds.provider');
const { isIndoorGame } = require('./nwsWeather.service');
const { calculateFantasyPoints, rulesForLeague } = require('./scoring.service');
const { normalizeNflTeam } = require('./nflTeam');

/**
 * The Decision card's per-player context (#1236, ADR 0037, ADR 0032):
 * `GET /api/team/lineup/:playerId/context` returns `{ line, weather, usage }`
 * for one rostered player in one league/week, everything the card shows
 * beyond the Ledger row it opened from.
 *
 * Deliberately its own module (pre-launch ruling 4): it reads `nfl_games`,
 * `game_odds_snapshots`, `game_weather_snapshots` and `player_stats` itself
 * and checks roster membership with its own query, so it never touches
 * lineup.service.js or the client roster entity (#1235's files).
 *
 * `line` and `weather` are read off the player's OWN game this week
 * (resolved from his CURRENT `players.nfl_team`, folded through the same
 * `fn_normalize_nfl_team`/`normalizeNflTeam` vocabulary `nfl_games` is keyed
 * by everywhere else in this app). Both are `null` when he has no game this
 * week at all (a bye, or an unsynced slate); `weather` is a fields-null
 * object (never bare `null`) once a game exists, per the ADR.
 *
 * `usage`'s three "last played weeks" are the three most recent (season,
 * week) pairs before the requested week in which his CURRENT team's
 * schedule shows a game — a bye contributes no `nfl_games` row, so it is
 * skipped the same way `bye.service` already treats an absent row as a bye.
 * This is why the target-share denominator (ruling 1) explicitly does NOT
 * use `players.nfl_team`, while this window does: ruling 1 aggregates
 * ACROSS players for a team-week and a traded player's past weeks belong to
 * his old team, but "did HIS team play this week" is a property of the
 * team he is on now that a schedule lookup can answer directly.
 *
 * Target share's denominator (ruling 1) is the sum of every `player_stats`
 * row's `stats.usagePassAttempts` for that season/week whose `stats.gameTeam`
 * (folded) matches the player's own `stats.gameTeam` (folded) that week —
 * never `players.nfl_team`. KNOWN UNDERCOUNT: a passer who has never been
 * synced into the `players` table cannot have a `player_stats` row (the FK
 * requires one), so his attempts are silently absent from the sum; this is
 * inherent to the schema, not a filter this module applies.
 *
 * Fantasy points price every stats row through `calculateFantasyPoints`
 * under `rulesForLeague(league)` — the same pricer `decision.service.js`
 * uses for hindsight and live what-if (#739, ADR 0024) — never the stored
 * default-rules `fantasy_points` column.
 */

class DecisionCardError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// No existing route emitted a coded refusal for "not your roster" (searched
// at 8b56887e); named here per pre-launch ruling 5.
const PLAYER_NOT_ON_ROSTER = 'PLAYER_NOT_ON_ROSTER';

// See vegasOdds.provider.js / projectionFeatures.js: `Number(null)` is 0, so
// a naive finite check would turn a missing usage key into a measured zero.
// Duplicated locally rather than imported, the same deliberate isolation
// those two modules already document.
function isNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function round4(x) {
  return Math.round(Number(x) * 10000) / 10000;
}

/** Pure: the mean of a value list's finite numbers, or null when none are. */
function averageOf(values) {
  const nums = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return round2(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

/**
 * Pure: which side of `impliedTeamPoints`' `{ home, away }` belongs to a game
 * row whose `home_away` names this player's team's orientation. Null for a
 * missing quote or an unrecognized/neutral orientation — never a guess.
 */
function impliedTotalForTeam(quote, homeAway) {
  if (!quote) return null;
  if (homeAway === 'home') return quote.home;
  if (homeAway === 'away') return quote.away;
  return null;
}

/**
 * Pure: one week's usage entry from a `player_stats.stats` object, this
 * league's scoring rules, and the pre-summed team pass attempts for that
 * exact (week, folded gameTeam). `teamPassAttempts` is null when the row
 * carries no `gameTeam` to look one up for.
 */
function usageEntryFromStats(stats, rules, teamPassAttempts) {
  const targets = isNum(stats.usageTargets) ? Number(stats.usageTargets) : null;
  const carries = isNum(stats.usageCarries) ? Number(stats.usageCarries) : null;
  const airYards = isNum(stats.usageAirYards) ? Number(stats.usageAirYards) : null;
  const fantasyPoints = calculateFantasyPoints(stats, rules);
  const targetShare = targets !== null && typeof teamPassAttempts === 'number' && teamPassAttempts > 0
    ? round4(targets / teamPassAttempts)
    : null;
  return { targets, carries, airYards, targetShare, fantasyPoints };
}

/** The newest odds snapshot for a game, or null. */
async function loadLine(gameKey, homeAway) {
  const result = await pool.query(
    `SELECT "total", "spread", "observed_at" FROM "game_odds_snapshots"
     WHERE "game_key" = $1 ORDER BY "observed_at" DESC LIMIT 1`,
    [gameKey]
  );
  const snapshot = result.rows[0];
  if (!snapshot) return null;
  const quote = impliedTeamPoints({ total: snapshot.total, spread: snapshot.spread });
  return {
    spread: snapshot.spread == null ? null : Number(snapshot.spread),
    total: snapshot.total == null ? null : Number(snapshot.total),
    observedAt: snapshot.observed_at,
    impliedTeamTotal: impliedTotalForTeam(quote, homeAway),
  };
}

/** The weather context for a game: fields-null once a game exists, per the ADR — never bare null. */
async function loadWeather(gameKey, roof) {
  if (isIndoorGame({ roof })) {
    return {
      indoor: true,
      temperatureF: null,
      windSpeedMph: null,
      windGustMph: null,
      precipitationProbability: null,
      shortForecast: null,
    };
  }
  const result = await pool.query(
    `SELECT "temperature_f", "wind_speed_mph", "wind_gust_mph", "precipitation_probability", "short_forecast"
     FROM "game_weather_snapshots" WHERE "game_key" = $1 ORDER BY "horizon_hours" ASC LIMIT 1`,
    [gameKey]
  );
  const snap = result.rows[0];
  return {
    indoor: false,
    temperatureF: snap && snap.temperature_f != null ? Number(snap.temperature_f) : null,
    windSpeedMph: snap && snap.wind_speed_mph != null ? Number(snap.wind_speed_mph) : null,
    windGustMph: snap && snap.wind_gust_mph != null ? Number(snap.wind_gust_mph) : null,
    precipitationProbability:
      snap && snap.precipitation_probability != null ? Number(snap.precipitation_probability) : null,
    shortForecast: snap && snap.short_forecast ? snap.short_forecast : null,
  };
}

/**
 * Usage for the last three played weeks plus the season average, or null
 * when his team has no played week at all before `week` (e.g. week 1).
 */
async function loadUsage({ playerId, playerTeam, season, week, rules }) {
  const playedWeeksResult = await pool.query(
    `SELECT "week" FROM "nfl_games"
     WHERE "season" = $1 AND "week" < $2 AND fn_normalize_nfl_team("nfl_team") = fn_normalize_nfl_team($3)
     ORDER BY "week" DESC LIMIT 3`,
    [season, week, playerTeam]
  );
  const playedWeeks = playedWeeksResult.rows.map((row) => Number(row.week));
  if (playedWeeks.length === 0) return null;

  // Every week this SEASON (before `week`) the player has a stats row —
  // the superset of the 3 played weeks above, used again for the season
  // average ("over his weeks with a stats row").
  const statsResult = await pool.query(
    `SELECT "week", "stats" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" < $3`,
    [playerId, season, week]
  );
  const statsByWeek = new Map(statsResult.rows.map((row) => [Number(row.week), row.stats || {}]));

  // Team pass attempts, batched: one query for every (week, folded gameTeam)
  // this player's own rows could need, rather than one query per week.
  const neededWeeks = [...statsByWeek.keys()];
  const neededTeams = [...new Set(
    [...statsByWeek.values()]
      .map((stats) => normalizeNflTeam(stats.gameTeam))
      .filter((team) => team !== null)
  )];
  const attemptsByWeekTeam = new Map();
  if (neededWeeks.length > 0 && neededTeams.length > 0) {
    const attemptsResult = await pool.query(
      `SELECT "week", "stats" FROM "player_stats"
       WHERE "season" = $1 AND "week" = ANY($2::int[])
         AND fn_normalize_nfl_team("stats"->>'gameTeam') = ANY($3::text[])`,
      [season, neededWeeks, neededTeams]
    );
    for (const row of attemptsResult.rows) {
      const stats = row.stats || {};
      const team = normalizeNflTeam(stats.gameTeam);
      if (team === null) continue;
      const attempts = isNum(stats.usagePassAttempts) ? Number(stats.usagePassAttempts) : 0;
      const key = `${Number(row.week)}:${team}`;
      attemptsByWeekTeam.set(key, (attemptsByWeekTeam.get(key) || 0) + attempts);
    }
  }

  const entryFor = (statWeek) => {
    const stats = statsByWeek.get(statWeek);
    if (!stats) return null; // a played week his team had, that he did not
    const team = normalizeNflTeam(stats.gameTeam);
    const teamPassAttempts = team !== null ? (attemptsByWeekTeam.get(`${statWeek}:${team}`) ?? 0) : null;
    return usageEntryFromStats(stats, rules, teamPassAttempts);
  };

  const weeks = playedWeeks.map((statWeek) => {
    const entry = entryFor(statWeek);
    return {
      season,
      week: statWeek,
      targets: entry ? entry.targets : null,
      carries: entry ? entry.carries : null,
      airYards: entry ? entry.airYards : null,
      targetShare: entry ? entry.targetShare : null,
      fantasyPoints: entry ? entry.fantasyPoints : null,
    };
  });

  const seasonRows = neededWeeks.map((statWeek) => entryFor(statWeek)).filter(Boolean);
  const seasonAverage = seasonRows.length > 0
    ? {
        targets: averageOf(seasonRows.map((r) => r.targets)),
        carries: averageOf(seasonRows.map((r) => r.carries)),
        airYards: averageOf(seasonRows.map((r) => r.airYards)),
        targetShare: averageOf(seasonRows.map((r) => r.targetShare)),
        fantasyPoints: averageOf(seasonRows.map((r) => r.fantasyPoints)),
      }
    : null;

  return { weeks, seasonAverage };
}

/**
 * The full Decision card context for one player on the caller's roster.
 * Throws DecisionCardError(404, ..., 'league not found'-shaped) when the
 * league does not exist, MembershipError(403) when the caller holds no team
 * in it, and DecisionCardError(404, ..., PLAYER_NOT_ON_ROSTER) when the
 * player is not on the caller's own roster there.
 */
async function getDecisionCardContext({ leagueId, userId, playerId, week }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DecisionCardError(404, 'league not found');

  const team = await requireMember(pool, { leagueId, userId });

  const playerResult = await pool.query(
    `SELECT "players".* FROM "team_players"
     JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1 AND "team_players"."player_id" = $2`,
    [team.id, playerId]
  );
  const player = playerResult.rows[0];
  if (!player) throw new DecisionCardError(404, 'player is not on your roster', PLAYER_NOT_ON_ROSTER);

  const season = league.current_season;
  const effectiveWeek = week === undefined || week === null ? league.current_week : week;

  const gameResult = await pool.query(
    `SELECT "game_key", "roof", "home_away" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2 AND fn_normalize_nfl_team("nfl_team") = fn_normalize_nfl_team($3)`,
    [season, effectiveWeek, player.nfl_team]
  );
  const game = gameResult.rows[0] || null;

  const [line, weather, usage] = await Promise.all([
    game && game.game_key ? loadLine(game.game_key, game.home_away) : Promise.resolve(null),
    game && game.game_key ? loadWeather(game.game_key, game.roof) : Promise.resolve(null),
    loadUsage({
      playerId: player.id,
      playerTeam: player.nfl_team,
      season,
      week: effectiveWeek,
      rules: rulesForLeague(league),
    }),
  ]);

  return { line, weather, usage };
}

module.exports = {
  DecisionCardError,
  PLAYER_NOT_ON_ROSTER,
  getDecisionCardContext,
  averageOf,
  impliedTotalForTeam,
  usageEntryFromStats,
  // Exported for playerCard.service.js (#1306 Ruling item 3): the card's
  // `usage` tile is this function's `{ weeks, seasonAverage } | null` verbatim,
  // not the body's four-field sketch, so the Lineup card's Usage tile (ADR
  // 0037) stays the one producer.
  loadUsage,
};
