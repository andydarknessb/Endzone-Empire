const pool = require('./pool');
const { logger } = require('./logger');
const sentry = require('./sentry');

/**
 * Consecutive skips per lock id (#842). After #839 a skip can only mean another
 * process holds the lock, which a deploy overlap explains for a few seconds and
 * nothing explains for longer. The third consecutive skip raises one Sentry
 * event per streak (fingerprinted per lock id so a lock's streaks group); an
 * acquired tick ends the streak so the next one alarms again. In memory: a
 * restart starts the count over, which is the right answer for a fresh process.
 */
const SKIP_ALARM_STREAK = 3;
const skipStreaks = new Map();

function noteSkip(lockId, name) {
  const streak = (skipStreaks.get(lockId) || 0) + 1;
  skipStreaks.set(lockId, streak);
  logger.warn({ job: name, lockId, streak }, 'job skipped because another worker holds the lock');
  if (streak === SKIP_ALARM_STREAK) {
    sentry.captureError(
      new Error(`advisory lock ${lockId} (${name}) skipped ${streak} consecutive ticks`),
      { job: name, lockId, streak },
      { fingerprint: ['advisory-lock-skip', String(lockId)] }
    );
  }
}

/** Test seam: forget every streak. */
function resetSkipStreaks() {
  skipStreaks.clear();
}

/**
 * Run `work` while holding the advisory lock `lockId`, or skip it when another
 * worker holds the lock.
 *
 * The lock rides ONE explicit transaction on the checked-out client and is
 * transaction-scoped (pg_try_advisory_xact_lock), never session-scoped. This
 * is load-bearing behind a transaction-mode pooler (Supavisor on :6543, the
 * production path): outside a transaction the pooler may route each
 * statement to a different backend, so a session-level pg_try_advisory_lock
 * followed by pg_advisory_unlock on the same client unlocked on the WRONG
 * backend (a warning, not an error), stranded the lock on the first one, and
 * every later try-lock that landed anywhere else read "held". The draft-clock
 * sweep then skipped for minutes and a manager sat on an expired clock (#839).
 * A transaction pins its backend for its whole life in every pooler mode, and
 * an xact lock dies with the COMMIT/ROLLBACK, so it cannot outlive the tick.
 *
 * `work` runs while that transaction is open (the client is idle-in-
 * transaction for the tick's duration, pinning one backend per running tick);
 * the work itself queries through the shared pool as before, never through
 * this client.
 */
async function withAdvisoryLock(lockId, name, work) {
  const client = await pool.connect();
  let inTransaction = false;
  let failed = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const result = await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [lockId]);
    const locked = Boolean(result.rows[0]?.locked);
    if (!locked) {
      noteSkip(lockId, name);
      return { skipped: true };
    }
    skipStreaks.delete(lockId);
    try {
      return await work();
    } catch (error) {
      failed = true;
      throw error;
    }
  } finally {
    let closeFailed = false;
    if (inTransaction) {
      try {
        // Either statement releases the xact lock; ROLLBACK after a failed tick
        // keeps the intent legible. Nothing in this transaction is ever written.
        await client.query(failed ? 'ROLLBACK' : 'COMMIT');
      } catch (error) {
        closeFailed = true;
        logger.error(
          { err: error, job: name },
          'failed to close the advisory-lock transaction; destroying the connection so the lock is not leaked back into the pool'
        );
      }
    }
    // A connection whose transaction close failed may still sit in the lock
    // transaction. Returning it to the pool would leak the lock for as long as
    // the connection lived - no other worker could acquire it, and all expiry
    // processing would silently stop. Destroy it instead (release with an
    // error), so Postgres frees the session's locks on disconnect. A clean
    // close returns the connection to the pool as usual.
    client.release(closeFailed ? new Error('advisory-lock transaction close failed; connection destroyed') : undefined);
  }
}

module.exports = { withAdvisoryLock, resetSkipStreaks, SKIP_ALARM_STREAK };
