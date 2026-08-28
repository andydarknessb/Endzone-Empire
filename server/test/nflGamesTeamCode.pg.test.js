/**
 * Disposable-Postgres test for the nfl_games Team-code unique index
 * (20260826000001_nfl_games_team_code_unique.js, ADR 0011, #421): the one
 * thing a mocked unit test cannot prove, that Postgres itself now rejects a
 * second Raw team code for a team-week that already has one, while the raw
 * `ON CONFLICT ("season","week","nfl_team")` upsert path the schedule writers
 * use keeps working unchanged.
 *
 * What it proves, in order:
 *   1. Both unique indexes exist on nfl_games: the raw one under its
 *      knex-generated name, untouched, and the Team-code one beside it. So
 *      "beside the raw constraint" is observed, not assumed.
 *   2. (2026, 1, 'WSH') then (2026, 1, 'WAS') fails on the second insert with
 *      SQLSTATE 23505 naming `nfl_games_season_week_team_code_unique`. WSH and
 *      WAS fold to the same Team code, so they are one team-week.
 *   3. (2026, 1, 'WSH') then (2026, 1, 'DAL') both succeed: different Team
 *      codes are not a collision.
 *   4. An `ON CONFLICT ("season","week","nfl_team") DO UPDATE` re-insert of
 *      'WSH' updates rather than errors: the raw constraint is still the
 *      arbiter and the new index does not get in the writers' way.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated twice:
 * PG_TESTS=1 or NFL_GAMES_TEAM_CODE_PG_TESTS=1 must be set explicitly, and
 * every DATABASE_URL* variable must be ABSENT. Connections are built from PG*
 * variables only, so a stray local run can never touch the shared production
 * database (server/knexfile.js loads .env; this file deliberately does not).
 * Mirrors draftRoundsBackfill.pg.test.js's gating exactly. Picked up by
 * scripts/run-pg-tests.js because it exists (#371); `npm run
 * test:nfl-games-team-code-pg` runs it alone.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.NFL_GAMES_TEAM_CODE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

const TEAM_CODE_INDEX = 'nfl_games_season_week_team_code_unique';
const RAW_INDEX = 'nfl_games_season_week_nfl_team_unique';
const SEASON = 2026;
const WEEK = 1;
// Every raw code this file ever inserts, so cleanup is exact and touches
// nothing another pg file might have seeded for the same season/week.
const SEEDED_CODES = ['WSH', 'WAS', 'DAL'];

if (!ENABLED) {
  test('nfl_games team-code index PG tests (skipped: set PG_TESTS=1 or NFL_GAMES_TEAM_CODE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('nfl_games team-code index PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const pool = new pg.Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 2,
  });

  const KICKOFF = '2026-09-13T17:00:00Z';

  function insertGame(nflTeam, opponent) {
    return pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       VALUES ($1, $2, $3, $4, $5)
       RETURNING "id", "nfl_team", "opponent"`,
      [SEASON, WEEK, nflTeam, opponent, KICKOFF]
    );
  }

  async function clearSeeded() {
    await pool.query(
      `DELETE FROM "nfl_games" WHERE "season" = $1 AND "week" = $2 AND "nfl_team" = ANY($3::text[])`,
      [SEASON, WEEK, SEEDED_CODES]
    );
  }

  test.before(async () => {
    await clearSeeded();
  });

  test.afterEach(async () => {
    await clearSeeded();
  });

  test.after(async () => {
    await clearSeeded();
    await pool.end();
  });

  test('both unique indexes exist on nfl_games: the raw one untouched, the Team-code one beside it', async () => {
    const result = await pool.query(
      `SELECT "indexname", "indexdef" FROM "pg_indexes"
       WHERE "tablename" = 'nfl_games' AND "indexname" = ANY($1::text[])
       ORDER BY "indexname"`,
      [[RAW_INDEX, TEAM_CODE_INDEX]]
    );
    const byName = new Map(result.rows.map((r) => [r.indexname, r.indexdef]));
    assert.ok(byName.has(RAW_INDEX), `raw index ${RAW_INDEX} must still exist`);
    assert.ok(byName.has(TEAM_CODE_INDEX), `team-code index ${TEAM_CODE_INDEX} must exist`);
    assert.match(byName.get(RAW_INDEX), /UNIQUE INDEX/);
    assert.match(byName.get(RAW_INDEX), /\(season, week, nfl_team\)/);
    assert.match(byName.get(TEAM_CODE_INDEX), /UNIQUE INDEX/);
    assert.match(byName.get(TEAM_CODE_INDEX), /fn_normalize_nfl_team\(/);
  });

  test('WSH then WAS for one team-week fails on the second insert with 23505 naming the Team-code index', async () => {
    await insertGame('WSH', 'DAL');
    let caught = null;
    try {
      await insertGame('WAS', 'DAL');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'the second insert must throw');
    assert.equal(caught.code, '23505');
    assert.equal(caught.constraint, TEAM_CODE_INDEX);
    const rows = await pool.query(
      `SELECT "nfl_team" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2 AND "nfl_team" = ANY($3::text[])`,
      [SEASON, WEEK, SEEDED_CODES]
    );
    assert.deepEqual(rows.rows.map((r) => r.nfl_team), ['WSH']);
  });

  test('WSH then DAL for one week both succeed: different Team codes are not a collision', async () => {
    const first = await insertGame('WSH', 'DAL');
    const second = await insertGame('DAL', 'WSH');
    assert.equal(first.rows[0].nfl_team, 'WSH');
    assert.equal(second.rows[0].nfl_team, 'DAL');
  });

  test('ON CONFLICT ("season","week","nfl_team") DO UPDATE re-insert of WSH updates rather than errors', async () => {
    const seeded = await insertGame('WSH', 'DAL');
    const upsert = await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       VALUES ($1, $2, 'WSH', 'NYG', $3)
       ON CONFLICT ("season", "week", "nfl_team")
       DO UPDATE SET "opponent" = EXCLUDED."opponent"
       RETURNING "id", "opponent"`,
      [SEASON, WEEK, KICKOFF]
    );
    assert.equal(upsert.rows[0].id, seeded.rows[0].id, 'the upsert must update the existing row, not insert a new one');
    assert.equal(upsert.rows[0].opponent, 'NYG');
    const count = await pool.query(
      `SELECT COUNT(*)::int AS "n" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2 AND "nfl_team" = 'WSH'`,
      [SEASON, WEEK]
    );
    assert.equal(count.rows[0].n, 1);
  });
}
