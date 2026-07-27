const pool = require('../modules/pool');
const { calculateFantasyPoints } = require('./scoring.service');
const { computeByeWeeks } = require('./bye.service');
const model = require('./projectionModel');

/**
 * Feature extraction for the weekly projection engine.
 *
 * Split from projection.service.js so the ENGINE (cache identity, run
 * bookkeeping, the public API) and the FEATURES (what the model gets to look
 * at) can be reviewed and tested independently.
 *
 * Three invariants hold everywhere in this file:
 *
 * 1. **Input cutoff.** Nothing loaded here may postdate the target week's
 *    kickoff. Current-season stats are filtered to `week < W` in SQL, opponent
 *    allowances are computed from `week < W` only, and prior seasons are
 *    complete by definition. There is no code path that reads week W's own
 *    stats, and `assertNoFutureRows` is exported so tests can prove it.
 * 2. **League scoring.** Every historical stat line is re-priced through
 *    `calculateFantasyPoints(stats, rules)` with the VIEWING league's rules.
 *    The stored `fantasy_points` column (default half-PPR) is never read as an
 *    authoritative value.
 * 3. **Missing stays missing.** A player, defense or split with no data yields
 *    `null` / an unavailable factor, never a zero that reads like a
 *    measurement.
 *
 * Batching: one query per CONCEPT for the whole request, never one per player.
 */

// How many completed seasons back the weekly history window reaches. Two is
// enough for a Week 1 veteran baseline without dragging a 3-year-old role into
// a current projection.
const HISTORY_SEASONS = 2;

// Guard rail on the league-wide opportunity scan (opponent allowance, position
// baselines, home/away splits). A normal season-to-date scan for the positions
// on one roster is a few thousand rows; this only trips if something upstream
// asks for an implausible window, in which case the affected factors report
// themselves unavailable rather than the request timing out.
const MAX_LEAGUE_SCAN_ROWS = 60000;

// See projectionModel.isNum: `Number(null)` is 0, so a naive finite check
// silently converts missing evidence into a measured zero.
function isNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

/** Pure: how many "recency weeks" separate a historical game from the target week. */
function weeksAgo({ gameSeason, gameWeek, season, week, seasonWeekSpan = model.MODEL_CONSTANTS.baseline.seasonWeekSpan }) {
  const seasonGap = Number(season) - Number(gameSeason);
  return seasonGap * seasonWeekSpan + (Number(week) - Number(gameWeek));
}

/**
 * Pure: assert a set of stat rows contains nothing at or after the prediction
 * cutoff. Exported so the "future weeks cannot enter the feature set" test can
 * assert on the real filter rather than a re-implementation of it.
 */
function assertNoFutureRows(rows, { season, week }) {
  for (const row of rows || []) {
    const s = Number(row.season);
    const w = Number(row.week);
    if (s > Number(season) || (s === Number(season) && w >= Number(week))) {
      throw new Error(
        `projection input cutoff violated: row for season ${s} week ${w} is not before ${season} week ${week}`
      );
    }
  }
  return true;
}

/** Pure: usage/opportunity keys nflverse can supply. Presence marks "we know his role". */
const ROLE_KEYS = [
  'usagePassAttempts',
  'usageCompletions',
  'usageCarries',
  'usageTargets',
  'usageAirYards',
  'receptions',
];

function hasRoleSignal(stats) {
  if (!stats || typeof stats !== 'object') return false;
  return ROLE_KEYS.some((key) => stats[key] != null);
}

// ---------------------------------------------------------------------------
// Pure builders (no DB) — the DB layer below just hands them rows.
// ---------------------------------------------------------------------------

/**
 * Pure: a player's prior league-scored games, newest first, annotated with
 * recency distance and the opponent they were played against (when the
 * schedule can be resolved for that exact season/week).
 */
