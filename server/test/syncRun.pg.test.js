/**
 * Disposable-Postgres tests for the Sync run module (#1200, ADR 0036).
 *
 * `runSyncJob`'s two load-bearing properties are both claims about real
 * Postgres that a matcher fake (fakePool) cannot express:
 *
 *   1. The job's lock actually serializes two runs. fakePool has no blocking
 *      and no second connection, so it can prove the module ISSUES the
 *      `SELECT pg_advisory_xact_lock` statement in the right place, but not
 *      that a second run actually WAITS on it.
 *   2. `withTransaction` actually rolls back. fakePool records the ROLLBACK
 *      call but never touches a real row, so it cannot prove a throw from
 *      `apply` leaves a written row byte-identical to before.
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file SYNCRUN_PG_TESTS=1) must be set, and every DATABASE_URL* variable
 * must be ABSENT - connections are built from PG* variables only (via the
 * app's own server/modules/pool, the same pool runSyncJob itself uses), so a
 * stray local run can never touch the shared production database. Locally
 * these report as a visible SKIP, never a silent green. CI's migration-smoke
 * job (postgres:17 service, every migration applied) is the binding run.
 *
 * Run with `node --test server/test/syncRun.pg.test.js` (needs PG_TESTS=1)
 * alongside `node --test server/test/injury.test.js` (red-tell 3: injury.test.js
 * keeps passing now that syncInjuries runs through this module).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.SYNCRUN_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('syncRun PG tests (skipped: set PG_TESTS=1 or SYNCRUN_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('syncRun PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // The same pool runSyncJob itself requires: connects from PG* env, exactly
  // the app's own wiring (server/modules/pool.js), so the advisory lock this
  // test observes from a second query is the SAME lock runSyncJob takes.
  const pool = require('../modules/pool');
  const { runSyncJob, lastRun } = require('../modules/syncRun');

  // A disposable-DB-only advisory lock id. Not one of advisoryLock.js's fixed
  // ids (23001-23004): this runs against a throwaway migration-smoke database,
  // never the shared one those ids are reserved against.
  const TEST_LOCK = 900101;
  const seededPlayers = [];
  const seededJobs = [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitUntil(predicate, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await sleep(25);
    }
    return false;
  }

  // Waits until some OTHER backend on this database is blocked on a lock -
  // the same technique teamInsertLock.pg.test.js uses to prove a block is
  // real rather than a race this test happened to win.
  async function waitForBlockedLock(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`
      );
      if (res.rows[0].n > 0) return true;
      await sleep(50);
    }
    return false;
  }

  test.after(async () => {
    try {
      for (const id of seededPlayers) {
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [id]);
      }
      for (const job of seededJobs) {
        await pool.query(`DELETE FROM "data_sync_runs" WHERE "job" = $1`, [job]);
      }
    } finally {
      await pool.end();
    }
  });

  // Red-tell 1: remove the `if (lock) await client.query('SELECT
  // pg_advisory_xact_lock($1)', [lock])` line from runSyncJob and this goes
  // red - B's apply starts immediately instead of waiting for A to commit.
  test('two runs sharing a lock serialize: the second\'s apply does not start until the first commits', async () => {
    let aApplyStarted = false;
    let releaseA;
    const gate = new Promise((resolve) => { releaseA = resolve; });
    let bApplyStarted = false;

    const runA = runSyncJob({
      job: 'syncrun-pgtest-lock-a',
      lock: TEST_LOCK,
      fetch: async () => [1],
      apply: async () => {
        aApplyStarted = true;
        await gate;
        return { ok: true };
      },
    });
    seededJobs.push('syncrun-pgtest-lock-a', 'syncrun-pgtest-lock-b');

    assert.ok(await waitUntil(() => aApplyStarted), 'run A reached apply and is holding the lock');

    const runB = runSyncJob({
      job: 'syncrun-pgtest-lock-b',
      lock: TEST_LOCK,
      fetch: async () => [1],
      apply: async () => {
        bApplyStarted = true;
        return { ok: true };
      },
    });

    const blocked = await waitForBlockedLock();
    assert.ok(blocked, 'B is blocked waiting for the lock A still holds');
    assert.equal(bApplyStarted, false, 'B\'s apply has not run while A still holds the lock');

    releaseA();
    await runA;
    await runB;
    assert.equal(bApplyStarted, true, 'B\'s apply ran once A committed and released the lock');
  });

  // Red-tell 2: remove `withTransaction` from runSyncJob's per-unit apply
  // (querying the client directly with no BEGIN/COMMIT/ROLLBACK around it)
  // and this goes red - the UPDATE below survives despite the throw.
  test('an apply throw rolls back: the written row is byte-identical after, and the run records write_failed', async () => {
    const insertRes = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'RB', 'MIN') RETURNING *`,
      [`syncrun-pgtest-${Date.now()}`]
    );
    const before = insertRes.rows[0];
    seededPlayers.push(before.id);
    const job = 'syncrun-pgtest-write-failed';
    seededJobs.push(job);

    await assert.rejects(
      runSyncJob({
        job,
        lock: null,
        fetch: async () => [1],
        apply: async (client) => {
          await client.query(`UPDATE "players" SET "nfl_team" = 'ZZZ' WHERE "id" = $1`, [before.id]);
          throw new Error('apply exploded');
        },
      }),
      /apply exploded/,
    );

    const after = (await pool.query(`SELECT * FROM "players" WHERE "id" = $1`, [before.id])).rows[0];
    assert.deepEqual(after, before, 'the row is byte-identical to its pre-run snapshot: the failed apply rolled back');

    const { latest } = await lastRun(job);
    assert.equal(latest.ok, false);
    assert.equal(latest.detail.reason, 'write_failed');
    assert.equal(latest.detail.failed[0].message, 'apply exploded');
  });

  test('lastRun(job) reports the latest run and the latest successful one separately', async () => {
    const job = `syncrun-pgtest-lastrun-${Date.now()}`;
    seededJobs.push(job);

    await runSyncJob({ job, lock: null, fetch: async () => [1], apply: async () => ({ n: 1 }) });
    await assert.rejects(
      runSyncJob({ job, lock: null, fetch: async () => { throw new Error('nope'); }, apply: async () => {} })
    );

    const { latest, latestOk } = await lastRun(job);
    assert.equal(latest.ok, false, 'the most recent run failed');
    assert.equal(latestOk.ok, true, 'the most recent SUCCESSFUL run is the earlier one');
    assert.ok(latestOk.finishedAt <= latest.finishedAt);
  });
}
