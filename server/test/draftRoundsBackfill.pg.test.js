/**
 * Disposable-Postgres test for the draft_rounds backfill migration
 * (20260822000001_fix_draft_rounds_at_start.js, ADR 0005) -- the one piece
 * of #118 the mocked unit tests can't prove: that the migration's UPDATE
 * actually backfills existing active/completed leagues' draft_rounds from
 * their stored roster_limit/ir_slots, leaves pending leagues null, and
 * that reapplying it from a rolled-back state is idempotent-safe (the
 * migrate/rollback/migrate smoke above this test in CI never exercises the
 * backfill's WHERE/UPDATE logic, since it runs against an empty leagues
 * table).
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: DRAFT_ROUNDS_PG_TESTS=1 must be set explicitly, and every
 * DATABASE_URL* variable must be ABSENT -- connections are built from PG*
 * variables only, so a stray local run can never touch the shared
 * production database (server/knexfile.js loads .env; this file
 * deliberately does not). Mirrors holdout.pg.test.js's gating exactly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_ROUNDS_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft_rounds backfill PG tests (skipped: set PG_TESTS=1 or DRAFT_ROUNDS_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft_rounds backfill PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} — these tests must only ever see a disposable PG* database`);
  });
} else {
  // TEMPORARY red-proof for #371: a deliberate failure inside an ENABLED pg
  // block, so migration-smoke (PG_TESTS=1) goes red while test:server stays
  // green. Dropped before merge.
  test('#371 red-proof: a broken pg test turns migration-smoke red', () => {
    assert.equal(1, 2, 'deliberate temporary failure to prove migration-smoke catches it');
  });
  const pg = require('pg');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const pool = new pg.Pool({ ...connection, max: 2 });
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });

  const MIGRATION_NAME = '20260822000001_fix_draft_rounds_at_start.js';
  let seededUserId = null;
  let seededLeagueIds = [];

  test.before(async () => {
    // The migrate/rollback/migrate smoke earlier in the CI job already left
    // every migration (including this one) applied. Roll THIS ONE migration
    // back on its own so its up() can be re-run against seeded legacy rows,
    // exactly as it would run against a real pre-#118 database.
    await knex.migrate.down({ name: MIGRATION_NAME });
    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('draft_rounds_pg_test', 'draft-rounds-pg-test@example.invalid', 'x')
       RETURNING "id"`
    );
    seededUserId = user.rows[0].id;
  });

  test.after(async () => {
    // Clean up the seeded rows and leave the schema fully migrated again
    // (knex_migrations row restored) so later CI steps in this job
    // (test:backtest-pg, test:holdout-pg) see the same fully-migrated
    // database the earlier `npm run migrate` step produced.
    if (seededLeagueIds.length > 0) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [seededLeagueIds]);
    }
    if (seededUserId != null) {
      await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [seededUserId]);
    }
    await knex.migrate.up({ name: MIGRATION_NAME });
    await pool.end();
    await knex.destroy();
  });

  test('the backfill fixes draft_rounds for active/completed legacy leagues and leaves pending null', async () => {
    const seeded = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "draft_status", "roster_limit", "ir_slots")
       VALUES
         ('PG Active Legacy', $1, 'pgdrA1', 'active', 20, 1),
         ('PG Complete Legacy', $1, 'pgdrC1', 'complete', 16, 0),
         ('PG Pending', $1, 'pgdrP1', 'pending', 15, 1)
       RETURNING "id", "draft_status"`,
      [seededUserId]
    );
    seededLeagueIds = seeded.rows.map((r) => r.id);
    const idByStatus = Object.fromEntries(seeded.rows.map((r) => [r.draft_status, r.id]));

    // Column does not exist yet: the migration hasn't been re-applied.
    await assert.rejects(
      pool.query(`SELECT "draft_rounds" FROM "leagues" WHERE "id" = $1`, [idByStatus.active]),
      /column .*draft_rounds.* does not exist/i
    );

    await knex.migrate.up({ name: MIGRATION_NAME });

    const result = await pool.query(
      `SELECT "id", "draft_status", "draft_rounds" FROM "leagues" WHERE "id" = ANY($1::int[]) ORDER BY "id"`,
      [seededLeagueIds]
    );
    const rowsByStatus = Object.fromEntries(result.rows.map((r) => [r.draft_status, r]));

    // roster_limit 20 - ir_slots 1 = 19.
    assert.equal(rowsByStatus.active.draft_rounds, 19);
    // roster_limit 16 - ir_slots 0 = 16.
    assert.equal(rowsByStatus.complete.draft_rounds, 16);
    // Pending is left null: it keeps deriving Draft roster size live (ADR 0005).
    assert.equal(rowsByStatus.pending.draft_rounds, null);
  });
}