function buildPriorGames({ statRows, rules, season, week, opponentByTeamWeek, playerTeam }) {
  const games = [];
  for (const row of statRows || []) {
    const points = calculateFantasyPoints(row.stats, rules);
    const key = `${row.season}:${row.week}:${playerTeam || ''}`;
    const schedule = opponentByTeamWeek ? opponentByTeamWeek.get(key) : null;
    games.push({
      season: Number(row.season),
      week: Number(row.week),
      points,
      weeksAgo: weeksAgo({ gameSeason: row.season, gameWeek: row.week, season, week }),
      // Only the CURRENT season's orientation/opponent is trustworthy: we
      // store no per-week team history, so a prior-season row's "opponent"
      // would really be "whoever this player's CURRENT team played".
      opponent: Number(row.season) === Number(season) && schedule ? schedule.opponent : null,
      isHome: Number(row.season) === Number(season) && schedule ? schedule.isHome : null,
      hasRole: hasRoleSignal(row.stats),
    });
  }
  games.sort((a, b) => a.weeksAgo - b.weeksAgo);
  return games;
}

/**
 * Pure: league-wide positional context from one season-to-date scan.
 *
 * Returns, per position group:
 *  - `baselinePerGame`: the average a player of that group scores in a game
 *    (the last-resort shrinkage target),
 *  - `allowedByDefense`: what each defense has allowed per game,
 *  - `leagueAllowedPerGame`: the league-average allowance to compare against,
 *  - `homeAway`: the empirical home/away split,
 *  - `residuals`: pooled per-game deviations from each player's own mean,
 *    which is what gives a thin-sample player a usable interval.
 */
function buildLeagueContext({ rows, rules, defenseGamesByTeam }) {
  const byGroup = new Map();
  const playerTotals = new Map(); // playerId -> { group, points: [] }

  const groupBucket = (group) => {
    if (!byGroup.has(group)) {
      byGroup.set(group, {
        totalPoints: 0,
        totalGames: 0,
        allowed: new Map(), // defense -> points allowed
        homePoints: 0,
        homeGames: 0,
        awayPoints: 0,
        awayGames: 0,
        residuals: [],
      });
    }
    return byGroup.get(group);
  };

  for (const row of rows || []) {
    const group = model.positionGroup(row.position);
    if (!group) continue;
    const points = calculateFantasyPoints(row.stats, rules);
    const bucket = groupBucket(group);
    bucket.totalPoints += points;
    bucket.totalGames += 1;
    if (row.defense) {
      bucket.allowed.set(row.defense, (bucket.allowed.get(row.defense) || 0) + points);
    }
    if (row.home_away === 'home') {
      bucket.homePoints += points;
      bucket.homeGames += 1;
    } else if (row.home_away === 'away') {
      bucket.awayPoints += points;
      bucket.awayGames += 1;
    }
    if (!playerTotals.has(row.player_id)) playerTotals.set(row.player_id, { group, points: [] });
    playerTotals.get(row.player_id).points.push(points);
  }

  // Pooled residuals: each game's deviation from that player's own mean. Only
  // players with 2+ games contribute, since a single game has no deviation.
  for (const { group, points } of playerTotals.values()) {
    if (points.length < 2) continue;
    const mean = points.reduce((s, p) => s + p, 0) / points.length;
    const bucket = groupBucket(group);
    for (const p of points) bucket.residuals.push(p - mean);
  }

  const context = new Map();
  for (const [group, bucket] of byGroup) {
    const allowedByDefense = new Map();
    let allowedSum = 0;
    let defenseGameSum = 0;
    for (const [defense, points] of bucket.allowed) {
      const games = defenseGamesByTeam.get(defense) || 0;
      if (games <= 0) continue;
      allowedByDefense.set(defense, { allowedPerGame: points / games, games });
      allowedSum += points;
      defenseGameSum += games;
    }
    context.set(group, {
      baselinePerGame: bucket.totalGames > 0 ? bucket.totalPoints / bucket.totalGames : null,
      playerGames: bucket.totalGames,
      allowedByDefense,
      leagueAllowedPerGame: defenseGameSum > 0 ? allowedSum / defenseGameSum : null,
      homeAway: {
        homeMean: bucket.homeGames > 0 ? bucket.homePoints / bucket.homeGames : null,
        homeGames: bucket.homeGames,
        awayMean: bucket.awayGames > 0 ? bucket.awayPoints / bucket.awayGames : null,
        awayGames: bucket.awayGames,
      },
      residuals: bucket.residuals,
    });
  }
  return context;
}

/**
 * Pure: prior meetings between this player and the target opponent, each paired
 * with the player's baseline EXCLUDING those meetings — so the factor measures
 * "better than his usual against them", not "he was good that year".
 *
 * Restricted to the current season on purpose: `player_stats` carries no
 * per-week team, so a prior-season row's opponent would be derived from the
 * player's CURRENT team's old schedule. That mapping is uncertain, and an
 * uncertain mapping produces no factor.
 */
