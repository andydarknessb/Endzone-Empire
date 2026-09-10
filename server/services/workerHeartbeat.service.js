const pool = require('../modules/pool');

async function recordWorkerHeartbeat({ name, error = null, scheduler = null, liveGameEngine = null }) {
  // The same resolution order as /api/health's `release` field. Nullable on
  // purpose: a local worker has no release, and fabricating one would make
  // the health surface lie about provenance. Truncated to the column width.
  const raw = process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null;
  const release = raw ? String(raw).slice(0, 64) : null;
  const jobStatus = JSON.stringify({ scheduler, liveGameEngine });
  await pool.query(
    `INSERT INTO "worker_heartbeats" ("worker_name", "last_seen_at", "last_error", "release_sha", "job_status")
     VALUES ($1, now(), $2, $3, $4::jsonb)
     ON CONFLICT ("worker_name") DO UPDATE SET
       "last_seen_at" = now(),
       "last_error" = EXCLUDED."last_error",
       "release_sha" = EXCLUDED."release_sha",
       "job_status" = EXCLUDED."job_status",
       "updated_at" = now()`,
    [name, error ? String(error).slice(0, 500) : null, release, jobStatus]
  );
}

module.exports = { recordWorkerHeartbeat };
