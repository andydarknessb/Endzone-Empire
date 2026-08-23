/**
 * Disposable-Postgres test for the Team-name migration
 * (20260822000002_require_team_names.js, #111) -- the pieces the mocked unit
 * tests can't prove: that the backfill's exact-match predicate really only
 * touches a Team name that equals the legacy `${username}'s Team` default
 * for an email-shaped username (never a "contains @" heuristic, never a
 * non-email-shaped username's default, never a custom name), that legacy
 * nameless pending join requests are cancelled rather than defaulted, and
 * that the new CHECK constraint and widened column are real DB behavior.
 *
 * One test, deliberately: every scenario shares the single before/after
 * migration boundary (seed against the rolled-back schema, migrate up once,
 * assert everything), so there is no cross-test ordering to get wrong (the
 * "long name rejected pre-widen" assertion, in particular, would silently
 * stop proving anything if a later `migrate.up` from an earlier test had
 * already widened the column).
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: TEAM_NAMES_PG_TESTS=1 must be set explicitly, and every
 * DATABASE_URL* variable must be ABSENT -- connections are built from PG*
 * variables only, so a stray local run can never touch the shared
 * production database (server/knexfile.js loads .env; this file
 * deliberately does not). Mirrors draftRoundsBackfill.pg.test.js's gating
 * exactly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.TEAM_NAMES_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('Team-name backfill PG tests (skipped: TEAM_NAMES_PG_TESTS not set — CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Team-name backfill PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} — these tests must only ever see a disposable PG* database`);
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

  const MIGRATION_NAME = '20260822000002_require_team_names.js';
  let seededUserIds = [];
  let seededLeagueIds = [];

  test.before(async () => {
    // The migrate/rollback/migrate smoke earlier in the CI job already left
    // every migration (including this one) applied. Roll THIS ONE migration
    // back on its own so its up() can be re-run against seeded legacy rows,
    // exactly as it would run against a real pre-#111 database.
    await knex.migrate.down({ name: MIGRATION_NAME });
  });

  test.after(async () => {
    if (seededLeagueIds.length > 0) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [seededLeagueIds]);
    }
    if (seededUserIds.length > 0) {
      await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [seededUserIds]);
    }
    // Leave the schema fully migrated again (knex_migrations row restored)
    // so later CI steps in this job see the same fully-migrated database
    // the earlier `npm run migrate` step produced.
    await knex.migrate.up({ name: MIGRATION_NAME });
    await pool.end();
    await knex.destroy();
  });

  test('the migration backfills legacy email-shaped Team names, cancels nameless pending requests, and adds real DB guards', async () => {
    // --- Seed against the rolled-back (pre-#111) schema -------------------
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES
         ('alice@example.com', 'alice-pg-test@example.invalid', 'x'),
         ('bob_the_builder', 'bob-pg-test@example.invalid', 'x'),
         ('carol@example.com', 'carol-pg-test@example.invalid', 'x'),
         ('jr_pg_owner', 'jr-pg-owner@example.invalid', 'x'),
         ('jr_pg_nameless', 'jr-pg-nameless@example.invalid', 'x'),
         ('jr_pg_blank', 'jr-pg-blank@example.invalid', 'x'),
         ('jr_pg_named', 'jr-pg-named@example.invalid', 'x'),
         ('jr_pg_denied_nameless', 'jr-pg-denied-nameless@example.invalid', 'x'),
         ('jr_pg_widened', 'jr-pg-widened@example.invalid', 'x')
       RETURNING "id", "username"`
    );
    const idByUsername = Object.fromEntries(users.rows.map((r) => [r.username, r.id]));
    seededUserIds = users.rows.map((r) => r.id);

    const leagues = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "is_public", "join_approval")
       VALUES
         ('PG Team Names League', $1, 'pgtn0001', false, false),
         ('PG Join Requests League', $2, 'pgtn0003', true, true)
       RETURNING "id", "invite_code"`,
      [idByUsername['alice@example.com'], idByUsername['jr_pg_owner']]
    );
    const leagueIdByCode = Object.fromEntries(leagues.rows.map((r) => [r.invite_code, r.id]));
    const teamsLeagueId = leagueIdByCode.pgtn0001;
    const requestsLeagueId = leagueIdByCode.pgtn0003;
    seededLeagueIds = leagues.rows.map((r) => r.id);

    // Team-name backfill fixtures: an email-shaped username with the exact
    // legacy default, a non-email-shaped username with the same-shaped
    // default (nothing to leak), and an email-shaped username with a custom
    // name that merely contains an at-sign.
    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES
         ($1, $2, 'alice@example.com''s Team'),
         ($1, $3, 'bob_the_builder''s Team'),
         ($1, $4, 'Team @Home')
       RETURNING "id", "owner_id"`,
      [teamsLeagueId, idByUsername['alice@example.com'], idByUsername['bob_the_builder'], idByUsername['carol@example.com']]
    );
    const teamIdByOwner = Object.fromEntries(teams.rows.map((r) => [r.owner_id, r.id]));

    // join_requests.team_name is still varchar(100) (this migration is
    // rolled back): a 110-character name must be refused until the widen
    // below re-applies.
    const longName = 'x'.repeat(110);
    await assert.rejects(
      pool.query(
        `INSERT INTO "join_requests" ("league_id", "user_id", "team_name", "status") VALUES ($1, $2, $3, 'pending')`,
        [requestsLeagueId, idByUsername.jr_pg_named, longName]
      ),
      /value too long/i,
      'the 100-char column still refuses a 110-char name before the widen'
    );

    await pool.query(
      `INSERT INTO "join_requests" ("league_id", "user_id", "team_name", "status")
       VALUES
         ($1, $2, NULL, 'pending'),
         ($1, $3, '   ', 'pending'),
         ($1, $4, 'A Real Name', 'pending'),
         ($1, $5, NULL, 'denied')`,
      [
        requestsLeagueId,
        idByUsername.jr_pg_nameless,
        idByUsername.jr_pg_blank,
        idByUsername.jr_pg_named,
        idByUsername.jr_pg_denied_nameless,
      ]
    );

    // --- Re-apply the migration --------------------------------------------
    await knex.migrate.up({ name: MIGRATION_NAME });

    // --- Team-name backfill: exact match only ------------------------------
    const teamRows = await pool.query(
      `SELECT "id", "owner_id", "name" FROM "teams" WHERE "league_id" = $1 ORDER BY "id"`,
      [teamsLeagueId]
    );
    const teamByOwner = Object.fromEntries(teamRows.rows.map((r) => [r.owner_id, r]));

    // Email-shaped username, exact legacy pattern: replaced with the
    // neutral Team-ID label.
    const aliceTeamId = teamIdByOwner[idByUsername['alice@example.com']];
    assert.equal(
      teamByOwner[idByUsername['alice@example.com']].name,
      `Team ${aliceTeamId}`,
      'an email-shaped username\'s exact legacy default is replaced'
    );

    // Non-email-shaped username: the default pattern matches exactly, but
    // there is no email to leak, so it is left alone.
    assert.equal(
      teamByOwner[idByUsername.bob_the_builder].name,
      "bob_the_builder's Team",
      'a non-email-shaped username\'s default name is preserved'
    );

    // Email-shaped username, but a custom name that merely contains an
    // at-sign and does not exactly equal the generated pattern: preserved
    // untouched, proving the match is exact, not "contains @".
    assert.equal(
      teamByOwner[idByUsername['carol@example.com']].name,
      'Team @Home',
      'a custom name containing an at-sign is preserved untouched'
    );

    // --- join_requests: widen + cancellation -------------------------------
    const widened = await pool.query(
      `INSERT INTO "join_requests" ("league_id", "user_id", "team_name", "status") VALUES ($1, $2, $3, 'pending') RETURNING "id"`,
      [requestsLeagueId, idByUsername.jr_pg_widened, longName]
    );
    assert.ok(widened.rows[0].id, 'the same 110-char name that failed pre-widen now fits in varchar(120)');

    const requestRows = await pool.query(
      `SELECT "user_id", "status" FROM "join_requests" WHERE "league_id" = $1 AND "id" != $2 ORDER BY "user_id"`,
      [requestsLeagueId, widened.rows[0].id]
    );
    const requestByUser = Object.fromEntries(requestRows.rows.map((r) => [r.user_id, r]));

    assert.equal(requestByUser[idByUsername.jr_pg_nameless].status, 'cancelled', 'nameless pending is cancelled, not defaulted');
    assert.equal(requestByUser[idByUsername.jr_pg_blank].status, 'cancelled', 'whitespace-only pending is cancelled too');
    assert.equal(requestByUser[idByUsername.jr_pg_named].status, 'pending', 'an already-named pending request is untouched');
    assert.equal(requestByUser[idByUsername.jr_pg_denied_nameless].status, 'denied', 'a decided request is left as historical record');

    // --- teams.name CHECK constraint ---------------------------------------
    await assert.rejects(
      pool.query(`INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, '')`, [teamsLeagueId, idByUsername.jr_pg_owner]),
      /violates check constraint "teams_name_not_blank_check"/,
      'a blank name is refused once the CHECK exists'
    );
    await assert.rejects(
      pool.query(`INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, '   ')`, [teamsLeagueId, idByUsername.jr_pg_owner]),
      /violates check constraint "teams_name_not_blank_check"/,
      'a whitespace-only name is refused too'
    );
    const realTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Real Team') RETURNING "id"`,
      [teamsLeagueId, idByUsername.jr_pg_owner]
    );
    assert.ok(realTeam.rows[0].id, 'a real name still inserts fine');
  });
}
