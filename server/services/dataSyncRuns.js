const pool = require('../modules/pool');

/**
 * Append one observable row to data_sync_runs for a background sync run (#961).
 * The shared writer behind every job that records itself: `job` is the caller's
 * free-text identifier (the migration's docblock treats a new job type as a new
 * string, not a migration), `started_at` is captured by the caller before its
 * upstream fetch, and `finished_at` is left to the column DEFAULT (now()), the
 * instant of this write.
 *
 * Extracted from adp.service.recordAdpRun (#961): the ADP service was the sole
 * writer of this table, and the injury sync now records the same way. It could
 * not require adp.service to reuse the helper - adp.service already requires
 * scoring.service (adp.service.js:5), so the reverse edge would close a cycle -
 * so the writer lives here, requiring only the pool, and both services call in.
 *
 * BEST-EFFORT BY CONSTRUCTION. A failure to record must never mask the real
 * outcome of a run: the sync may have completed correctly, and a thrown
 * observability write would turn that into a caller-visible error and, for the
 * scheduler, stop it day-stamping (re-running the full sync every tick). This
 * also covers the carve-out window - the migration that creates data_sync_runs
 * is applied by the maintainer, so the table may not exist yet when this code
 * is live. Swallowing here (rather than at each call site) keeps every caller
 * uniformly best-effort with no chance of the asymmetry creeping back.
 *
 * It writes on the POOL, never a caller's transaction client, so a failure row
 * survives the ROLLBACK of the run it describes: a record written on a
 * rolled-back client would be lost with it, and the whole point of the row is
 * that a failed run stops being invisible.
 */
async function recordDataSyncRun({ job, startedAt, ok, detail }) {
  try {
    await pool.query(
      `INSERT INTO "data_sync_runs" ("job", "started_at", "ok", "detail")
       VALUES ($1, $2, $3, $4::jsonb)`,
      [job, startedAt, ok, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error(`data_sync_runs record failed for ${job} (run outcome unaffected):`, err.message);
  }
}

module.exports = { recordDataSyncRun };
