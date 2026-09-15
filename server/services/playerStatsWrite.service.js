/**
 * The one writer of `player_stats`. Every feed path (Live box, Final box,
 * nflverse week apply, nflverse finalization) lands here, so the stored
 * `fantasy_points` is always the default-rules score of the stored `stats`:
 * the funnel computes it and never accepts one from the caller. A row whose
 * points disagree with its stats can therefore only reach the table from
 * outside the application, which is what playerStatsIntegrity.service scans
 * for.
 *
 * `db` is a pool or a checked-out transaction client (ADR 0033); the funnel
 * issues exactly one statement and owns no transaction of its own.
 */
async function upsertPlayerStats(db, { playerId, season, week, stats }) {
  // Lazy: scoring.service is the caller of this module on the Live/Final box
  // path, so a load-time require would be a cycle.
  const { calculateFantasyPoints } = require('./scoring.service');
  const fantasyPoints = calculateFantasyPoints(stats);
  await db.query(
    `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("player_id", "season", "week")
     DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
    [playerId, season, week, JSON.stringify(stats), fantasyPoints]
  );
  return { fantasyPoints };
}

module.exports = { upsertPlayerStats };
