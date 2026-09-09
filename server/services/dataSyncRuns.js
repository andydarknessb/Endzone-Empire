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
 * scheduler, stop it day-stamping (re-running the full sync every tick). That
 * is the whole and durable reason to swallow here (rather than at each call
 * site): it keeps every caller uniformly best-effort with no chance of the
 * asymmetry creeping back. (A now-expired second reason once rode along: when
 * recordAdpRun first landed, the data_sync_runs migration had not yet been
 * applied, so the table could be absent. It is applied now - present on the
 * shared database, recorded in knex_migrations - so that window is history and
 * is not a reason to keep or weaken the swallow.)
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
    // Constant format string with job as a %s argument, not an interpolated
    // template: interpolating a caller-supplied value trips semgrep's
    // unsafe-formatstring rule, and this shared file would otherwise re-fire it
    // on every future scan. Renders byte-identically to the old adp literal:
    // "data_sync_runs record failed for adp (run outcome unaffected):".
    console.error('data_sync_runs record failed for %s (run outcome unaffected):', job, err.message);
  }
}

module.exports = { recordDataSyncRun };
