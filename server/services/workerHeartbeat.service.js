const pool = require('../modules/pool');

async function recordWorkerHeartbeat({ name, error = null }) {
  await pool.query(
    `INSERT INTO "worker_heartbeats" ("worker_name", "last_seen_at", "last_error")
     VALUES ($1, now(), $2)
     ON CONFLICT ("worker_name") DO UPDATE SET
       "last_seen_at" = now(),
       "last_error" = EXCLUDED."last_error",
       "updated_at" = now()`,
    [name, error ? String(error).slice(0, 500) : null]
  );
}

module.exports = { recordWorkerHeartbeat };
