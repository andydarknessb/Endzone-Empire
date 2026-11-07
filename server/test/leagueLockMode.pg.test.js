/**
 * Disposable-Postgres repro for the League row lock mode (#2683, spec #2681).
 *
 * The claim: two write pairs deadlock today. In each pair the first transaction
 * holds the League row FOR UPDATE and then asks for a row the second
 * transaction holds. The second transaction inserts a row carrying league_id,
 * and that insert's foreign-key check takes FOR KEY SHARE on the League row,
 * which FOR UPDATE blocks. Postgres kills one side with SQLSTATE 40P01.
 *
 *   1. Waiver run vs lineup save. The waiver run holds the League row, then
 *      asks for the claiming Team row (the roster gate). setLineup locks the
 *      Team row, then materializeLineup inserts lineup_entries with league_id.
 *   2. Manual score vs stat correction. adjustMatchupScore holds the League row,
 *      then asks for the Matchup row. correctWeek locks the week's
 *      Matchups, then writes its transactions row with league_id.
 *
 * The holder stands in for the first transaction. It takes the League row with
 * requireOwner({ forUpdate: true }), the same forUpdate League read the waiver
 * run and adjustMatchupScore use, then asks for the second lock with the SQL
 * the service runs. The second side is the real service function.
 *
 * The interleaving is forced, not hoped for:
 *
 *   1. The holder opens a transaction and takes the League row.
 *   2. The real second-side write starts.
 *        - League FOR UPDATE (today): its foreign-key insert blocks behind the holder.
 *        - League FOR NO KEY UPDATE: nothing blocks and the write completes.
 *   3. The holder asks for the second lock.
 *        - Today: the write holds it, so this closes the cycle and one side dies 40P01.
 *        - Fixed: the write is done, or waits only briefly, and both succeed.
 *
 * shortcut: the holder is a stand-in, not the real waiver run or adjustMatchupScore,
 * because neither can pause between its League lock and its second lock.
 * Upgrade when a service can be driven to a mid-transaction pause point.
 *
 * Red-tell: restoring FOR UPDATE on the League read in requireOwner
 * (server/services/leagueRole.service.js) turns both cases red with 40P01.
 *
 * Runs ONLY where a disposable Postgres is available, gated twice: PG_TESTS=1
 * (or LEAGUE_LOCK_MODE_PG_TESTS=1) must be exactly '1', and every DATABASE_URL*
 * variable must be ABSENT, so a stray local run never touches the shared
 * production database. Mirrors commissionerLockOrder.pg.test.js. CI's
 * migration-smoke job runs it through scripts/run-pg-tests.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEAGUE_LOCK_MODE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('league lock mode PG test (skipped: set PG_TESTS=1 or LEAGUE_LOCK_MODE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('league lock mode PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
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
  // Two: the holder, and this file's own reads.
  const pool = new pg.Pool({ ...connection, max: 2 });

  // The real code under test connects through server/modules/pool, which reads
  // the same PG* variables when no DATABASE_URL is set.
  const { requireOwner } = require('../services/leagueRole.service');
  const lineupService = require('../services/lineup.service');
  const settleService = require('../services/settle.service');
  const modulePool = require('../modules/pool');
  const { createDraftRoomBroadcast, setDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');

  // Arbitrary: no other *.pg.test.js seeds this season's league rows.
  const SEASON = 2097;
  const WEEK = 1;

  let leagueId = null;
  let playerId = null;
  let ownerId = null;
  let teamId = null;
  let matchupId = null;
  const seededUserIds = [];
  let priorBroadcast;

  /** Wait until a backend is blocked on a lock, or the write has finished, so the next step runs once the write has reached its lock or completed. */
  async function waitForBlockedOrDone(isDone, what) {
    const deadline = Date.now() + 10000;
    for (;;) {
      if (isDone()) return;
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "pg_stat_activity"
          WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`
      );
      if (result.rows[0].n >= 1) return;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for a blocked backend or completion: ${what}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  test.before(async () => {
    // correctWeek announces its scores after commit through the draft-room
    // broadcast; a no-op adapter keeps that out of this file's assertions.
    priorBroadcast = setDraftRoomBroadcast(createDraftRoomBroadcast({ to: () => ({ emit: () => {} }) }, 'test'));

    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('lklm_owner', 'lklm-owner@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = users.rows[0].id;
    seededUserIds.push(ownerId);

    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG League Lock Mode', $1, 'lklm01', $2, $3, 10, 0, 24, 'complete')
       RETURNING "id"`,
      [ownerId, SEASON, WEEK]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Lock Mode Team') RETURNING "id"`,
      [leagueId, ownerId]
    );
    teamId = teams.rows[0].id;

    // One rostered player, so setLineup has a lineup to materialize.
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Lock Mode Player', 'RB', 'LKM') RETURNING "id"`
    );
    playerId = players.rows[0].id;
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, teamId, playerId]
    );

    // A stored score the re-score cannot match, so correctWeek finds a
    // change and writes its transactions row, which is the insert under test.
    // Not final: a final matchup locks the week's lineup, and setLineup must
    // reach its lineup_entries insert.
    const matchups = await pool.query(
      `INSERT INTO "matchups"
         ("league_id", "season", "week", "home_team_id", "away_team_id",
          "home_score", "away_score", "final", "is_playoff")
       VALUES ($1, $2, $3, $4, $4, 999, 999, false, false)
       RETURNING "id"`,
      [leagueId, SEASON, WEEK, teamId]
    );
    matchupId = matchups.rows[0].id;
  });

  test.after(async () => {
    if (leagueId != null) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    }
    // The players table is global; the league CASCADE does not reach it.
    if (playerId != null) {
      await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
    }
    if (seededUserIds.length) {
      await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [seededUserIds]);
    }
    setDraftRoomBroadcast(priorBroadcast);
    await pool.end();
    await modulePool.end();
  });

  // The real second-side write for each pair. Read at call time: the ids are
  // seeded in test.before, after this file loads.
  const PAIRS = {
    setLineup: {
      run: () => lineupService.setLineup({
        leagueId,
        userId: ownerId,
        week: WEEK,
        moves: [{ playerId, slot: 'BENCH' }],
      }),
      // The waiver run's second lock: the claiming Team row (roster gate).
      secondLock: {
        sql: `SELECT "id", "locked" FROM "teams" WHERE "id" = $1 FOR UPDATE`,
        params: () => [teamId],
      },
    },
    correctWeek: {
      run: () => settleService.correctWeek({ leagueId, season: SEASON, week: WEEK }),
      // adjustMatchupScore's second lock: the Matchup row.
      secondLock: {
        sql: `SELECT "id" FROM "matchups" WHERE "id" = $1 AND "league_id" = $2 FOR UPDATE`,
        params: () => [matchupId, leagueId],
      },
    },
  };

  async function assertNoDeadlock(name) {
    const pair = PAIRS[name];
    const holder = await pool.connect();
    let holderOpen = false;
    let holderError = null;
    let writeDone = false;
    let settled;
    let writeError;
    try {
      // 1. The holder takes the League row, as the first transaction does.
      await holder.query('BEGIN');
      holderOpen = true;
      await requireOwner(holder, { leagueId, userId: ownerId, forUpdate: true });

      // 2. The real second-side write starts, and runs until it blocks or finishes.
      settled = pair.run()
        .then(() => null, (error) => error)
        .then((error) => { writeDone = true; return error; });
      await waitForBlockedOrDone(() => writeDone, `${name} behind the league row`);

      // 3. The holder asks for the second lock. Today the write holds it, so
      //    this closes the cycle. Fixed: the write is done or free.
      try {
        await holder.query(pair.secondLock.sql, pair.secondLock.params());
        await holder.query('COMMIT');
      } catch (error) {
        holderError = error;
        await holder.query('ROLLBACK').catch(() => {});
      }
      holderOpen = false;
    } finally {
      if (holderOpen) await holder.query('ROLLBACK').catch(() => {});
      holder.release();
      // Awaited here so it also runs when the setup above threw: the write must
      // not outlive the test and run against rows test.after deletes.
      writeError = await settled;
    }

    const errors = [holderError, writeError].filter(Boolean);
    assert.deepEqual(
      errors.filter((e) => e.code === '40P01').map((e) => e.message),
      [],
      'no transaction may die of deadlock detection (40P01)'
    );
    assert.deepEqual(errors.map((e) => e.message), [], 'both must succeed once they serialize');
  }

  test('setLineup against a waiver-run League holder does not deadlock', () => assertNoDeadlock('setLineup'));
  test('correctWeek against an adjustMatchupScore League holder does not deadlock', () => assertNoDeadlock('correctWeek'));
}
