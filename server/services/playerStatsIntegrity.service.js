const pool = require('../modules/pool');
const { lastRun, runSyncJob } = require('../modules/syncRun');
const cadence = require('../modules/cadence');

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
// A row on a settled week that is an Appearance but carries no stats.gameTeam:
// the nflverse correction pass never labelled it (#2629). Report-only, so it
// never reaches `ok` - about 105 such rows open on the first scan.
const KIND_UNLABELLED_APPEARANCE = 'unlabelled-appearance';
const CORRECTION_JOB = 'nflverse-correction';
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
  const { madeAppearance } = require('./madeAppearance');
  const { normalizeTeamKey } = require('./projectionFeatures');
  const frontier = await settledFrontier(db);
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
      // Checked last, cheapest rejects first: most rows sit in unsettled weeks.
      if (isSettled(row.season, row.week, frontier)
        && normalizeTeamKey(row.stats && row.stats.gameTeam) === null
        && madeAppearance(row.stats)) {
        found.set(anomalyKey(row.player_id, row.season, row.week, KIND_UNLABELLED_APPEARANCE), {
          playerId: row.player_id, season: row.season, week: row.week, kind: KIND_UNLABELLED_APPEARANCE,
          detail: { playerStatsId: row.id },
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
 * The settled frontier: the latest (season, week) an ok `nflverse-correction`
 * Sync run with games in its file names, or null when no such run exists.
 * The correction pass is what writes `stats.gameTeam`, so a week it has not
 * reached yet cannot be judged unlabelled - the current week's box rows would
 * all be flagged.
 *
 * The detail shape read here (season, week, gamesInFile) is the one written at
 * nflverseSync.service.js:1207.
 *
 * Ordered by (season, week), NOT by when the run finished: a backfill or a
 * per-league pass can finish later for an older week, and taking that run would
 * move the frontier backwards - the kind would stop firing and the resolve step
 * would close the anomalies above it as gone.
 */
async function settledFrontier(db) {
  const res = await db.query(
    `SELECT "detail" FROM "data_sync_runs"
     WHERE "job" = $1 AND "ok" = true
       AND jsonb_typeof("detail"->'season') = 'number'
       AND jsonb_typeof("detail"->'week') = 'number'
       AND jsonb_typeof("detail"->'gamesInFile') = 'number'
       AND ("detail"->>'gamesInFile')::numeric > 0
     ORDER BY ("detail"->>'season')::int DESC, ("detail"->>'week')::int DESC
     LIMIT 1`,
    [CORRECTION_JOB]
  );
  const detail = res.rows[0] && res.rows[0].detail;
  if (!detail) return null;
  const season = Number(detail.season);
  const week = Number(detail.week);
  return Number.isFinite(season) && Number.isFinite(week) ? { season, week } : null;
}

/** A (season, week) is settled at or before the frontier; earlier seasons always. */
function isSettled(season, week, frontier) {
  if (!frontier) return false;
  if (season !== frontier.season) return season < frontier.season;
  return week <= frontier.week;
}

/**
 * What the health route publishes: open anomalies across every season and
 * the last successful scan. `ok` needs zero open points-mismatch anomalies AND
 * a scan that finished inside STALE_MS: a scan that has stopped running is not
 * clean, it is unobserved, and "never checked" reads the same way.
 * `unlabelled-appearance` anomalies are counted apart and never reach `ok`
 * (#2629, report-only): there are about a hundred of them and they do not page.
 */
async function getIntegrityStatus({ now = new Date() } = {}) {
  const [counts, runs] = await Promise.all([
    pool.query(
      `SELECT count(*) FILTER (WHERE "kind" = $1)::int AS "open",
              count(*) FILTER (WHERE "kind" = $2)::int AS "unlabelled"
         FROM "player_stats_anomalies" WHERE "resolved_at" IS NULL`,
      [KIND_POINTS_MISMATCH, KIND_UNLABELLED_APPEARANCE]
    ),
    lastRun(JOB),
  ]);
  const { open: openCount, unlabelled } = counts.rows[0];
  const finishedAt = runs.latestOk ? runs.latestOk.finishedAt : null;
  const stale = !finishedAt || now.getTime() - finishedAt.getTime() > STALE_MS;
  return {
    ok: openCount === 0 && !stale,
    open: openCount,
    unlabelled,
    lastScanAt: finishedAt,
    stale,
  };
}

/**
 * The nightly scan as a Sync run per ADR 0036: one unit, no lock (nothing else
 * writes the anomalies table), so its data_sync_runs row is the freshness the
 * health route reads. The UTC day is computed once and carried as `detail.day`
 * on the recorded row. The scheduler's nightly-stats-integrity TICK_JOBS
 * row owns the gate; a thrown scan records a failed row and rethrows, so the
 * UTC day is never settled and the next tick retries.
 * Reaches `scanPlayerStats` through `module.exports` so a test stub bites.
 */
async function runIntegrityScan({ now = new Date() } = {}) {
  const today = cadence.utcDateKey(now);
  const { results: [result] } = await runSyncJob({
    job: JOB,
    fetch: async () => ({ units: [{}], detail: { day: today } }),
    apply: (client) => module.exports.scanPlayerStats({ db: client }),
  });
  if (result.open > 0) {
    console.warn(`scheduler: player_stats integrity scan found ${result.open} open anomaly(ies) over ${result.scanned} rows`);
  }
  return result;
}

module.exports = {
  scanPlayerStats, runIntegrityScan, getIntegrityStatus,
  JOB, KIND_POINTS_MISMATCH, KIND_UNLABELLED_APPEARANCE, STALE_MS,
};
