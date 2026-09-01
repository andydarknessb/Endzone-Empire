const pool = require('./pool');
const { logger } = require('./logger');

async function withAdvisoryLock(lockId, name, work) {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockId]);
    locked = Boolean(result.rows[0]?.locked);
    if (!locked) {
      logger.debug({ job: name }, 'job skipped because another worker holds the lock');
      return { skipped: true };
    }
    return await work();
  } finally {
    let unlockFailed = false;
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      } catch (error) {
        unlockFailed = true;
        logger.error(
          { err: error, job: name },
          'failed to release advisory lock; destroying the connection so the lock is not leaked back into the pool'
        );
      }
    }
    // A connection whose advisory unlock failed may still hold the lock. Returning
    // it to the pool would leak the lock forever - no other worker could acquire
    // it, and all expiry processing would silently stop. Destroy it instead
    // (release with an error), so Postgres frees the session's locks on
    // disconnect. A clean unlock returns the connection to the pool as usual.
    client.release(unlockFailed ? new Error('advisory unlock failed; connection destroyed') : undefined);
  }
}

module.exports = { withAdvisoryLock };
