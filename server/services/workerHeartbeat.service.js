const pool = require('../modules/pool');

async function recordWorkerHeartbeat({ name, error = null, scheduler = null, liveGameEngine = null }) {
  // The same resolution order as /api/health's `release` field. Nullable on
  // purpose: a local worker has no release, and fabricating one would make
  // the health surface lie about provenance. Truncated to the column width.
  const raw = process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null;
  const release = raw ? String(raw).slice(0, 64) : null;
  const jobStatus = JSON.stringify({ scheduler, liveGameEngine });
  // A process whose scheduler has not finished a tick yet keeps the stored tick
  // time, so a worker that dies inside every first tick still shows a tick
  // ageing toward health's stale check (#3039; 2026-11-23 crash loop).
  await pool.query(
    `INSERT INTO "worker_heartbeats" ("worker_name", "last_seen_at", "last_error", "release_sha", "job_status")
     VALUES ($1, now(), $2, $3, $4::jsonb)
     ON CONFLICT ("worker_name") DO UPDATE SET
       "last_seen_at" = now(),
       "last_error" = EXCLUDED."last_error",
       "release_sha" = EXCLUDED."release_sha",
       "job_status" = CASE
         WHEN EXCLUDED."job_status" #>> '{scheduler,lastTickAt}' IS NULL
           AND "worker_heartbeats"."job_status" #>> '{scheduler,lastTickAt}' IS NOT NULL
         THEN jsonb_set(EXCLUDED."job_status", '{scheduler,lastTickAt}', "worker_heartbeats"."job_status" #> '{scheduler,lastTickAt}')
         ELSE EXCLUDED."job_status"
       END,
       "updated_at" = now()`,
    [name, error ? String(error).slice(0, 500) : null, release, jobStatus]
  );
}

module.exports = { recordWorkerHeartbeat };
