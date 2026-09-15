const pool = require('../modules/pool');

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
 * later scan finds the row correct, when they are resolved in place. The scan
 * log row is what the health route reads for "when did this last run".
 */
const KIND_POINTS_MISMATCH = 'points-mismatch';
const POINTS_TOLERANCE = 0.005;
const DEFAULT_PAGE_SIZE = 5000;

function defaultSeasons(now = new Date()) {
  const year = now.getUTCFullYear();
  return [year - 1, year];
}

async function scanPlayerStats({ seasons = defaultSeasons(), pageSize = DEFAULT_PAGE_SIZE, db = pool } = {}) {
  const { calculateFantasyPoints } = require('./scoring.service');
  const started = await db.query(
    `INSERT INTO "player_stats_integrity_scans" ("seasons", "started_at") VALUES ($1, now()) RETURNING "id"`,
    [seasons]
  );
  const scanId = started.rows[0].id;

  const found = new Map();
  let scanned = 0;
  let afterId = 0;
  for (;;) {
    const page = await db.query(
      `SELECT "id", "player_id", "season", "week", "stats", "fantasy_points"
       FROM "player_stats"
       WHERE "season" = ANY($1::int[]) AND "id" > $2
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
     WHERE "resolved_at" IS NULL AND "season" = ANY($1::int[])`,
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

  const result = { scanId, seasons, scanned, open: found.size, resolved: resolvedIds.length };
  await db.query(
    `UPDATE "player_stats_integrity_scans"
     SET "scanned_rows" = $1, "open_anomalies" = $2, "finished_at" = now() WHERE "id" = $3`,
    [scanned, found.size, scanId]
  );
  return result;
}

function anomalyKey(playerId, season, week, kind) {
  return `${playerId}:${season}:${week}:${kind}`;
}

/**
 * What the health route publishes: open anomalies across every season, and
 * the latest finished scan. `ok` is false on any open anomaly and when the
 * table cannot be read; a scan that has never run is reported as such rather
 * than as healthy, since "never checked" is not "clean".
 */
async function getIntegrityStatus({ db = pool } = {}) {
  const [open, scan] = await Promise.all([
    db.query(`SELECT count(*)::int AS "open" FROM "player_stats_anomalies" WHERE "resolved_at" IS NULL`),
    db.query(
      `SELECT "finished_at", "scanned_rows" FROM "player_stats_integrity_scans"
       WHERE "finished_at" IS NOT NULL ORDER BY "finished_at" DESC LIMIT 1`
    ),
  ]);
  const openCount = open.rows[0].open;
  const last = scan.rows[0] || null;
  return {
    ok: openCount === 0 && last !== null,
    open: openCount,
    lastScanAt: last ? last.finished_at : null,
    lastScannedRows: last ? last.scanned_rows : null,
  };
}

module.exports = { scanPlayerStats, getIntegrityStatus, defaultSeasons, KIND_POINTS_MISMATCH };
