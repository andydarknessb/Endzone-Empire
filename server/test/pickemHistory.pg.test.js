/**
 * Disposable-PostgreSQL coverage for the Pick'em history archive migration
 * (#295). Refuses DATABASE_URL* so it cannot touch the shared database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.PICKEM_HISTORY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('Pick\'em history PG tests (skipped: set PG_TESTS=1 or PICKEM_HISTORY_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Pick\'em history PG tests refuse to run with DATABASE_URL* set', () => {
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
  const MIGRATION_NAME = '20260824000004_archive_pickem_results_in_history.js';
  const SEASON = 2095;
  let userId;
  let leagueId;

  const champions = [{
    teamId: 999999,
    teamName: 'Archived Without Live Team',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 17,
    correct: 14,
    mode: 'straight',
  }];

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (applied) await knex.migrate.down({ name: MIGRATION_NAME });

    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('pickem_history_pg', 'pickem-history-pg@example.invalid', 'x')
       RETURNING "id"`
    );
    userId = user.rows[0].id;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES ('Pickem History PG', $1, 'pkhistpg', true) RETURNING "id"`,
      [userId]
    );
    leagueId = league.rows[0].id;
    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards")
       VALUES ($1, $2, $3, '[]', '[]')`,
      [leagueId, SEASON, JSON.stringify([{ teamId: 999999, name: 'Archived Without Live Team', rank: 1 }])]
    );
    await pool.query(
      `INSERT INTO "pickem_season_results"
         ("league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at")
       VALUES ($1, $2, 'champions', 'straight', $3, $4, $5)`,
      [
        leagueId,
        SEASON,
        JSON.stringify(champions),
        JSON.stringify({ source: 'legacy_league_history_awards' }),
        '2096-01-11T06:00:00.000Z',
      ]
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

  test('migration backfills the declared snapshot without requiring a live Team or account display', async () => {
    const archived = await pool.query(
      `SELECT "pickem_result" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, SEASON]
    );
    assert.equal(archived.rows[0].pickem_result.outcome, 'champions');
    assert.deepEqual(archived.rows[0].pickem_result.champions, champions);

    await pool.query('UPDATE "users" SET "username" = $1 WHERE "id" = $2', ['anonymized', userId]);
    const afterAnonymization = await pool.query(
      `SELECT "pickem_result" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, SEASON]
    );
    assert.deepEqual(afterAnonymization.rows[0].pickem_result.champions, champions);
  });

  test('database rejects an archived outcome that contradicts its champion set', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO "league_history"
           ("league_id", "season", "standings", "rosters", "awards", "pickem_result")
         VALUES ($1, $2, '[]', '[]', '[]', $3)`,
        [
          leagueId,
          SEASON + 1,
          JSON.stringify({ outcome: 'no_champion', mode: 'straight', champions }),
        ]
      ),
      (error) => error.code === '23514'
    );
  });
}
