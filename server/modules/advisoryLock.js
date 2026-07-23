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
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch((error) => {
        logger.error({ err: error, job: name }, 'failed to release advisory lock');
      });
    }
    client.release();
  }
}

module.exports = { withAdvisoryLock };