function buildVersusOpponentMeetings({ priorGames, opponent, season }) {
  if (!opponent) return [];
  const sameSeason = (priorGames || []).filter((g) => g.season === Number(season));
  const meetings = sameSeason.filter((g) => g.opponent === opponent);
  if (meetings.length === 0) return [];
  const others = sameSeason.filter((g) => g.opponent !== opponent);
  const baseline = others.length > 0
    ? others.reduce((s, g) => s + g.points, 0) / others.length
    : null;
  if (!isNum(baseline) || Number(baseline) <= 0) return [];
  return meetings.map((g) => ({
    points: g.points,
    baseline,
    seasonsAgo: Number(season) - g.season,
  }));
}

// ---------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------

/**
 * Every input the model needs for one (season, week, league, player set),
 * loaded in a fixed number of batched queries regardless of roster size.
 *
 * `client` defaults to the pool but accepts a transaction client so a caller
 * already inside one does not deadlock against itself.
 */
async function loadFeatureBundle({ season, week, playerIds, rules, client = pool, positions = null }) {
  const ids = [...new Set((playerIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) {
    return {
      players: new Map(),
      priorStatsByPlayer: new Map(),
      seasonRowsByPlayer: new Map(),
      targetGames: new Map(),
      leagueContext: new Map(),
      byeByTeam: new Map(),
      opponentByTeamWeek: new Map(),
      defenseGamesByTeam: new Map(),
      sourceCoverage: emptyCoverage(),
      inputCutoff: null,
    };
  }

  const firstSeason = Number(season) - HISTORY_SEASONS;

  const [playersResult, statsResult, seasonResult, targetScheduleResult, priorScheduleResult] =
    await Promise.all([
      client.query(
        // team_key is the schedule-joinable spelling of nfl_team: DEF units
        // store a full team name and Tank01/nflverse disagree on WSH vs WAS,
        // so every team comparison in this file goes through it.
        `SELECT "id", "name", "position", "nfl_team", "injury_status", "injury_detail", "adp",
                fn_normalize_nfl_team("nfl_team") AS "team_key"
         FROM "players" WHERE "id" = ANY($1::int[])`,
        [ids]
      ),
      // The input cutoff, in SQL: strictly earlier seasons, or this season
      // strictly before the target week. Week W itself can never be selected.
      client.query(
        `SELECT "player_id", "season", "week", "stats"
         FROM "player_stats"
         WHERE "player_id" = ANY($1::int[])
           AND "season" >= $2
           AND ("season" < $3 OR ("season" = $3 AND "week" < $4))
         ORDER BY "season" DESC, "week" DESC`,
        [ids, firstSeason, season, week]
      ),
      client.query(
        `SELECT "player_id", "season", "games_played", "stats", "fantasy_points"
         FROM "player_season_stats"
         WHERE "player_id" = ANY($1::int[]) AND "season" < $2`,
        [ids, season]
      ),
      client.query(
        `SELECT fn_normalize_nfl_team("nfl_team") AS "team_key",
                fn_normalize_nfl_team("opponent") AS "opponent_key",
                "nfl_team", "opponent", "kickoff_at", "game_key", "home_away",
                "neutral_site", "venue", "roof", "surface", "latitude", "longitude", "rest_days"
         FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
        [season, week]
      ),
      client.query(
        `SELECT "week", fn_normalize_nfl_team("nfl_team") AS "team_key",
                fn_normalize_nfl_team("opponent") AS "opponent_key", "home_away"
         FROM "nfl_games" WHERE "season" = $1 AND "week" < $2`,
        [season, week]
      ),
    ]);

  assertNoFutureRows(statsResult.rows, { season, week });

  const players = new Map(playersResult.rows.map((r) => [r.id, r]));
  const priorStatsByPlayer = new Map();
  for (const row of statsResult.rows) {
    if (!priorStatsByPlayer.has(row.player_id)) priorStatsByPlayer.set(row.player_id, []);
    priorStatsByPlayer.get(row.player_id).push(row);
  }
  const seasonRowsByPlayer = new Map();
  for (const row of seasonResult.rows) {
    if (!seasonRowsByPlayer.has(row.player_id)) seasonRowsByPlayer.set(row.player_id, []);
    seasonRowsByPlayer.get(row.player_id).push(row);
  }

  const targetGames = new Map();
  for (const row of targetScheduleResult.rows) targetGames.set(row.team_key, row);

  // Schedule orientation for every completed week, keyed by team+week, so a
  // player's historical rows can be tied to who he faced and where.
  const opponentByTeamWeek = new Map();
  for (const row of priorScheduleResult.rows) {
    opponentByTeamWeek.set(`${season}:${row.week}:${row.team_key}`, {
      opponent: row.opponent_key,
      isHome: row.home_away === 'home' ? true : row.home_away === 'away' ? false : null,
    });
  }

  // League-wide scan for the positions actually requested. `fn_normalize_nfl_team`
  // on both sides is what lets DEF units (stored with a full team name) join
  // the schedule at all, and collapses the WSH/WAS alias split.
  const scanPositions = positions && positions.length > 0
    ? positions
    : [...new Set(playersResult.rows.map((r) => r.position).filter(Boolean))];
  let leagueRows = [];
  if (scanPositions.length > 0 && Number(week) > 1) {
    const scan = await client.query(
      `SELECT "ps"."player_id", "ps"."week", "ps"."stats", "p"."position",
              fn_normalize_nfl_team("ng"."opponent") AS "defense", "ng"."home_away"
       FROM "player_stats" "ps"
       JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       LEFT JOIN "nfl_games" "ng" ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
         AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
       WHERE "ps"."season" = $1 AND "ps"."week" < $2 AND "p"."position" = ANY($3::text[])
       LIMIT $4`,
      [season, week, scanPositions, MAX_LEAGUE_SCAN_ROWS]
    );
    leagueRows = scan.rows;
  }

  // Defense games must be keyed the same way the scan's `defense` column is.
  const normalizedDefenseGames = new Map();
  if (priorScheduleResult.rows.length > 0) {
    const normalized = await client.query(
      `SELECT fn_normalize_nfl_team("nfl_team") AS "team", COUNT(*)::int AS "games"
       FROM "nfl_games" WHERE "season" = $1 AND "week" < $2
       GROUP BY 1`,
      [season, week]
    );
    for (const row of normalized.rows) normalizedDefenseGames.set(row.team, Number(row.games));
  }

  const leagueContext = buildLeagueContext({
    rows: leagueRows,
    rules,
    defenseGamesByTeam: normalizedDefenseGames,
  });

  const byeByTeam = await computeByeWeeks(
    playersResult.rows.map((r) => r.nfl_team),
    season
  );

  // The run-level cutoff is the EARLIEST kickoff in the week: past it, some
  // information about week W exists in the world, so a run generated after it
  // can no longer claim a clean pre-kickoff feature set for every player.
  const kickoffs = targetScheduleResult.rows
    .map((r) => (r.kickoff_at ? new Date(r.kickoff_at).getTime() : null))
    .filter((t) => Number.isFinite(t));
  const inputCutoff = kickoffs.length > 0 ? new Date(Math.min(...kickoffs)) : null;

  return {
    players,
    priorStatsByPlayer,
    seasonRowsByPlayer,
    targetGames,
    leagueContext,
    byeByTeam,
    opponentByTeamWeek,
    defenseGamesByTeam: normalizedDefenseGames,
    leagueScanRows: leagueRows.length,
    scanTruncated: leagueRows.length >= MAX_LEAGUE_SCAN_ROWS,
    inputCutoff,
    sourceCoverage: null, // filled in by the engine, which knows about weather/expert too
  };
}

function emptyCoverage() {
  return {
    playerStats: { status: 'unavailable' },
    priorSeason: { status: 'unavailable' },
    schedule: { status: 'unavailable' },
    opponent: { status: 'unavailable' },
    homeAway: { status: 'unavailable' },
    injury: { status: 'unavailable' },
  };
}

module.exports = {
  HISTORY_SEASONS,
  MAX_LEAGUE_SCAN_ROWS,
  ROLE_KEYS,
  hasRoleSignal,
  weeksAgo,
  assertNoFutureRows,
  buildPriorGames,
  buildLeagueContext,
  buildVersusOpponentMeetings,
  loadFeatureBundle,
  emptyCoverage,
};
