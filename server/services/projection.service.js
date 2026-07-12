const pool = require('../modules/pool');

class ProjectionError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Weekly point projections, the substrate for start/sit advice, the trade
 * analyzer, waiver rankings, and the Monte Carlo simulator.
 *
 * Strategy: an external projections feed slot exists (source 'external') but
 * none is wired today, so everything extrapolates from the season to date —
 * a player's projection is their average fantasy_points over the weeks they
 * actually played (zero-point weeks count only when a stats row exists, so
 * byes/DNPs don't drag the average). Projections use the DEFAULT scoring
 * rules; league-specific rules shift absolute values but rarely the ordering,
 * which is what the decision features consume.
 */

/** Pure: average of played weeks' points, rounded to 2dp. Empty -> 0. */
function extrapolateWeekly(pointsByWeek) {
  const played = pointsByWeek.filter((p) => Number.isFinite(Number(p)));
  if (played.length === 0) return 0;
  const total = played.reduce((sum, p) => sum + Number(p), 0);
  return Math.round((total / played.length) * 100) / 100;
}

/**
 * Projections for every player for (season, week), as a Map playerId ->
 * { points, source }. Served from the player_projections cache when present;
 * otherwise computed from weeks < `week` and cached. Recompute (e.g. after a
 * stat correction) by passing { refresh: true }.
 */
async function getWeekProjections({ season, week, refresh = false }) {
  if (!refresh) {
    const cached = await pool.query(
      `SELECT "player_id", "projected_points", "source"
       FROM "player_projections" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    );
    if (cached.rows.length > 0) {
      return new Map(
        cached.rows.map((r) => [r.player_id, { points: Number(r.projected_points), source: r.source }])
      );
    }
  }

  const statsResult = await pool.query(
    `SELECT "player_id", array_agg("fantasy_points") AS "points"
     FROM "player_stats" WHERE "season" = $1 AND "week" < $2
     GROUP BY "player_id"`,
    [season, week]
  );
  const projections = new Map();
  for (const row of statsResult.rows) {
    projections.set(row.player_id, {
      points: extrapolateWeekly(row.points),
      source: 'extrapolated',
    });
  }

  for (const [playerId, { points, source }] of projections) {
    await pool.query(
      `INSERT INTO "player_projections" ("player_id", "season", "week", "projected_points", "source")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "projected_points" = EXCLUDED."projected_points",
                     "source" = EXCLUDED."source", "updated_at" = now()`,
      [playerId, season, week, points, source]
    );
  }
  return projections;
}

/**
 * Rest-of-season totals: weekly projection x remaining weeks, as a Map
 * playerId -> total. Under extrapolation the weekly value is flat, so this is
 * a multiply — but callers should treat it as opaque so an external feed with
 * true per-week values can slot in.
 */
async function getRestOfSeasonProjections({ season, fromWeek, throughWeek }) {
  const weekly = await getWeekProjections({ season, week: fromWeek });
  const remaining = Math.max(0, throughWeek - fromWeek + 1);
  const totals = new Map();
  for (const [playerId, { points }] of weekly) {
    totals.set(playerId, Math.round(points * remaining * 100) / 100);
  }
  return totals;
}

/**
 * Positional defense: average fantasy points each NFL team has ALLOWED per
 * game to each position this season (weeks < uptoWeek). Map
 * nflTeam -> { QB: avg, RB: avg, ... }. Powers opponent-difficulty context in
 * start/sit. Teams/positions with no data are simply absent — callers treat
 * missing as neutral.
 */
async function getPositionDefense({ season, uptoWeek }) {
  const result = await pool.query(
    `SELECT "nfl_games"."opponent" AS "defense", "players"."position",
            SUM("player_stats"."fantasy_points") AS "points",
            COUNT(DISTINCT "player_stats"."week") AS "games"
     FROM "player_stats"
     JOIN "players" ON "players"."id" = "player_stats"."player_id"
     JOIN "nfl_games" ON "nfl_games"."season" = "player_stats"."season"
       AND "nfl_games"."week" = "player_stats"."week"
       AND "nfl_games"."nfl_team" = "players"."nfl_team"
     WHERE "player_stats"."season" = $1 AND "player_stats"."week" < $2
     GROUP BY "nfl_games"."opponent", "players"."position"`,
    [season, uptoWeek]
  );
  const defense = new Map();
  for (const row of result.rows) {
    if (!defense.has(row.defense)) defense.set(row.defense, {});
    const games = Number(row.games) || 1;
    defense.get(row.defense)[row.position] =
      Math.round((Number(row.points) / games) * 100) / 100;
  }
  return defense;
}

module.exports = {
  ProjectionError,
  extrapolateWeekly,
  getWeekProjections,
  getRestOfSeasonProjections,
  getPositionDefense,
};
