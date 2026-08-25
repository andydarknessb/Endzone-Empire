/**
 * Disposable-PostgreSQL coverage for the league_history.standings account
 * identity strip + CHECK migration (#342). Refuses DATABASE_URL* so it can
 * never touch the shared database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.HISTORY_STANDINGS_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('history standings identity PG tests (skipped: HISTORY_STANDINGS_PG_TESTS not set)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('history standings identity PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only see a disposable PG* database`);
  });
} else {
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
  const MIGRATION_NAME = '20260825000001_strip_account_identity_from_history_standings.js';
  const CONSTRAINT = 'league_history_standings_no_account_identity_check';
  const SEASON = 2094;
  let userId;
  let leagueId;

  // A legacy-shaped snapshot: element 0 carries the live leak (userId/username),
  // element 1 carries the older snake variants, element 2 is already clean.
  // Team identity, scoring totals and per-week points must all survive; element
  // order must be preserved.
  const legacyStandings = [
    { teamId: 11, name: 'Bob Squad', userId: 101, username: 'bob', points: 5, correct: 3, rank: 1, weekly: { 18: 5 } },
    { teamId: 10, name: 'Sunday Ballers', user_id: 100, email: 'sunday@example.invalid', owner_id: 100, points: 0, correct: 0, rank: 2, weekly: { 18: 0 } },
    { teamId: 12, name: 'Clean Team', points: 3, correct: 2, rank: 3, weekly: { 18: 3 } },
  ];

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (applied) await knex.migrate.down({ name: MIGRATION_NAME });
    // `down` is a no-op (the guard must never be dropped in normal operation),
    // so the CHECK persists after rollback. Drop it explicitly to reconstruct
    // the true pre-migration state in which a legacy row can be seeded.
    await knex.raw(`ALTER TABLE "league_history" DROP CONSTRAINT IF EXISTS "${CONSTRAINT}"`);

    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('history_standings_pg', 'history-standings-pg@example.invalid', 'x')
       RETURNING "id"`
    );
    userId = user.rows[0].id;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES ('History Standings PG', $1, 'histstandpg', true) RETURNING "id"`,
      [userId]
    );
    leagueId = league.rows[0].id;
    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards")
       VALUES ($1, $2, $3, '[]', '[]')`,
      [leagueId, SEASON, JSON.stringify(legacyStandings)]
    );

    await knex.migrate.up({ name: MIGRATION_NAME });
  });

  test.after(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.up({ name: MIGRATION_NAME });
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (userId) await pool.query('DELETE FROM "users" WHERE "id" = $1', [userId]);
    await pool.end();
    await knex.destroy();
  });

  test('the migration strips account identity from every archived standings element and keeps the rest', async () => {
    const archived = await pool.query(
      `SELECT "standings" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, SEASON]
    );
    const standings = archived.rows[0].standings;

    // Order preserved, one element per seeded row.
    assert.equal(standings.length, 3);
    assert.deepEqual(standings.map((row) => row.teamId), [11, 10, 12]);
    assert.deepEqual(standings.map((row) => row.name), ['Bob Squad', 'Sunday Ballers', 'Clean Team']);

    // No account-identity key survives on any element.
    for (const row of standings) {
      for (const forbidden of ['userId', 'username', 'user_id', 'email', 'owner_id']) {
        assert.equal(forbidden in row, false, `stripped element must not carry ${forbidden}`);
      }
    }

    // Team identity, scoring totals and per-week points are untouched.
    assert.deepEqual(standings[0], { teamId: 11, name: 'Bob Squad', points: 5, correct: 3, rank: 1, weekly: { 18: 5 } });
    assert.deepEqual(standings[2], { teamId: 12, name: 'Clean Team', points: 3, correct: 2, rank: 3, weekly: { 18: 3 } });
  });

  test('the database rejects a future write that freezes an account id into standings', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards")
         VALUES ($1, $2, $3, '[]', '[]')`,
        [
          leagueId,
          SEASON + 1,
          JSON.stringify([{ teamId: 11, name: 'Bob Squad', username: 'bob', points: 5 }]),
        ]
      ),
      (error) => error.code === '23514'
    );
  });

  test('a clean write is accepted and re-applying the migration is a no-op', async () => {
    // The guard admits a Team-identity-only row.
    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards")
       VALUES ($1, $2, $3, '[]', '[]')`,
      [leagueId, SEASON + 2, JSON.stringify([{ teamId: 11, name: 'Bob Squad', points: 5, rank: 1 }])]
    );

    // Idempotent: running up() again neither errors (DROP IF EXISTS) nor
    // re-strips an already-clean row.
    const migration = require('../db/migrations/20260825000001_strip_account_identity_from_history_standings');
    await migration.up(knex);
    const archived = await pool.query(
      `SELECT "standings" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, SEASON]
    );
    assert.deepEqual(archived.rows[0].standings.map((row) => row.teamId), [11, 10, 12]);
    for (const row of archived.rows[0].standings) {
      assert.equal('userId' in row, false);
      assert.equal('username' in row, false);
    }
  });
}
