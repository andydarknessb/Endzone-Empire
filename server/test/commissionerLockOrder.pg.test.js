/**
 * Disposable-Postgres test for the commissioner Team writes' lock order (#2545).
 *
 * The claim: `setTeamFaab` and `setTeamLocked` take the League row FOR UPDATE
 * before the Team row, the League-then-Team order every roster writer uses
 * (see rosterDropLockOrder.pg.test.js, #962). They used to call
 * `requireCommissioner` without `forUpdate`, UPDATE the Team row, and only then
 * reach the League row, through the transactions log's foreign key (a FOR KEY
 * SHARE lock). A waiver run holds the League row and then asks for the Team
 * row, so the pair is AB/BA and Postgres kills one with SQLSTATE 40P01. The
 * same inversion lets a FAAB edit land between the waiver run's FAAB read and
 * its Team lock.
 *
 * The holder here stands in for the waiver run: one connection that holds the
 * League row and then asks for the Team row. A fake pool cannot show this (its
 * fakes are single-client and serialize by construction); only two real
 * connections can.
 *
 * The interleaving is forced, not hoped for:
 *
 *   1. Holder H opens a transaction and takes the League row FOR UPDATE.
 *   2. The commissioner write starts.
 *        - League-then-Team (fixed): requireCommissioner asks for the League
 *          row FOR UPDATE and blocks there, holding nothing.
 *        - Team-then-League (the revert): the League read is unlocked, the
 *          UPDATE takes the Team row, and the log insert blocks on the League
 *          row behind H, now HOLDING the Team row.
 *   3. H asks for the Team row.
 *        - Fixed: nothing holds it, H gets it and commits; the write then runs.
 *        - Reverted: H waits on the write, the write waits on H. Cycle, and one
 *          dies with 40P01.
 *
 * `forceSetLineup` is the third case: it already locked the Team row FOR UPDATE
 * but read the League unlocked, then reached the League row again through the
 * log's foreign key, so it inverted the order the same way.
 *
 * Red-tell: dropping `forUpdate: true` from `setTeamFaab`, `setTeamLocked` or
 * `forceSetLineup` in server/services/commissioner.service.js turns the
 * matching case red.
 *
 * Runs ONLY where a disposable Postgres is available, gated twice: PG_TESTS=1
 * (or COMMISSIONER_LOCK_ORDER_PG_TESTS=1) must be exactly '1', and every
 * DATABASE_URL* variable must be ABSENT, so a stray local run can never touch
 * the shared production database. Mirrors rosterDropLockOrder.pg.test.js.
 * scripts/run-pg-tests.js discovers it by the *.pg.test.js glob.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.COMMISSIONER_LOCK_ORDER_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('commissioner lock-order PG test (skipped: set PG_TESTS=1 or COMMISSIONER_LOCK_ORDER_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('commissioner lock-order PG test refuses to run with DATABASE_URL* set', () => {
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
  const commissionerService = require('../services/commissioner.service');
  const modulePool = require('../modules/pool');

  // Arbitrary: nothing here reads season-scoped rows beyond materializing one lineup.
  const SEASON = 2093;

  let leagueId = null;
  let playerId = null;
  let ownerId = null;
  let teamId = null;
  const seededUserIds = [];

  /** Wait until `n` backends are blocked on a lock, so the next step runs only once the last one is parked. */
  async function waitForBlocked(n, what) {
    const deadline = Date.now() + 10000;
    for (;;) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "pg_stat_activity"
          WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`
      );
      if (result.rows[0].n >= n) return;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${n} blocked backend(s): ${what}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  test.before(async () => {
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('cmlo_owner', 'cmlo-owner@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = users.rows[0].id;
    seededUserIds.push(ownerId);

    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG Commissioner Lock Order', $1, 'cmlo01', $2, 1, 10, 0, 24, 'complete')
       RETURNING "id"`,
      [ownerId, SEASON]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Locked Team') RETURNING "id"`,
      [leagueId, ownerId]
    );
    teamId = teams.rows[0].id;

    // One rostered player, so forceSetLineup has a lineup to materialize and move.
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Lock Order Player', 'RB', 'CLO') RETURNING "id"`
    );
    playerId = players.rows[0].id;
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, teamId, playerId]
    );
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
    await pool.end();
    await modulePool.end();
  });

  // Read at call time: the ids are seeded in test.before, after this file loads.
  function run(name) {
    const base = { leagueId, userId: ownerId, teamId };
    if (name === 'setTeamFaab') return commissionerService.setTeamFaab({ ...base, faabRemaining: 42 });
    if (name === 'setTeamLocked') return commissionerService.setTeamLocked({ ...base, locked: true });
    return commissionerService.forceSetLineup({ ...base, moves: [{ playerId, slot: 'BENCH' }] });
  }

  async function assertNoDeadlock(name) {
    const holder = await pool.connect();
    let holderOpen = false;
    let holderError = null;
    let settled;
    try {
      // 1. The holder (a stand-in for the waiver run) takes the League row.
      await holder.query('BEGIN');
      holderOpen = true;
      await holder.query(`SELECT "id" FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [leagueId]);

      // 2. The write starts and parks on a lock behind the holder.
      settled = run(name).then(() => null, (error) => error);
      await waitForBlocked(1, `${name} parked behind the league row`);

      // 3. The holder asks for the Team row. Fixed: free, so it commits.
      //    Reverted: the write holds it, so this closes the cycle.
      try {
        await holder.query(`SELECT "id" FROM "teams" WHERE "id" = $1 FOR UPDATE`, [teamId]);
        await holder.query('COMMIT');
      } catch (error) {
        holderError = error;
        await holder.query('ROLLBACK').catch(() => {});
      }
      holderOpen = false;
    } finally {
      if (holderOpen) await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
    const writeError = await settled;

    const errors = [holderError, writeError].filter(Boolean);
    assert.deepEqual(
      errors.filter((e) => e.code === '40P01').map((e) => e.message),
      [],
      'no transaction may die of deadlock detection (40P01)'
    );
    assert.deepEqual(errors.map((e) => e.message), [], 'both must succeed once they serialize');
  }

  test('setTeamFaab against a League-then-Team holder does not deadlock', () => assertNoDeadlock('setTeamFaab'));
  test('setTeamLocked against a League-then-Team holder does not deadlock', () => assertNoDeadlock('setTeamLocked'));
  test('forceSetLineup against a League-then-Team holder does not deadlock', () => assertNoDeadlock('forceSetLineup'));
}
