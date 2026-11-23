/**
 * Worker heartbeat against real Postgres (#3039): a heartbeat whose scheduler has
 * not finished a tick in this process keeps the last tick time the row already
 * holds. On 2026-11-23 the worker crash-looped for 13 hours, each process dying
 * inside its first tick, so every heartbeat wrote lastTickAt null and the
 * tick-stale check (#2758, health.router) never had a time to age.
 *
 * Gated like leagueCreate.pg.test.js: PG_TESTS=1 (or WORKER_HEARTBEAT_PG_TESTS=1)
 * must be set and every DATABASE_URL* variable absent. It self-skips on a developer
 * machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.WORKER_HEARTBEAT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('worker heartbeat PG test (skipped: set PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('worker heartbeat PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  const pool = require('../modules/pool');
  const { recordWorkerHeartbeat } = require('../services/workerHeartbeat.service');
  const knex = require('knex')({
    client: 'pg',
    connection: {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    },
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });
  const NAME = 'heartbeat-pg-test';

  async function storedTickAt() {
    const res = await pool.query(
      `SELECT "job_status" #>> '{scheduler,lastTickAt}' AS "tick" FROM "worker_heartbeats" WHERE "worker_name" = $1`,
      [NAME]
    );
    return res.rows[0].tick;
  }

  test.before(async () => {
    await knex.migrate.latest();
    await pool.query('DELETE FROM "worker_heartbeats" WHERE "worker_name" = $1', [NAME]);
  });

  test.after(async () => {
    await pool.query('DELETE FROM "worker_heartbeats" WHERE "worker_name" = $1', [NAME]);
    await knex.destroy();
    await pool.end();
  });

  test('a heartbeat with no tick yet keeps the stored lastTickAt; a new tick replaces it', async () => {
    await recordWorkerHeartbeat({ name: NAME, scheduler: { lastTickAt: '2026-11-23T01:37:00.000Z', lastTickError: null } });
    await recordWorkerHeartbeat({ name: NAME, scheduler: { lastTickAt: null, lastTickError: null } });
    assert.equal(await storedTickAt(), '2026-11-23T01:37:00.000Z', 'a restarted process has not ticked: the old tick keeps ageing');

    await recordWorkerHeartbeat({ name: NAME, scheduler: { lastTickAt: '2026-11-23T15:15:13.034Z', lastTickError: null } });
    assert.equal(await storedTickAt(), '2026-11-23T15:15:13.034Z');
  });

  test('a heartbeat with no scheduler snapshot writes it as given', async () => {
    await recordWorkerHeartbeat({ name: NAME, scheduler: null });
    const res = await pool.query(`SELECT "job_status" FROM "worker_heartbeats" WHERE "worker_name" = $1`, [NAME]);
    assert.deepEqual(res.rows[0].job_status, { scheduler: null, liveGameEngine: null });
  });
}
