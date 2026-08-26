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
 * The two are asserted side by side deliberately. The migration exists
 * precisely to make the database agree with what the runtime will maintain
 * from now on; if they disagree where they are meant to agree, this file is
 * where that shows.
 *
 * THEY NO LONGER AGREE IN GENERAL, AND THE DIFFERENCE IS DELIBERATE (#228).
 * The runtime rule gained a second condition: the current-week row is spared
 * only if the game kicked off AND a tenure of this team covered that kickoff.
 * The one-shot migration keeps the kickoff-only rule it shipped with, so for
 * ONE input - a stale current-week row whose player's game kicked off but who
 * has no tenure covering it - the migration SPARES the row and the runtime
 * REMOVES it.
 *
 * That direction matters: the migration under-deletes rather than
 * over-deletes, and the next runtime departure takes the row anyway, so it is
 * self-correcting rather than data-losing. It is also not reachable in
 * production, where the migration matched zero rows (#205). It IS reachable
 * in the other environments this migration's own header names - a developer
 * database, a restored backup - which would get two different answers to the
 * same question.
 *
 * ONE CASE RUNS THE OTHER WAY, so "under-deletion, therefore self-correcting"
 * covers the divergence above but not the deploy straddle. The backfill opens
 * one tenure per CURRENT roster row (20260823000003), so a tenure already
 * CLOSED when it ran is unrecorded and is not reconstructed (ADR 0006): a
 * player held through his kickoff, dropped before the migration, then re-added
 * and dropped again after it, is judged on his new tenure alone, which begins
 * after the kickoff - so the spare does not fire and the runtime OVER-deletes
 * the row recording a week he did play (#106). Nothing puts that row back, but
 * it needs a drop predating the migration, so it cannot outlive the first week
 * starting after deploy - the boundary that migration's header calls history
 * starting here. Window long closed, production exposure nil at zero rows
 * (#205). Noted so the asymmetry reads as known, not as an oversight.
 *
 * So what these tests assert together is narrower than it was: the two agree
 * for every player whose tenure history is known, which is every player the
 * runtime will ever be called for from now on, because the trigger records
 * the tenure before `removeLineupEntries` is reached. The legacy row with no
 * tenure at all is where they part.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: LINEUP_FOLLOWS_ROSTER_PG_TESTS=1 must be set explicitly, and every
 * DATABASE_URL* variable must be ABSENT -- connections are built from PG*
 * variables only, so a stray local run can never touch the shared
 * production database (server/knexfile.js loads .env; this file
 * deliberately does not). Mirrors teamNamesBackfill.pg.test.js's gating
 * exactly.
 *
 * Seeds and deletes its own far-future season in the single migration-smoke
 * database, so scripts/run-pg-tests.js runs it before the holdout tests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LINEUP_FOLLOWS_ROSTER_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('lineup-follows-roster PG tests (skipped: set PG_TESTS=1 or LINEUP_FOLLOWS_ROSTER_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
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
  let latePlayerId = null;
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

    /*
     * A fifth player, deliberately NOT in `playerIds`, so he stays out of the
     * card `before` builds and out of `survivingRows`' vocabulary. The
     * post-kickoff-acquisition test needs a player with NO tenure history at
     * all, and every player in `playerIds` acquires one earlier in the file:
     * the runtime test drops each of them after backdating a tenure, which
     * leaves a CLOSED tenure covering kickoff. Re-adding such a player is the
     * #229 case and he is correctly spared, so reusing one would have proved
     * the opposite of what that test is for.
     */
    const late = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Late Pickup', 'RB', 'PGK') RETURNING "id"`
    );
    latePlayerId = late.rows[0].id;

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
    if (latePlayerId !== null) {
      await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [latePlayerId]);
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

  /**
   * A departure, as the six real callers actually perform one: the roster row
   * goes first, and `removeLineupEntries` cleans up after it inside the same
   * transaction. `acquiredAt` backdates the tenure the INSERT's trigger just
   * opened, which is the only way to express "he was already here last week"
   * against a live trigger that stamps `now()`.
   *
   * Doing it this way rather than calling the runtime operation for a player
   * who never had a roster row is what makes the tenure real: the DELETE's
   * trigger closes the tenure at `now()`, so what the spare predicate reads is
   * a genuinely closed tenure rather than a seeded row.
   */
  async function departAfterHolding(playerId, acquiredAt) {
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueIds[0], teamA, playerId]
    );
    await pool.query(
      `UPDATE "roster_tenures" SET "acquired_at" = $3
        WHERE "team_id" = $1 AND "player_id" = $2 AND "released_at" IS NULL`,
      [teamA, playerId, acquiredAt]
    );
    await pool.query(
      `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
      [teamA, playerId]
    );
  }

  /** Every week's stale rows back on the card, so a departure has work to do. */
  async function reseedEntries(names) {
    for (const week of [PAST_WEEK, CURRENT_WEEK, FUTURE_WEEK]) {
      for (const name of names) {
        await pool.query(
          `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
           VALUES ($1, $2, $3, $4, $5, 'BENCH')
           ON CONFLICT ("team_id", "season", "week", "player_id") DO NOTHING`,
          [leagueIds[0], teamA, playerIds[name], SEASON, week]
        );
      }
    }
  }

  test('removeLineupEntries reaches the migration\'s rows for players whose tenure is known', async () => {
    const { removeLineupEntries } = require('../services/lineup.service');
    const league = { id: leagueIds[0], current_season: SEASON, current_week: CURRENT_WEEK };

    // Put the stale rows back, then let the runtime operation remove them
    // the way a drop would have, one departing player at a time.
    await reseedEntries(['KickedOff', 'Open', 'Bye']);

    for (const name of ['KickedOff', 'Open', 'Bye']) {
      // Each of them was on this roster well before his game (#228). Without
      // that the spare could not fire for anyone, because the trigger stamps
      // a tenure opened NOW, and now is after a kickoff three hours ago.
      await departAfterHolding(playerIds[name], new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      const outcome = await removeLineupEntries(pool, {
        league, teamId: teamA, playerId: playerIds[name],
      });
      assert.equal(
        outcome.removedCurrentWeek,
        name !== 'KickedOff',
        `${name}: the current week goes unless his game has started and he was held for it`
      );
    }

    assert.deepEqual(await survivingRows(teamA), [
      'KickedOff/9', 'Open/9', 'Bye/9', 'Kept/9',
      'KickedOff/10', 'Kept/10',
      'Kept/11',
    ].sort(), 'exactly what the migration left, reached the other way, for players whose tenure is known');
  });

  test('a post-kickoff acquisition does not keep the row his game would have earned him (#228)', async () => {
    // The half of the rule no fake can prove, because it turns on a tenure
    // the DATABASE wrote: the trigger stamps `now()`, so a player acquired
    // after his game was played has a tenure that begins after kickoff.
    //
    // #197 made a surviving current-week row mean "he was on this roster at
    // kickoff". Kickoff alone cannot carry that: this player is locked by the
    // schedule while having been held for none of the game, so his row would
    // otherwise survive as evidence of a week he did not play here (#190).
    const { removeLineupEntries } = require('../services/lineup.service');
    const league = { id: leagueIds[0], current_season: SEASON, current_week: CURRENT_WEEK };

    // He is on team PGK, whose game kicked off three hours ago, and he has no
    // tenure history whatsoever.
    for (const week of [PAST_WEEK, CURRENT_WEEK, FUTURE_WEEK]) {
      await pool.query(
        `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
         VALUES ($1, $2, $3, $4, $5, 'BENCH')`,
        [leagueIds[0], teamA, latePlayerId, SEASON, week]
      );
    }
    // Picked up NOW, after the game. No backdating: this is exactly what the
    // trigger writes on its own, which is the point of proving it here.
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueIds[0], teamA, latePlayerId]
    );
    const opened = await pool.query(
      `SELECT "acquired_at" > (SELECT "kickoff_at" FROM "nfl_games"
                                WHERE "season" = $3 AND "week" = $4 AND "nfl_team" = 'PGK')
              AS "after_kickoff"
         FROM "roster_tenures"
        WHERE "team_id" = $1 AND "player_id" = $2 AND "released_at" IS NULL`,
      [teamA, latePlayerId, SEASON, CURRENT_WEEK]
    );
    assert.equal(
      opened.rows[0].after_kickoff, true,
      'the trigger opened his tenure after his game had started, which is the premise of this test'
    );
    await pool.query(
      `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2`,
      [teamA, latePlayerId]
    );

    const outcome = await removeLineupEntries(pool, {
      league, teamId: teamA, playerId: latePlayerId,
    });

    assert.equal(
      outcome.removedCurrentWeek, true,
      'his game had kicked off, but no tenure covered it, so the row goes'
    );
    const weeks = await pool.query(
      `SELECT "week" FROM "lineup_entries"
        WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3 ORDER BY "week"`,
      [teamA, latePlayerId, SEASON]
    );
    assert.deepEqual(
      weeks.rows.map((r) => r.week), [PAST_WEEK],
      'the current and future weeks went; the past week, the record of a week as played, did not'
    );
  });
}
