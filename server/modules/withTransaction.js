'use strict';

/**
 * withTransaction(pool, work, { label }) - the one place a pooled transaction
 * closes (ADR 0033).
 *
 * THE RULE, written once here so it is not hand-rolled at every call site: a
 * pooled transaction returns its connection to the pool on every healthy path
 * (COMMIT, or a clean ROLLBACK after work threw) and destroys the connection
 * whenever - and only whenever - the ROLLBACK itself rejected. A rejecting
 * ROLLBACK leaves the transaction, and any transaction-scoped lock it holds,
 * open on the socket; returning that client to the pool hands the next borrower
 * an open transaction and strands the lock behind the transaction pooler (#839,
 * #1053, #1055). Releasing with an Error makes pg-pool drop the socket instead,
 * so Postgres rolls back and frees the session's locks on disconnect.
 *
 * It connects, BEGINs, runs `work(client)`, and:
 *   - on return: COMMITs and resolves to whatever work returned, released bare.
 *   - on throw: rolls back; if the ROLLBACK rejects, records the failure (drives
 *     the destroy off a boolean, NOT off the rejection's truthiness), attaches
 *     the rejection as `error.rollbackError`, logs one line prefixed with
 *     `label`, and releases the client WITH an Error (destroy); if the ROLLBACK
 *     is clean, releases bare. Either way it rethrows the ORIGINAL error from
 *     work, never the rollback failure - even when that failure is a falsy or
 *     non-Error value.
 *   - if `pool.connect()` itself rejects, nothing is rolled back or released
 *     and the rejection propagates untouched (the #1053 trap: never turn a
 *     connect failure into a TypeError that swallows the original error).
 *
 * `pool` is passed in so a test can hand it a createFakePool(); the wrapper
 * never requires the pool module itself. Retries, timeouts and savepoints are
 * out of scope by design - this owns the close, nothing more.
 *
 * MISUSE the wrapper does not defend against (documented before #1061 routes
 * ~81 sites through it, since none of these throws where it happens):
 *   - `work` issuing its own COMMIT/ROLLBACK: the wrapper's own COMMIT then runs
 *     against a closed transaction (Postgres answers a redundant COMMIT with a
 *     warning, not an error). A bare ROLLBACK inside `work` that then returns
 *     normally silently discards the writes and COMMITs nothing - exactly the
 *     shape this ticket removed from generateMatchups. `work` must neither BEGIN,
 *     COMMIT nor ROLLBACK; it does the work and returns or throws.
 *   - `work` querying the ambient pool instead of the passed `client`: that runs
 *     outside the transaction, on a different connection. Always use the argument.
 *   - a nested withTransaction on the same pool: it checks out a SECOND client
 *     and opens an independent transaction, not a savepoint. Do not nest.
 */
async function withTransaction(pool, work, { label = 'withTransaction' } = {}) {
  // Before any client exists: a connect failure propagates untouched.
  const client = await pool.connect();
  // Drive the destroy off a boolean, never off the rejection value's
  // truthiness: a ROLLBACK that rejects with null/undefined/0/''/false/NaN still
  // failed, and the connection must still be destroyed (advisoryLock.js:111
  // keys the identical decision on a boolean for the same reason).
  let rollbackFailed = false;
  let rollbackErrorMessage = null;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbError) {
      // Set the destroy flag FIRST, before anything that can throw, so the
      // destroy path is taken no matter what the rejection value is. Read the
      // message defensively (a null/undefined/primitive rejection has none) so
      // the log line cannot throw and skip the `throw error` below (#1048).
      rollbackFailed = true;
      rollbackErrorMessage = rbError && rbError.message ? rbError.message : String(rbError);
      try {
        // A non-extensible original value (Object.freeze({}), a primitive)
        // cannot carry this; tolerated, the destroy is already committed.
        error.rollbackError = rbError;
      } catch {
        /* original value cannot carry the rollback failure */
      }
      console.error(`[${label}] ROLLBACK failed after a transaction error: ${rollbackErrorMessage}`);
    }
    throw error;
  } finally {
    // Destroy whenever the ROLLBACK rejected; every other path (COMMIT, clean
    // ROLLBACK) returns the healthy connection bare. The release itself is
    // guarded: a throw here (a double release from a half-converted #1061
    // caller that kept its own release) must never mask the value or error this
    // function is already returning or throwing.
    try {
      client.release(
        rollbackFailed
          ? new Error(`[${label}] ROLLBACK failed; connection destroyed: ${rollbackErrorMessage}`)
          : undefined
      );
    } catch (releaseError) {
      console.error(`[${label}] client.release failed: ${releaseError && releaseError.message}`);
    }
  }
}

module.exports = { withTransaction };
