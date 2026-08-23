/**
 * Disposable-Postgres test for "a lineup entry follows the roster" (#197):
 * the two claims the mocked unit tests state but cannot prove, because a
 * matcher fake has no rows and no WHERE clause.
 *
 * 1. The one-shot cleanup migration (20260823000002) deletes exactly the
 *    stale rows and nothing else - in particular it never touches a PAST
 *    week, which is the record of the week as played (#106), and it runs
 *    cleanly against a database that has no stale rows at all.
 * 2. The runtime operation `lineup.service.removeLineupEntries` deletes the
 *    same set, against real rows: current week and every future week for a
 *    player whose game has not kicked off, future weeks only once it has,
 *    and past weeks never.
 *
 * The two are asserted side by side deliberately. They are two spellings of
 * one rule, and the migration exists precisely to make the database agree
 * with what the runtime will maintain from now on; if they ever disagree,
 * this file is where that shows.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: LINEUP_FOLLOWS_ROSTER_PG_TESTS=1 must be set explicitly, and every
 * DATABASE_URL* variable must be ABSENT -- connections are built from PG*
 * variables only, so a stray local run can never touch the shared
 * production database (server/knexfile.js loads .env; this file
 * deliberately does not). Mirrors teamNamesBackfill.pg.test.js's gating
 * exactly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.LINEUP_FOLLOWS_ROSTER_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('lineup-follows-roster PG tests (skipped: LINEUP_FOLLOWS_ROSTER_PG_TESTS not set — CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('lineup-follows-roster PG tests refuse to run with DATABASE_URL* set', () => {
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

  const MIGRATION_NAME = '20260823000002_clean_stale_lineup_entries.js';
  // A season of its own, so nothing here can collide with another suite's
  // seed data in the shared disposable database.
  const SEASON = 2099;
  const PRIOR_SEASON = 2098;
  const CURRENT_WEEK = 10;
  const PAST_WEEK = 9;
  const FUTURE_WEEK = 11;

  let userId = null;
  const leagueIds = [];
  const playerIds = {};
  // teamA is the departing team, the one under test. teamB and teamC play
  // each other in a SETTLED week; teamA is deliberately not a party to that
  // matchup, or its own current week would be frozen and nothing would be
  // removed from it by either spelling of the rule.
  let teamA = null;
  let teamB = null;
  let teamC = null;

  /** Every lineup row this team still holds, as sorted "player/week" keys. */
  async function survivingRows(teamId, season = SEASON) {
    const result = await pool.query(
      `SELECT "player_id", "week" FROM "lineup_entries"
        WHERE "team_id" = $1 AND "season" = $2`,
      [teamId, season]
    );
    const nameById = Object.fromEntries(
      Object.entries(playerIds).map(([name, id]) => [id, name])
    );
    return result.rows.map((row) => `${nameById[row.player_id]}/${row.week}`).sort();
  }

  test.before(async () => {
    // The migrate/rollback/migrate smoke earlier in the CI job already left
    // every migration (including this one) applied. Roll THIS ONE back so
    // its up() can be re-run against seeded stale rows, exactly as it would
    // run against a real pre-#197 database.
    await knex.migrate.down({ name: MIGRATION_NAME });

    // Three managers, because a team is one per manager per league and the
    // settled matchup must be between two teams that are NOT the team under
    // test.
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('lineup_follows_roster_pg1', 'lineup-follows-roster-pg1@example.invalid', 'x'),
              ('lineup_follows_roster_pg2', 'lineup-follows-roster-pg2@example.invalid', 'x'),
              ('lineup_follows_roster_pg3', 'lineup-follows-roster-pg3@example.invalid', 'x')
       RETURNING "id"`
    );
    userId = users.rows[0].id;

    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "current_season", "current_week")
       VALUES ('PG Lineup Follows Roster', $1, 'pglfr1', $2, $3) RETURNING "id"`,
      [userId, SEASON, CURRENT_WEEK]
    );
    leagueIds.push(league.rows[0].id);

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Departing'), ($1, $3, 'PG Settled'), ($1, $4, 'PG Settled Foe')
       RETURNING "id", "name"`,
      [league.rows[0].id, users.rows[0].id, users.rows[1].id, users.rows[2].id]
    );
    teamA = teams.rows.find((t) => t.name === 'PG Departing').id;
    teamB = teams.rows.find((t) => t.name === 'PG Settled').id;
    teamC = teams.rows.find((t) => t.name === 'PG Settled Foe').id;

    // KICKED's game has started, OPEN's has not, BYE has no game row at all
    // (a bye, or a week whose schedule was never synced). KEPT is still on
    // the roster and must be left alone whatever his schedule says.
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Kicked Off', 'RB', 'PGK'), ('PG Open', 'WR', 'PGO'),
              ('PG Bye', 'TE', 'PGB'), ('PG Kept', 'QB', 'PGQ')
       RETURNING "id", "name"`
    );
    for (const row of players.rows) {
      playerIds[row.name.replace('PG ', '').replace(/\s/g, '')] = row.id;
    }

    await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       VALUES ($1, $2, 'PGK', 'PGO', now() - interval '3 hours'),
              ($1, $2, 'PGO', 'PGK', now() + interval '3 days'),
              ($1, $2, 'PGQ', 'PGK', now() - interval '3 hours')`,
      [SEASON, CURRENT_WEEK]
    );

    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueIds[0], teamA, playerIds.Kept]
    );

    // Every player on a card for the past, current and future week. Three of
    // the four are no longer rostered, which is the whole defect.
    const rows = [];
    for (const week of [PAST_WEEK, CURRENT_WEEK, FUTURE_WEEK]) {
      for (const playerId of Object.values(playerIds)) {
        rows.push([leagueIds[0], teamA, playerId, SEASON, week]);
      }
    }
    for (const row of rows) {
      await pool.query(
        `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
         VALUES ($1, $2, $3, $4, $5, 'BENCH')`,
        row
      );
    }

    // A stale row in a PAST SEASON, at a week number beyond the current one.
    // The season predicate is the only thing keeping it: `week >= 10` alone
    // would take it. Nothing in the current season can exercise that.
    await pool.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
       VALUES ($1, $2, $3, $4, $5, 'BENCH')`,
      [leagueIds[0], teamA, playerIds.Open, PRIOR_SEASON, FUTURE_WEEK]
    );

    // Team B: a settled week, played against team C. Team A is deliberately
    // NOT a party to it - a matchup has two sides, and making team A the
    // away side would freeze team A's own current week and stop this suite
    // testing anything.
    await pool.query(
      `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id", "final")
       VALUES ($1, $2, $3, $4, $5, true)`,
      [leagueIds[0], SEASON, CURRENT_WEEK, teamB, teamC]
    );
    await pool.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
       VALUES ($1, $2, $3, $4, $5, 'BENCH')`,
      [leagueIds[0], teamB, playerIds.Bye, SEASON, CURRENT_WEEK]
    );
  });

  test.after(async () => {
    // Clean up the seeded rows and leave the schema fully migrated again
    // (knex_migrations row restored) so later CI steps in this job see the
    // same fully-migrated database the earlier `npm run migrate` produced.
    if (leagueIds.length > 0) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [leagueIds]);
    }
    const seededPlayerIds = Object.values(playerIds);
    if (seededPlayerIds.length > 0) {
      await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [seededPlayerIds]);
    }
    await pool.query(`DELETE FROM "nfl_games" WHERE "season" = $1`, [SEASON]);
    await pool.query(
      `DELETE FROM "users" WHERE "username" LIKE 'lineup_follows_roster_pg%'`
    );
    await knex.migrate.up({ name: MIGRATION_NAME });
    await pool.end();
    await knex.destroy();
  });

  test('the cleanup migration takes the stale unlocked rows and leaves every past week alone', async () => {
    assert.deepEqual(await survivingRows(teamA), [
      'KickedOff/9', 'Open/9', 'Bye/9', 'Kept/9',
      'KickedOff/10', 'Open/10', 'Bye/10', 'Kept/10',
      'KickedOff/11', 'Open/11', 'Bye/11', 'Kept/11',
    ].sort(), 'the pre-#197 state: every row stranded and still there');

    await knex.migrate.up({ name: MIGRATION_NAME });

    assert.deepEqual(await survivingRows(teamA), [
      // Past week: untouched in full, stale or not. This is the assertion
      // the acceptance criteria single out, and the one a careless
      // `week >= 1` predicate would break.
      'KickedOff/9', 'Open/9', 'Bye/9', 'Kept/9',
      // Current week: the kicked-off player keeps his row (he was on the
      // roster at kickoff and it carries his points), the still-rostered
      // player keeps his, and the two whose week is still open lose theirs.
      'KickedOff/10', 'Kept/10',
      // Future weeks: nothing but the rostered player survives.
      'Kept/11',
    ].sort());

    // A PAST SEASON is out of reach whatever its week number, which only the
    // season predicate can achieve: week 11 is >= the current week of 10.
    assert.deepEqual(await survivingRows(teamA, PRIOR_SEASON), ['Open/11']);
  });

  test('the cleanup migration leaves a settled week alone even where no game row answers', async () => {
    // Team B's own matchup for the current week is final. Its stale row is
    // for a player with no game that week, so the kickoff question alone
    // would have deleted it out of a week whose score is already settled -
    // and a settled week is scored from its entries with no roster join, so
    // that deletion would have moved the score.
    assert.deepEqual(await survivingRows(teamB), ['Bye/10']);
  });

  test('the cleanup migration matches nothing on a second pass', async () => {
    // The genuinely EMPTY-database case is the plain migrate/rollback/migrate
    // smoke that runs earlier in this same CI job, against a database with no
    // leagues at all. What this adds is the other end: run it again over rows
    // it has already cleaned and it must match nothing, throw nothing, and
    // take nothing else with it.
    //
    // up() first so this test does not depend on an earlier one having left
    // the migration applied; knex treats up() on an applied migration as a
    // no-op, and down() on an unapplied one as an error.
    await knex.migrate.up({ name: MIGRATION_NAME });
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM "lineup_entries"`);
    await knex.migrate.down({ name: MIGRATION_NAME });
    await knex.migrate.up({ name: MIGRATION_NAME });
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM "lineup_entries"`);

    assert.equal(after.rows[0].n, before.rows[0].n);
  });

  test('removeLineupEntries applies the same rule at runtime, row for row', async () => {
    const { removeLineupEntries } = require('../services/lineup.service');
    const league = { id: leagueIds[0], current_season: SEASON, current_week: CURRENT_WEEK };

    // Put the stale rows back, then let the runtime operation remove them
    // the way a drop would have, one departing player at a time.
    for (const week of [PAST_WEEK, CURRENT_WEEK, FUTURE_WEEK]) {
      for (const name of ['KickedOff', 'Open', 'Bye']) {
        await pool.query(
          `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
           VALUES ($1, $2, $3, $4, $5, 'BENCH')
           ON CONFLICT ("team_id", "season", "week", "player_id") DO NOTHING`,
          [leagueIds[0], teamA, playerIds[name], SEASON, week]
        );
      }
    }

    for (const name of ['KickedOff', 'Open', 'Bye']) {
      const outcome = await removeLineupEntries(pool, {
        league,
        teamId: teamA,
        playerId: playerIds[name],
        // Held since long before the week, so the spare's second condition
        // (#190: the departing tenure must itself have begun by kickoff) is
        // satisfied and this stays a test of the kickoff question alone.
        // The condition's own cases live in lineup.service.test.js.
        tenureStartedAt: new Date(`${SEASON}-09-01T00:00:00Z`),
      });
      assert.equal(
        outcome.removedCurrentWeek,
        name !== 'KickedOff',
        `${name}: the current week goes unless his game has started`
      );
    }

    assert.deepEqual(await survivingRows(teamA), [
      'KickedOff/9', 'Open/9', 'Bye/9', 'Kept/9',
      'KickedOff/10', 'Kept/10',
      'Kept/11',
    ].sort(), 'exactly what the migration left, reached the other way');
  });
}
