/**
 * Disposable-Postgres tests for the schedule Sync run pair (#1203, ADR 0036):
 * syncSchedule (Tank01, job 'schedule') and syncScheduleFromNflverse
 * (job 'schedule-nflverse') both write nfl_games through runSyncJob, sharing
 * NFL_GAMES_BULK_WRITE_LOCK (23005, server/modules/advisoryLock.js).
 *
 * The two claims a matcher fake (fakePool, used in scoring.service.test.js
 * and nflverseSync.service.test.js) cannot prove against real Postgres — the
 * issue's own red-tells:
 *
 *   1. A run whose apply throws after some games have already been upserted
 *      leaves nfl_games byte-identical to before: the whole unit's write is
 *      one transaction (ADR 0033), so a later game's real constraint
 *      violation (the Team-code unique index, #421) rolls back the earlier
 *      games in the SAME run too, not just the offending one.
 *   2. A Tank01 run and an nflverse run started together serialize: the
 *      second's write does not start until the first's transaction commits
 *      and releases 23005 - proving both call sites actually share the same
 *      lock id, which a generic runSyncJob test (syncRun.pg.test.js) cannot
 *      show since it never calls these two functions.
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file SCHEDULESYNC_PG_TESTS=1) must be set, and every DATABASE_URL*
 * variable must be ABSENT - connections are built from PG* variables only
 * (via the app's own server/modules/pool, the same pool runSyncJob itself
 * uses), so a stray local run can never touch the shared production
 * database. Locally these report as a visible SKIP, never a silent green.
 * CI's migration-smoke job (postgres:17 service, every migration applied) is
 * the binding run.
 *
 * Run with `node --test server/test/scheduleSync.pg.test.js` (needs
 * PG_TESTS=1), alongside `node --test server/test/scheduleSync.route.test.js`
 * (red-tell 3: the route tests keep passing unchanged).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const ENABLED = process.env.PG_TESTS === '1' || process.env.SCHEDULESYNC_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
const missingPgDatabase = !process.env.PGDATABASE;

if (!ENABLED) {
  test('scheduleSync PG tests (skipped: set PG_TESTS=1 or SCHEDULESYNC_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('scheduleSync PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (missingPgDatabase) {
  test('scheduleSync PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database - '
      + 'this file connects through server/modules/pool.js, which falls back to the local dev '
      + 'database name ("endzone_empire") when PGDATABASE is unset, and these tests write and delete real rows');
  });
} else {
  // The same pool runSyncJob itself requires, connected from PG* env - the
  // advisory lock this file observes is the SAME lock syncSchedule and
  // syncScheduleFromNflverse take.
  const pool = require('../modules/pool');
  const { syncSchedule } = require('../services/scoring.service');
  const { syncScheduleFromNflverse } = require('../services/nflverseSync.service');

  // Disposable-DB-only season numbers, well outside any real NFL season, so
  // cleanup is exact and never touches another pg test file's fixtures.
  const ROLLBACK_SEASON = 900201;
  const LOCK_SEASON_TANK01 = 900202;
  const LOCK_SEASON_NFLVERSE = 900203;

  // Unlike the other *.pg.test.js files, this one's data_sync_runs cleanup
  // cannot filter by a test-only job literal (syncRun.pg.test.js's pattern):
  // syncSchedule/syncScheduleFromNflverse always record the real 'schedule'/
  // 'schedule-nflverse' job names, and a failed run's detail carries no
  // season to filter on either. Bounding by started_at instead keeps the
  // final cleanup exact to what THIS file's own runs wrote, rather than also
  // deleting any pre-existing 'schedule'/'schedule-nflverse' history a
  // developer's disposable database already had.
  const fileStartedAt = new Date();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitUntil(predicate, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await sleep(10);
    }
    return false;
  }

  // Same technique syncRun.pg.test.js and teamInsertLock.pg.test.js use to
  // prove a block is real rather than a race this test happened to win.
  async function waitForBlockedLock() {
    return waitUntil(async () => {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`
      );
      return res.rows[0].n > 0;
    });
  }

  // pg_locks represents a single-bigint advisory lock (pg_advisory_xact_lock(23005),
  // exactly what runSyncJob issues) as classid = high 32 bits of the key (0
  // here), objid = low 32 bits (23005), objsubid = 1 - distinct from the
  // two-int4-argument form (objsubid 2) nothing here uses. All three narrow
  // this to THE lock NFL_GAMES_BULK_WRITE_LOCK names, not any other advisory
  // lock (23001-23004, holdout.service.js's hashed id) that happened to be held.
  async function lockHeldByOther() {
    return waitUntil(async () => {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE locktype = 'advisory' AND classid = 0 AND objid = 23005 AND objsubid = 1
            AND granted = true AND pid <> pg_backend_pid()`
      );
      return res.rows[0].n > 0;
    });
  }

  async function clearSeason(season) {
    await pool.query(`DELETE FROM "nfl_games" WHERE "season" = $1`, [season]);
  }

  test.after(async () => {
    try {
      await clearSeason(ROLLBACK_SEASON);
      await clearSeason(LOCK_SEASON_TANK01);
      await clearSeason(LOCK_SEASON_NFLVERSE);
      // Every data_sync_runs row this file's two jobs wrote since it started -
      // bounded by started_at (not season, which a failed run's detail may
      // omit) so a developer's disposable database keeps any 'schedule'/
      // 'schedule-nflverse' history that predates this run.
      await pool.query(
        `DELETE FROM "data_sync_runs" WHERE "job" IN ('schedule', 'schedule-nflverse') AND "started_at" >= $1`,
        [fileStartedAt]
      );
    } finally {
      await pool.end();
    }
  });

  // Red-tell 1: remove withTransaction from runSyncJob's per-unit apply (or
  // call syncSchedule against the bare pool instead of the transaction
  // client) and this goes red - week 1's rows survive despite week 2's real
  // constraint violation later in the SAME run.
  test('syncSchedule: a later game that violates a real constraint rolls back the whole run, including earlier games already upserted', async () => {
    await clearSeason(ROLLBACK_SEASON);
    // Pre-seed a Team-code collision (#421) for week 2: WAS already has a row
    // there, so week 2's fetched game (home 'WSH', which folds to the SAME
    // Team code) fails its INSERT with a real 23505 from Postgres.
    await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       VALUES ($1, 2, 'WAS', 'DAL', $2)`,
      [ROLLBACK_SEASON, new Date('2026-09-14T17:00:00Z')]
    );
    const before = (await pool.query(
      `SELECT "season", "week", "nfl_team", "opponent" FROM "nfl_games" WHERE "season" = $1 ORDER BY "week", "nfl_team"`,
      [ROLLBACK_SEASON]
    )).rows;

    const api = async (path, opts) => {
      const { week } = opts.params;
      if (week === 1) {
        return { data: { body: [{ home: 'NYJ', away: 'BUF', gameTime_epoch: '1700000000' }] } };
      }
      if (week === 2) {
        // Folds to the same Team code as the pre-seeded 'WAS' row above.
        return { data: { body: [{ home: 'WSH', away: 'DAL', gameTime_epoch: '1700003600' }] } };
      }
      return { data: { body: [] } };
    };

    await assert.rejects(syncSchedule({ season: ROLLBACK_SEASON, api }), (err) => {
      assert.equal(err.code, '23505', 'the real Team-code unique index rejects the second WAS/WSH row for the week');
      return true;
    });

    const after = (await pool.query(
      `SELECT "season", "week", "nfl_team", "opponent" FROM "nfl_games" WHERE "season" = $1 ORDER BY "week", "nfl_team"`,
      [ROLLBACK_SEASON]
    )).rows;
    assert.deepEqual(after, before, 'week 1\'s NYJ/BUF rows never persisted: the whole unit rolled back together with week 2\'s conflict');
  });

  // Red-tell 2: remove NFL_GAMES_BULK_WRITE_LOCK from either syncSchedule's
  // or syncScheduleFromNflverse's runSyncJob call (or give them different
  // lock ids) and this goes red - the nflverse run's write starts, and
  // finishes writing rows, while the Tank01 run's transaction is still open.
  test('syncSchedule and syncScheduleFromNflverse started together serialize: the second\'s write does not start until the first commits', async (t) => {
    await clearSeason(LOCK_SEASON_TANK01);
    await clearSeason(LOCK_SEASON_NFLVERSE);

    // A big enough single week that the write transaction (hundreds of
    // sequential upserts on the SAME lock-holding connection) stays open long
    // enough to observe mid-flight; every other week is empty and fast, so
    // the fetch phase itself (outside the lock) stays quick. Keep this well
    // under pool.js's statement_timeout (15s web / 30s worker): run B's own
    // lock-wait is a statement on that same timeout, so a GAME_COUNT large
    // enough to push run A's transaction past it would fail run B with
    // SQLSTATE 57014 instead of proving anything about the lock.
    const GAME_COUNT = 400;
    const bigWeek = Array.from({ length: GAME_COUNT }, (_, i) => ({
      home: `H${i}`, away: `A${i}`, gameTime_epoch: String(1700000000 + i),
    }));
    const tank01Api = async (path, opts) => ({
      data: { body: opts.params.week === 1 ? bigWeek : [] },
    });

    const csv = [
      'game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,roof,surface,stadium',
      `2026_18_SF_ARI,${LOCK_SEASON_NFLVERSE},REG,18,2027-01-10,Sunday,13:00,SF,,ARI,,closed,grass,State Farm Stadium`,
    ].join('\n');
    t.mock.method(axios, 'get', async () => ({ data: csv }));

    const runA = syncSchedule({ season: LOCK_SEASON_TANK01, api: tank01Api });
    let runB = null;

    try {
      assert.ok(
        await lockHeldByOther(),
        'run A (Tank01) reached its write transaction and is holding NFL_GAMES_BULK_WRITE_LOCK (23005)'
      );

      runB = syncScheduleFromNflverse({ season: LOCK_SEASON_NFLVERSE });

      assert.ok(await waitForBlockedLock(), 'run B is blocked waiting for the lock run A still holds');
      const midflightB = (await pool.query(
        `SELECT count(*)::int AS n FROM "nfl_games" WHERE "season" = $1`,
        [LOCK_SEASON_NFLVERSE]
      )).rows[0].n;
      assert.equal(midflightB, 0, 'run B has written nothing while still blocked on the lock run A holds');

      await runA;
      await runB;

      const [countA, countB] = await Promise.all([
        pool.query(`SELECT count(*)::int AS n FROM "nfl_games" WHERE "season" = $1`, [LOCK_SEASON_TANK01]),
        pool.query(`SELECT count(*)::int AS n FROM "nfl_games" WHERE "season" = $1`, [LOCK_SEASON_NFLVERSE]),
      ]);
      assert.equal(countA.rows[0].n, GAME_COUNT * 2, 'run A wrote both perspectives of every fetched game');
      assert.ok(countB.rows[0].n > 0, 'run B went on to write its own rows once the lock freed');
    } finally {
      // Always drain both promises, even when an assertion above threw (in
      // particular the `waitForBlockedLock`/`lockHeldByOther` assertions this
      // red-tell exists to catch): an unresolved runB would still be blocked
      // on A's lock, and letting it dangle risks it settling after
      // test.after's pool.end() tears the pool down mid-query.
      await runA.catch(() => {});
      if (runB) await runB.catch(() => {});
    }
  });
}
