const pool = require('../modules/pool');
const { lastRun } = require('../modules/syncRun');

/**
 * Nightly integrity scan of `player_stats` (2026-09-15 week 1 audit): every
 * row's stored `fantasy_points` must be the default-rules score of its
 * `stats`. The write funnel (playerStatsWrite.service) makes that true for
 * every row the application writes, so a mismatch can only come from outside
 * it (a hand write, a test pointed at production, a rules change applied
 * without a rescore). A mismatch is recorded, never repaired: the row is
 * evidence, and which side is wrong is an operator's call.
 *
 * Anomalies are keyed by (player, season, week, kind) and stay open until a
 * later scan finds the row correct or gone, when they are resolved in place.
 * Every season is scanned every night (about 45 pages of 5000 rows), so an
 * anomaly on a past season is re-examined until it clears; the scan itself is
 * a Sync run (ADR 0036, job `player-stats-integrity`), whose data_sync_runs
 * row is what the health route reads for freshness.
 */
const JOB = 'player-stats-integrity';
const KIND_POINTS_MISMATCH = 'points-mismatch';
const POINTS_TOLERANCE = 0.005;
const DEFAULT_PAGE_SIZE = 5000;
// A scan that has not finished inside this window is stale: the duty runs
// nightly, so a day and a half covers one missed night without paging on it.
const STALE_MS = 36 * 60 * 60 * 1000;

/**
 * `seasons` narrows the scan (tests, an operator rerun); null means every
 * season. The resolve step uses the same scope, so an open anomaly outside a
 * narrowed scan is left untouched rather than falsely resolved.
 */
async function scanPlayerStats({ seasons = null, pageSize = DEFAULT_PAGE_SIZE, db = pool } = {}) {
  const { calculateFantasyPoints } = require('./scoringRules');
  const found = new Map();
  let scanned = 0;
  let afterId = 0;
  for (;;) {
    const page = await db.query(
      `SELECT "id", "player_id", "season", "week", "stats", "fantasy_points"
       FROM "player_stats"
       WHERE ($1::int[] IS NULL OR "season" = ANY($1::int[])) AND "id" > $2
       ORDER BY "id" LIMIT $3`,
      [seasons, afterId, pageSize]
    );
    for (const row of page.rows) {
      scanned += 1;
      afterId = row.id;
      const stored = Number(row.fantasy_points);
      const computed = Math.round(calculateFantasyPoints(row.stats) * 100) / 100;
      if (Math.abs(stored - computed) > POINTS_TOLERANCE) {
        found.set(anomalyKey(row.player_id, row.season, row.week, KIND_POINTS_MISMATCH), {
          playerId: row.player_id, season: row.season, week: row.week, kind: KIND_POINTS_MISMATCH,
          detail: { stored, computed },
        });
      }
    }
    if (page.rows.length < pageSize) break;
  }

  for (const anomaly of found.values()) {
    await db.query(
      `INSERT INTO "player_stats_anomalies" ("player_id", "season", "week", "kind", "detail", "detected_at", "last_seen_at")
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT ("player_id", "season", "week", "kind")
       DO UPDATE SET "detail" = EXCLUDED."detail", "last_seen_at" = now(), "resolved_at" = NULL`,
      [anomaly.playerId, anomaly.season, anomaly.week, anomaly.kind, JSON.stringify(anomaly.detail)]
    );
  }

  const open = await db.query(
    `SELECT "id", "player_id", "season", "week", "kind" FROM "player_stats_anomalies"
     WHERE "resolved_at" IS NULL AND ($1::int[] IS NULL OR "season" = ANY($1::int[]))`,
    [seasons]
  );
  const resolvedIds = open.rows
    .filter((row) => !found.has(anomalyKey(row.player_id, row.season, row.week, row.kind)))
    .map((row) => row.id);
  if (resolvedIds.length > 0) {
    await db.query(
      `UPDATE "player_stats_anomalies" SET "resolved_at" = now() WHERE "id" = ANY($1::int[])`,
      [resolvedIds]
    );
  }

  return { scanned, open: found.size, resolved: resolvedIds.length };
}

function anomalyKey(playerId, season, week, kind) {
  return `${playerId}:${season}:${week}:${kind}`;
}

/**
 * What the health route publishes: open anomalies across every season and
 * the last successful scan. `ok` needs zero open anomalies AND a scan that
 * finished inside STALE_MS: a scan that has stopped running is not clean, it
 * is unobserved, and "never checked" reads the same way.
 */
async function getIntegrityStatus({ now = new Date() } = {}) {
  const [open, runs] = await Promise.all([
    pool.query(`SELECT count(*)::int AS "open" FROM "player_stats_anomalies" WHERE "resolved_at" IS NULL`),
    lastRun(JOB),
  ]);
  const openCount = open.rows[0].open;
  const finishedAt = runs.latestOk ? runs.latestOk.finishedAt : null;
  const stale = !finishedAt || now.getTime() - finishedAt.getTime() > STALE_MS;
  return {
    ok: openCount === 0 && !stale,
    open: openCount,
    lastScanAt: finishedAt,
    stale,
  };
}

module.exports = { scanPlayerStats, getIntegrityStatus, JOB, KIND_POINTS_MISMATCH, STALE_MS };
