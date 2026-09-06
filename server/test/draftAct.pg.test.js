/**
 * Disposable-Postgres proof for the Draft act module (#947, part of #938).
 *
 * The fast suite (draftAct.service.test.js) proves against a fakePool that
 * runDraftAct ISSUES the lock before the body's first mutation - a check on the
 * statement order the code emits. Only a real Postgres can show that the lock
 * SERIALIZES: that while another transaction holds the League row, runDraftAct's
 * mutation genuinely cannot land, and lands only once the holder releases. So
 * this gets a real database.
 *
 * The scenario: a holder transaction takes `SELECT ... FOR UPDATE` on the League
 * row and keeps it open. The REAL runDraftAct is invoked with a body that flips
 * draft_paused. Its own first statement after BEGIN is the same lock, so it
 * BLOCKS: the flip does not happen while the holder holds the row. When the
 * holder commits, runDraftAct unblocks, takes the lock, flips draft_paused, and
 * commits - the mutation observably waited on the lock.
 *
 * This is the module-level claim (criterion 1 property 1) under a real
 * connection, driven through runDraftAct itself rather than replayed statements,
 * so it is blind to nothing about how the module takes its lock.
 *
 * Gated twice, exactly like draftCorrection.pg.test.js: DRAFT_ACT_PG_TESTS=1 (or
 * the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must be
 * ABSENT, so a stray local run can never touch shared production. It self-skips
 * on a developer machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_ACT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft act PG lock test (skipped: set PG_TESTS=1 or DRAFT_ACT_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft act PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // runDraftAct uses the module-level pool singleton; with DATABASE_URL* absent
  // it reads the standard PG* variables - the disposable database. The same pool
  // serves seeding and the lock holder, so both contend on one real DB.
  const pool = require('../modules/pool');
  const { runDraftAct } = require('../services/draftAct.service');
  const { isLeagueCommissioner } = require('../services/leagueRole.service');
  const draftRoomBroadcast = require('../modules/draftRoomBroadcast');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });
  // A migration known to exist at latest, so a standalone local run knows whether
  // to migrate; in migration-smoke the schema is already there and this is a no-op.
  const REASON_MIGRATION = '20260826000007_draft_activity_correction_reason.js';

  let owner = null;
  let leagueId = null;

  const delay = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

  // runFanout resolves the room adapter after COMMIT; register a no-op recorder so
  // getDraftRoomBroadcast() does not throw (construction with no transport throws).
  let priorBroadcast;
  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: REASON_MIGRATION }).first();
    if (!applied) await knex.migrate.latest();

    priorBroadcast = draftRoomBroadcast.peekDraftRoomBroadcast();
    draftRoomBroadcast.setDraftRoomBroadcast({
      activityAppended: async () => ({ delivered: true }),
      stateChanged: async () => ({ delivered: true }),
      rosterChanged: async () => ({ delivered: true }),
      draftCompleted: async () => ({ delivered: true }),
      pickLanded: async () => ({ delivered: true }),
      scoresUpdated: async () => ({ delivered: true }),
    });

    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('draft_act_pg_owner', 'draft_act_pg_owner@example.invalid', 'x') RETURNING "id"`
    );
    owner = user.rows[0].id;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      ['Draft Act PG', owner, 'draftactpg']
    );
    leagueId = league.rows[0].id;
    // Active and unpaused: the act body's authorization (commissioner + active)
    // passes, so the only thing that can hold the flip back is the lock.
    await pool.query(
      `UPDATE "leagues" SET "draft_status" = 'active', "draft_paused" = false WHERE "id" = $1`,
      [leagueId]
    );
    await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position") VALUES ($1, $2, 'Alpha', 1)`,
      [leagueId, owner]
    );
  });

  test.after(async () => {
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (owner) await pool.query('DELETE FROM "users" WHERE "id" = $1', [owner]);
    draftRoomBroadcast.setDraftRoomBroadcast(priorBroadcast);
    await knex.destroy();
    await pool.end();
  });

  const pausedNow = async () => {
    const res = await pool.query('SELECT "draft_paused" FROM "leagues" WHERE "id" = $1', [leagueId]);
    return res.rows[0].draft_paused;
  };

  test('runDraftAct blocks on the League lock a holder holds, then flips draft_paused only after release', async () => {
    // A holder takes the League row lock, exactly the lock runDraftAct takes, and
    // keeps it open.
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE', [leagueId]);

    // The REAL act: a pause body that flips draft_paused. runDraftAct's first
    // statement after BEGIN is the same SELECT ... FOR UPDATE, so it blocks on the
    // row the holder holds.
    const actResult = runDraftAct({ leagueId, userId: owner }, async ({ client, league }) => {
      assert.equal(league.draft_status, 'active');
      assert.ok(await isLeagueCommissioner(client, leagueId, owner), 'owner is a commissioner');
      const upd = await client.query(
        `UPDATE "leagues" SET "draft_paused" = true, "updated_at" = now()
         WHERE "id" = $1 RETURNING "id", "draft_paused"`,
        [leagueId]
      );
      return { response: upd.rows[0], activity: [], broadcasts: ['stateChanged'] };
    }).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason })
    );

    // While the holder holds the lock, the act makes no progress and the flip has
    // not landed: the mutation is behind the lock.
    const whileBlocked = await Promise.race([actResult, delay(500).then(() => ({ status: 'blocked' }))]);
    assert.equal(whileBlocked.status, 'blocked', 'the act blocks while the holder holds the League lock');
    assert.equal(await pausedNow(), false, 'draft_paused has not flipped while the lock is held');

    // Release the lock; the act unblocks, takes it, and now the flip lands.
    await holder.query('ROLLBACK');
    holder.release();

    const settled = await actResult;
    assert.equal(settled.status, 'fulfilled', settled.reason && settled.reason.stack);
    // runDraftAct resolves to the act body's `response` itself (the router does
    // `const response = await runDraftAct(...); res.json(response)`), so the
    // resolved value IS { id, draft_paused } - not a wrapper with a `.response`.
    assert.deepEqual(settled.value, { id: leagueId, draft_paused: true });
    assert.equal(await pausedNow(), true, 'draft_paused flipped once the lock was free');
  });
}
