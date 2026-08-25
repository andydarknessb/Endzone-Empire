/**
 * Disposable-Postgres test for roster tenure as a recorded fact (#228).
 *
 * Everything here is a claim about the DATABASE rather than about any
 * service, and a matcher fake cannot express one of them: the test fakes do
 * not run triggers (ADR 0006), so a mocked suite that "proves" a tenure was
 * opened is only proving that its own fixture inserted a row. The trigger is
 * the whole mechanism this ticket rests on. It gets a real Postgres.
 *
 * Five claims, in the order a roster actually moves:
 *
 * 1. The BACKFILL opens exactly one tenure per existing `team_players` row,
 *    at that row's own `created_at` rather than at migration time.
 * 2. An INSERT opens a tenure; a DELETE closes it with `released_at` set.
 * 3. A TRADE - delete and insert in ONE transaction - closes one tenure and
 *    opens another at the SAME instant, because `now()` is transaction start.
 *    Any sliver between them would be a moment the player was held by nobody.
 * 4. The draft reset's bulk `DELETE FROM "team_players" WHERE "league_id"`,
 *    which bypasses the `removeLineupEntries` chokepoint entirely, still
 *    closes every affected tenure. This is the case that motivated a trigger
 *    over call-site writes.
 * 5. A league delete CASCADES without error. The close trigger fires while
 *    the league, the teams and the tenures are all going away, which is the
 *    case that passes every unit test and fails in production.
 *
 * Plus two invariants the schema enforces rather than the trigger: at most
 * one OPEN tenure per (team, player), and `team_players` identity is
 * immutable so no future UPDATE can move a roster row between teams without
 * the tenure following it.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: ROSTER_TENURES_PG_TESTS=1 must be set explicitly, and every
 * DATABASE_URL* variable must be ABSENT -- connections are built from PG*
 * variables only, so a stray local run can never touch the shared production
 * database (server/knexfile.js loads .env; this file deliberately does not).
 * Mirrors lineupFollowsRoster.pg.test.js's gating exactly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.ROSTER_TENURES_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('roster_tenures PG tests (skipped: ROSTER_TENURES_PG_TESTS not set — CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('roster_tenures PG tests refuse to run with DATABASE_URL* set', () => {
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

  const MIGRATION_NAME = '20260823000003_roster_tenures.js';
  // A season of its own, so nothing here can collide with another suite's
  // seed data in the shared disposable database. 2077-2081 and 2098-2099 are
  // already spoken for by the holdout and lineup-follows-roster suites.
  const SEASON = 2091;
  const CURRENT_WEEK = 4;
  // The backfill must copy THIS, not `now()`. A day is far enough outside
  // any plausible clock skew that an accidental `now()` cannot pass.
  const LEGACY_ACQUIRED_SQL = "now() - interval '30 days'";

  let userIds = [];
  const leagueIds = [];
  const playerIds = {};
  let teamA = null; // the holding team, and the one that trades away
  let teamB = null; // the receiving team
  let cascadeLeagueId = null; // its own league, destroyed by the cascade test
  let cascadeTeamId = null;

  /** Every tenure for one player on one team, oldest first. */
  async function tenures(teamId, playerId) {
    const result = await pool.query(
      `SELECT "acquired_at", "released_at" FROM "roster_tenures"
        WHERE "team_id" = $1 AND "player_id" = $2
        ORDER BY "acquired_at", "id"`,
      [teamId, playerId]
    );
    return result.rows;
  }

  /** Whether this migration is currently applied, by the ledger knex keeps. */
  async function isMigrated() {
    const applied = await pool.query(
      `SELECT 1 FROM "knex_migrations" WHERE "name" = $1`,
      [MIGRATION_NAME]
    );
    return applied.rows.length > 0;
  }

  test.before(async () => {
    // The migrate/rollback/migrate smoke earlier in the CI job already left
    // every migration (including this one) applied. Roll THIS ONE back on
    // its own so its up() can be re-run against seeded legacy roster rows,
    // exactly as it will run against the real pre-#228 database. Seeding
    // while it is DOWN is what makes the backfill assertion meaningful: with
    // the trigger absent, these rows get tenures only if up() backfills them.
    if (await isMigrated()) {
      await knex.migrate.down({ name: MIGRATION_NAME });
    }

    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('roster_tenures_pg1', 'roster-tenures-pg1@example.invalid', 'x'),
              ('roster_tenures_pg2', 'roster-tenures-pg2@example.invalid', 'x'),
              ('roster_tenures_pg3', 'roster-tenures-pg3@example.invalid', 'x')
       RETURNING "id"`
    );
    userIds = users.rows.map((r) => r.id);

    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "current_season", "current_week")
       VALUES ('PG Roster Tenures', $1, 'pgrt01', $2, $3) RETURNING "id"`,
      [userIds[0], SEASON, CURRENT_WEEK]
    );
    leagueIds.push(league.rows[0].id);

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Holder'), ($1, $3, 'PG Receiver')
       RETURNING "id", "name"`,
      [league.rows[0].id, userIds[0], userIds[1]]
    );
    teamA = teams.rows.find((t) => t.name === 'PG Holder').id;
    teamB = teams.rows.find((t) => t.name === 'PG Receiver').id;

    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Legacy', 'RB', 'PGL'), ('PG Traded', 'WR', 'PGT'),
              ('PG Churned', 'TE', 'PGC'), ('PG Reset', 'QB', 'PGR')
       RETURNING "id", "name"`
    );
    for (const row of players.rows) {
      playerIds[row.name.replace('PG ', '')] = row.id;
    }

    // Seeded while the migration is DOWN, so no trigger sees them: these are
    // "legacy" rows in exactly the sense the real database's rows are.
    // created_at is forced into the past so the backfill cannot pass by
    // accidentally stamping now().
    for (const name of ['Legacy', 'Traded', 'Churned', 'Reset']) {
      await pool.query(
        `INSERT INTO "team_players" ("league_id", "team_id", "player_id", "created_at")
         VALUES ($1, $2, $3, ${LEGACY_ACQUIRED_SQL})`,
        [leagueIds[0], teamA, playerIds[name]]
      );
    }

    // A league of its own for the cascade test, so destroying it cannot take
    // the rest of the suite's fixtures with it.
    const cascadeLeague = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "current_season", "current_week")
       VALUES ('PG Roster Tenures Cascade', $1, 'pgrt02', $2, $3) RETURNING "id"`,
      [userIds[2], SEASON, CURRENT_WEEK]
    );
    cascadeLeagueId = cascadeLeague.rows[0].id;
    const cascadeTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Doomed') RETURNING "id"`,
      [cascadeLeagueId, userIds[2]]
    );
    cascadeTeamId = cascadeTeam.rows[0].id;
  });

  test.after(async () => {
    // Clean up the seeded rows and leave the schema fully migrated again
    // (knex_migrations row restored) so later CI steps in this job see the
    // same fully-migrated database the earlier `npm run migrate` produced.
    const allLeagues = [...leagueIds, cascadeLeagueId].filter((id) => id !== null);
    if (allLeagues.length > 0) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [allLeagues]);
    }
    const seededPlayerIds = Object.values(playerIds);
    if (seededPlayerIds.length > 0) {
      await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [seededPlayerIds]);
    }
    await pool.query(`DELETE FROM "users" WHERE "username" LIKE 'roster_tenures_pg%'`);
    if (!(await isMigrated())) {
      await knex.migrate.up({ name: MIGRATION_NAME });
    }
    await pool.end();
    await knex.destroy();
  });

  // Runs first and leaves the migration APPLIED for everything below it.
  test('the backfill opens exactly one open tenure per roster row, at that row\'s own created_at', async () => {
    await knex.migrate.up({ name: MIGRATION_NAME });

    const result = await pool.query(
      `SELECT tp."player_id",
              COUNT(rt."id")::int AS "tenures",
              COUNT(rt."id") FILTER (WHERE rt."released_at" IS NULL)::int AS "open",
              BOOL_AND(rt."acquired_at" = tp."created_at") AS "stamped_from_created_at"
         FROM "team_players" tp
         LEFT JOIN "roster_tenures" rt
           ON rt."team_id" = tp."team_id" AND rt."player_id" = tp."player_id"
        WHERE tp."team_id" = $1
        GROUP BY tp."player_id"`,
      [teamA]
    );

    assert.equal(result.rows.length, 4, 'all four seeded roster rows are still there');
    for (const row of result.rows) {
      assert.equal(row.tenures, 1, `player ${row.player_id} has exactly one tenure`);
      assert.equal(row.open, 1, `player ${row.player_id}'s tenure is open`);
      assert.equal(
        row.stamped_from_created_at,
        true,
        `player ${row.player_id}'s acquired_at came from team_players.created_at, not now()`
      );
    }

    // The stamp is genuinely historical, not merely equal to a value the
    // assertion above could have satisfied with now() on both sides.
    const age = await pool.query(
      `SELECT BOOL_AND("acquired_at" < now() - interval '29 days') AS "backdated"
         FROM "roster_tenures" WHERE "team_id" = $1`,
      [teamA]
    );
    assert.equal(age.rows[0].backdated, true, 'backfilled tenures are backdated, not stamped at migration time');
  });

  test('an INSERT opens a tenure and a DELETE closes it', async () => {
    const player = playerIds.Churned;
    // He was backfilled; drop him and watch the tenure close.
    await pool.query(
      `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
      [teamA, player]
    );
    let rows = await tenures(teamA, player);
    assert.equal(rows.length, 1, 'still one tenure after the drop');
    assert.notEqual(rows[0].released_at, null, 'the drop closed it');

    // Re-add him: a SECOND tenure, not a reopening of the first. "A player
    // who leaves and returns has two tenures."
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueIds[0], teamA, player]
    );
    rows = await tenures(teamA, player);
    assert.equal(rows.length, 2, 're-adding opens a second tenure rather than reopening the first');
    assert.notEqual(rows[0].released_at, null, 'the first tenure stays closed');
    assert.equal(rows[1].released_at, null, 'the second is open');
    assert.ok(
      rows[1].acquired_at >= rows[0].released_at,
      'the new tenure begins no earlier than the old one ended'
    );
  });

  test('a trade closes one tenure and opens another at the same instant', async () => {
    const player = playerIds.Traded;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
        [teamA, player]
      );
      await client.query(
        `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
        [leagueIds[0], teamB, player]
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const gone = await tenures(teamA, player);
    const got = await tenures(teamB, player);
    assert.equal(gone.length, 1);
    assert.equal(got.length, 1);
    assert.notEqual(gone[0].released_at, null, 'the losing team\'s tenure closed');
    assert.equal(got[0].released_at, null, 'the receiving team\'s tenure is open');
    // now() is transaction start, so these are the SAME instant. Statement
    // time would put a sliver between them in which nobody held the player.
    assert.deepEqual(
      got[0].acquired_at,
      gone[0].released_at,
      'release and acquisition share one timestamp'
    );
  });

  test('the draft reset\'s bulk delete closes every affected tenure', async () => {
    // The path that bypasses removeLineupEntries entirely: one statement,
    // every roster row in the league, no service code involved.
    const openBefore = await pool.query(
      `SELECT COUNT(*)::int AS "n" FROM "roster_tenures"
        WHERE "league_id" = $1 AND "released_at" IS NULL`,
      [leagueIds[0]]
    );
    assert.ok(openBefore.rows[0].n > 0, 'there are open tenures to close');

    await pool.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [leagueIds[0]]);

    const after = await pool.query(
      `SELECT COUNT(*)::int AS "total",
              COUNT(*) FILTER (WHERE "released_at" IS NULL)::int AS "open"
         FROM "roster_tenures" WHERE "league_id" = $1`,
      [leagueIds[0]]
    );
    assert.equal(after.rows[0].open, 0, 'the bulk delete left no tenure open');
    assert.ok(after.rows[0].total > 0, 'and it closed them rather than deleting them');
  });

  test('a league delete cascades without error, with the close trigger firing mid-teardown', async () => {
    // The trigger fires while the league, its teams and its tenures are all
    // being destroyed. It must not read a parent row, and it must not raise
    // when the tenure it would have closed is already gone.
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [cascadeLeagueId, cascadeTeamId, playerIds.Reset]
    );
    const seeded = await tenures(cascadeTeamId, playerIds.Reset);
    assert.equal(seeded.length, 1, 'the doomed league has an open tenure to trip over');

    await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [cascadeLeagueId]);

    const left = await pool.query(
      `SELECT COUNT(*)::int AS "n" FROM "roster_tenures" WHERE "league_id" = $1`,
      [cascadeLeagueId]
    );
    assert.equal(left.rows[0].n, 0, 'the tenures went with the league');
    cascadeLeagueId = null; // already gone; do not delete it twice in after()
  });

  test('the schema refuses a second OPEN tenure for one team and player', async () => {
    // Enforced by the partial unique index, not by the trigger that
    // maintains it: a team holding the same player twice at once is not a
    // state any consumer should have to consider.
    const player = playerIds.Legacy;
    await pool.query(
      `INSERT INTO "roster_tenures" ("league_id", "team_id", "player_id", "acquired_at")
       VALUES ($1, $2, $3, now())`,
      [leagueIds[0], teamA, player]
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO "roster_tenures" ("league_id", "team_id", "player_id", "acquired_at")
         VALUES ($1, $2, $3, now())`,
        [leagueIds[0], teamA, player]
      ),
      (error) => error.code === '23505',
      'a second open tenure is a unique violation'
    );
    await pool.query(
      `DELETE FROM "roster_tenures" WHERE "team_id" = $1 AND "player_id" = $2 AND "released_at" IS NULL`,
      [teamA, player]
    );
  });

  test('team_players identity is immutable, so no UPDATE can move a roster row past the triggers', async () => {
    const player = playerIds.Legacy;
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueIds[0], teamA, player]
    );

    // Moving the row to another team fires NEITHER trigger, so the tenure
    // would silently credit the whole period to the losing team. Refused.
    await assert.rejects(
      pool.query(
        `UPDATE "team_players" SET "team_id" = $1 WHERE "team_id" = $2 AND "player_id" = $3`,
        [teamB, teamA, player]
      ),
      /identity is immutable/,
      'changing team_id raises'
    );

    // A touch of any other column is still allowed: the guard is about
    // identity, not about the row being read-only.
    const touched = await pool.query(
      `UPDATE "team_players" SET "updated_at" = now()
        WHERE "team_id" = $1 AND "player_id" = $2`,
      [teamA, player]
    );
    assert.equal(touched.rowCount, 1, 'a non-identity update still works');
  });
}
