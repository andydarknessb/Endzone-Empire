const pool = require('./pool');
const { logger } = require('./logger');
const sentry = require('./sentry');

/**
 * The FIXED single-key advisory-lock ids, kept in one place so a new fixed id
 * does not silently collide with an existing one. Every id here is a
 * transaction-scoped lock (pg_advisory_xact_lock / pg_try_advisory_xact_lock);
 * none is session-scoped (#839).
 *
 *   23001 league-scheduler  (modules/scheduler.js, via withAdvisoryLock)
 *   23002 draft-clock       (modules/scheduler.js, via withAdvisoryLock)
 *   23003 live-game-engine  (modules/liveGameEngine.js, direct call)
 *   23004 players-bulk-write - serializes syncAdp and syncInjuries
 *         (services/scoring.service.js), the two original whole-players-table
 *         writers, so their opposite row-lock orders cannot deadlock (#904).
 *         Each issues a blocking pg_advisory_xact_lock(23004) as the first
 *         statement after its own BEGIN. #1204 added three more callers
 *         through server/modules/syncRun.js's `runSyncJob` (same blocking
 *         form, issued as the first statement inside each unit's own
 *         transaction): jobs 'players' and 'team-defenses' (both write
 *         `players`) and 'season-stats' (writes `player_season_stats`, NOT
 *         `players` - it shares this lock only because it, `syncPlayers` and
 *         `syncTeamDefenses` are triggered from the same admin surface and
 *         #1204 grouped them under one key rather than mint a fourth).
 *         #1251 added a sixth caller: `sleeper.service.js`'s
 *         `syncSeasonStats`, the OTHER writer of `player_season_stats`, now
 *         takes this same lock directly (not through `runSyncJob` - it stays
 *         off `data_sync_runs`) inside its own `withTransaction`, blocking on
 *         the same `pg_advisory_xact_lock(23004)` as its first statement, so
 *         it serializes against `season-stats` instead of racing it to a
 *         deadlock (both bulk-`unnest` upserts now hold their row locks to
 *         COMMIT). Same lock, not a new id, because it is the same table
 *         family and ADR 0036 already says players-table writers share it.
 *         Full writer list: syncAdp, syncInjuries, syncPlayers,
 *         syncPlayerSeasonStats, syncTeamDefenses (through `runSyncJob`) and
 *         Sleeper's syncSeasonStats (direct, own transaction).
 *   23005 nfl-games-bulk-write - serializes the two whole-nfl_games-table
 *         SYNC writers, syncSchedule (Tank01, services/scoring.service.js, job
 *         'schedule') and syncScheduleFromNflverse
 *         (services/nflverseSync.service.js, job 'schedule-nflverse'), so a
 *         Tank01 run and an nflverse run started together cannot interleave
 *         their per-row upserts of the same season's games (#1203). (Not the
 *         one-off scripts/repair-schedule-orientation.js repair tool: it only
 *         ever null-only UPDATEs game_key/home_away/neutral_site, guarded by
 *         IS NULL, never nfl_team/opponent/kickoff_at and never an INSERT, so
 *         it does not compete with either sync writer.) Taken as
 *         `lock` by server/modules/syncRun.js's `runSyncJob`, which issues the
 *         blocking pg_advisory_xact_lock(23005) as the first statement inside
 *         each unit's own transaction - a concurrent run WAITS for the lock
 *         rather than silently interleaving its writes.
 *
 * Only 23001 and 23002 are taken through withAdvisoryLock; 23003, 23004 and
 * 23005 call pg_advisory_xact_lock / pg_try_advisory_xact_lock directly.
 * 23004 and 23005 deliberately do NOT use the helper: withAdvisoryLock is
 * try-and-skip on its own client, but these writers must WAIT for the lock
 * rather than skip (until the holder's transaction ends, or until
 * statement_timeout cancels the wait with SQLSTATE 57014 - see the call-site
 * comments and #929), and the lock must live inside each writer's own
 * transaction.
 *
 * SHARED KEYSPACE. The single-key form is one flat bigint namespace, so any
 * OTHER single-key advisory lock shares it with the ids above. The one other
 * single-key call site is holdout.service.js (pg_advisory_xact_lock(hashtext(id))),
 * whose key is a hash of the capture identity, not a small fixed integer - it
 * will not collide with 23001-23005 in practice, but a new FIXED id must still be
 * chosen from this block. The weekly-trophy-engine SQL
 * (server/db/sql/2026-07-20-weekly-trophy-engine.sql) uses the TWO-key
 * (int4, int4) form, which Postgres keeps in a separate keyspace from the
 * single-key form, so it cannot collide with anything here.
 */
const PLAYERS_BULK_WRITE_LOCK = 23004;
const NFL_GAMES_BULK_WRITE_LOCK = 23005;

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

module.exports = {
  withAdvisoryLock,
  resetSkipStreaks,
  SKIP_ALARM_STREAK,
  PLAYERS_BULK_WRITE_LOCK,
  NFL_GAMES_BULK_WRITE_LOCK,
};
