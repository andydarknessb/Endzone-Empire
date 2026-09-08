'use strict';

/**
 * withTransaction(pool, work, { label }) - the one place a pooled transaction
 * closes (ADR 0033).
 *
 * THE RULE, written once here so it is not hand-rolled at every call site: a
 * pooled transaction returns its connection to the pool on every healthy path
 * (COMMIT, or a clean ROLLBACK after work threw) and destroys the connection
 * ONLY when the ROLLBACK itself rejected. A rejecting ROLLBACK leaves the
 * transaction - and any transaction-scoped lock it holds - open on the socket;
 * returning that client to the pool hands the next borrower an open
 * transaction and strands the lock behind the transaction pooler (#839, #1053,
 * #1055). Releasing with an Error makes pg-pool drop the socket instead, so
 * Postgres rolls back and frees the session's locks on disconnect.
 *
 * It connects, BEGINs, runs `work(client)`, and:
 *   - on return: COMMITs and resolves to whatever work returned, released bare.
 *   - on throw: rolls back; if the ROLLBACK rejects, attaches that rejection as
 *     `error.rollbackError`, logs one line prefixed with `label`, and releases
 *     the client WITH an Error (destroy); if the ROLLBACK is clean, releases
 *     bare. Either way it rethrows the ORIGINAL error from work, never the
 *     rollback failure.
 *   - if `pool.connect()` itself rejects, nothing is rolled back or released
 *     and the rejection propagates untouched (the #1053 trap: never turn a
 *     connect failure into a TypeError that swallows the original error).
 *
 * `pool` is passed in so a test can hand it a createFakePool(); the wrapper
 * never requires the pool module itself. Retries, timeouts and savepoints are
 * out of scope by design - this owns the close, nothing more.
 */
async function withTransaction(pool, work, { label } = {}) {
  // Before any client exists: a connect failure propagates untouched.
  const client = await pool.connect();
  let rollbackError = null;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbError) {
      // Assign the hoisted variable that drives the destroy FIRST, before
      // attaching to the original error. A non-extensible thrown value
      // (Object.freeze({}), a primitive) makes the attach throw under strict
      // mode; assigning first (and tolerating the attach failure) keeps the
      // destroy path taken and rethrows the original value, never the attach
      // TypeError.
      rollbackError = rbError;
      try {
        error.rollbackError = rbError;
      } catch {
        // The original error cannot carry the rollback failure (frozen or a
        // primitive). The destroy path is already committed via rollbackError.
      }
      console.error(`[${label}] ROLLBACK failed after a transaction error: ${rbError.message}`);
    }
    throw error;
  } finally {
    // Destroy only when the ROLLBACK itself rejected; every other path
    // (COMMIT, clean ROLLBACK) returns the healthy connection bare.
    client.release(
      rollbackError
        ? new Error(`ROLLBACK failed; connection destroyed: ${rollbackError.message}`)
        : undefined
    );
  }
}

module.exports = { withTransaction };
