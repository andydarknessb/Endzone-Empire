const pool = require('../modules/pool');
const { impliedTeamPoints } = require('./vegasOdds.provider');
const { isIndoorGame } = require('./nwsWeather.service');
const { calculateFantasyPoints } = require('./scoringRules');
const { normalizeNflTeam } = require('./nflTeam');
const { isPresentNumber: isNum } = require('./numericPresence');
const { positionGroup } = require('./projectionModel');
const projectionFeatures = require('./projectionFeatures');

/**
 * The Decision card's per-player context loaders (#1236, ADR 0037, ADR 0032;
 * one read since #1667). `playerCard.service.js` `getPlayerCard` is the one
 * caller: it carries `line`, `weather`, `decision.usage` and `opponents` for
 * any player, rostered or not. The former context route and its roster-only
 * orchestrator are gone.
 *
 * `line` and `weather` are read off the player's OWN game this week
 * (resolved from his CURRENT `players.nfl_team`, folded through the same
 * `fn_normalize_nfl_team`/`normalizeNflTeam` vocabulary `nfl_games` is keyed
 * by everywhere else). Both are `null` when he has no game this week at all
 * (a bye, or an unsynced slate); `weather` is a fields-null object (never
 * bare `null`) once a game exists, per the ADR.
 *
 * `usage`'s three "last played weeks" are the three most recent (season,
 * week) pairs before the requested week in which his CURRENT team's schedule
 * shows a game. Target share's denominator sums every `player_stats` row's
 * `stats.usagePassAttempts` for that season/week whose `stats.gameTeam`
 * (folded) matches the player's own, never `players.nfl_team`.
 * KNOWN UNDERCOUNT: a passer never synced into `players` has no
 * `player_stats` row, so his attempts are absent from the sum.
 *
 * Fantasy points price every stats row through `calculateFantasyPoints`
 * under `rulesForLeague(league)` (#739, ADR 0024), never the stored
 * default-rules `fantasy_points` column.
 */

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
function usageEntryFromStats(stats, rules, teamPassAttempts, side = 'offense') {
  const targets = isNum(stats.usageTargets) ? Number(stats.usageTargets) : null;
  const carries = isNum(stats.usageCarries) ? Number(stats.usageCarries) : null;
  const airYards = isNum(stats.usageAirYards) ? Number(stats.usageAirYards) : null;
  // `side` picks the snap keys: 'defense' for IDP positions, else offense.
  const snapKey = side === 'defense' ? 'usageDefenseSnaps' : 'usageOffenseSnaps';
  const shareKey = side === 'defense' ? 'usageDefenseSnapPct' : 'usageOffenseSnapPct';
  const snaps = isNum(stats[snapKey]) ? Number(stats[snapKey]) : null;
  const snapShare = isNum(stats[shareKey]) ? Number(stats[shareKey]) : null;
  const fantasyPoints = calculateFantasyPoints(stats, rules);
  const targetShare = targets !== null && typeof teamPassAttempts === 'number' && teamPassAttempts > 0
    ? round4(targets / teamPassAttempts)
    : null;
  return { targets, carries, airYards, snaps, snapShare, targetShare, fantasyPoints };
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
async function loadUsage({ playerId, playerTeam, season, week, rules, side = 'offense' }) {
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
    return usageEntryFromStats(stats, rules, teamPassAttempts, side);
  };

  const weeks = playedWeeks.map((statWeek) => {
    const entry = entryFor(statWeek);
    return {
      season,
      week: statWeek,
      targets: entry ? entry.targets : null,
      carries: entry ? entry.carries : null,
      airYards: entry ? entry.airYards : null,
      snaps: entry ? entry.snaps : null,
      snapShare: entry ? entry.snapShare : null,
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
        snaps: averageOf(seasonRows.map((r) => r.snaps)),
        snapShare: averageOf(seasonRows.map((r) => r.snapShare)),
        targetShare: averageOf(seasonRows.map((r) => r.targetShare)),
        fantasyPoints: averageOf(seasonRows.map((r) => r.fantasyPoints)),
      }
    : null;

  return { weeks, seasonAverage };
}

/**
 * Opponent rank vs position (#1609): for each of the player's next games,
 * where the opponent ranks among the defenses in `allowedByDefense` (the
 * `buildLeagueContext` map for the player's position group). Rank 1 allows
 * the most points per game (the easiest matchup); ties share the lower rank
 * number. A game whose opponent has no allowance row contributes no entry,
 * the same as a bye (no game row), so the tile hides on missing data.
 * `games` is `[{ week, opponent }]`, already in week order.
 */
function opponentEntries(games, allowedByDefense) {
  if (!allowedByDefense || allowedByDefense.size === 0) return [];
  const allowed = [...allowedByDefense.values()].map((v) => v.allowedPerGame);
  const entries = [];
  for (const game of games) {
    const opponent = normalizeNflTeam(game.opponent);
    const row = opponent ? allowedByDefense.get(opponent) : null;
    if (!row) continue;
    entries.push({
      week: Number(game.week),
      opponent,
      rankVsPosition: 1 + allowed.filter((a) => a > row.allowedPerGame).length,
      allowedPerGame: row.allowedPerGame,
      games: row.games,
    });
  }
  return entries;
}

// The per-position season scan behind Opponent rank is the heaviest query on
// the card read, and a Waivers row expand opens many cards at one position in
// one league/week (#1667). Memoised here, keyed league + season + week +
// position (the rules are the league's own), for ten minutes; a scoring-rules
// edit is served under the old rules for up to LEAGUE_CONTEXT_TTL_MS. The in-flight
// promise is cached so concurrent reads share one scan; a failed scan is
// dropped so the next read retries.
const LEAGUE_CONTEXT_TTL_MS = 10 * 60 * 1000;
const leagueContextMemo = new Map();

function clearLeagueContextMemo() {
  leagueContextMemo.clear();
}

function leagueContextMemoSize() {
  return leagueContextMemo.size;
}

function memoLeagueContext({ leagueId, season, week, rules, position }) {
  const key = `${leagueId}:${season}:${week}:${position}`;
  const now = Date.now();
  const hit = leagueContextMemo.get(key);
  if (hit && now - hit.at < LEAGUE_CONTEXT_TTL_MS) return hit.promise;
  // Sweep on set: a past week's key is never read again, so drop every expired entry.
  for (const [k, entry] of leagueContextMemo) {
    if (now - entry.at >= LEAGUE_CONTEXT_TTL_MS) leagueContextMemo.delete(k);
  }
  const promise = projectionFeatures.loadLeagueContext({ season, week, rules, positions: [position] });
  leagueContextMemo.set(key, { at: now, promise });
  promise.catch(() => {
    if (leagueContextMemo.get(key)?.promise === promise) leagueContextMemo.delete(key);
  });
  return promise;
}

/**
 * The next three weeks' opponents' rank vs the player's position. The league
 * scan is `loadFeatureBundle`'s own, via `loadLeagueContext` (one producer, no second aggregation of
 * points allowed), read under the league's rules.
 */
async function loadOpponents({ leagueId, player, season, week, rules }) {
  const group = positionGroup(player.position);
  if (!group) return [];
  const gamesResult = await pool.query(
    `SELECT "week", "opponent" FROM "nfl_games"
     WHERE "season" = $1 AND "week" >= $2 AND "week" <= $3
       AND fn_normalize_nfl_team("nfl_team") = fn_normalize_nfl_team($4)
     ORDER BY "week"`,
    [season, week, week + 2, player.nfl_team]
  );
  if (gamesResult.rows.length === 0) return [];
  const leagueContext = await memoLeagueContext({
    leagueId, season, week, rules, position: player.position,
  });
  const context = leagueContext.get(group);
  return opponentEntries(gamesResult.rows, context ? context.allowedByDefense : null);
}

module.exports = {
  LEAGUE_CONTEXT_TTL_MS,
  clearLeagueContextMemo,
  leagueContextMemoSize,
  memoLeagueContext,
  loadLine,
  loadWeather,
  loadOpponents,
  sideForPosition,
  loadGameContext,
  averageOf,
  impliedTotalForTeam,
  usageEntryFromStats,
  opponentEntries,
  // Exported for playerCard.service.js (#1306 Ruling item 3): the card's
  // `usage` tile is this function's `{ weeks, seasonAverage } | null` verbatim,
  // not the body's four-field sketch, so the Lineup card's Usage tile (ADR
  // 0037) stays the one producer.
  loadUsage,
};

/** 'defense' for an IDP position group (its snaps live under the defense keys), else 'offense'. */
function sideForPosition(position) {
  return String(positionGroup(position) || '').startsWith('IDP_') ? 'defense' : 'offense';
}

/** `{ line, weather }` for the player's game this week; both null when he has none. */
async function loadGameContext({ season, week, nflTeam }) {
  const gameResult = await pool.query(
    `SELECT "game_key", "roof", "home_away" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2 AND fn_normalize_nfl_team("nfl_team") = fn_normalize_nfl_team($3)`,
    [season, week, nflTeam]
  );
  const game = gameResult.rows[0];
  if (!game || !game.game_key) return { line: null, weather: null };
  const [line, weather] = await Promise.all([
    loadLine(game.game_key, game.home_away),
    loadWeather(game.game_key, game.roof),
  ]);
  return { line, weather };
}
