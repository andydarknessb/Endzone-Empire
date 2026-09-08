/**
 * Disposable-Postgres test for the drop / forced-transaction lock order (#962).
 *
 * The claim: a manager drop and a commissioner forced transaction on the SAME
 * league and the SAME team can run concurrently without deadlocking, because
 * both now take the League row FOR UPDATE before the Team row.
 *
 * The drop was the one roster write in the server that inverted that order. It
 * took the Team row FOR UPDATE through `requireMember({ forUpdate: true })` and
 * then read the League unlocked, so on its own it could not deadlock with
 * anything. Adopting the #944 write gate is what makes the order matter: the
 * gate takes League FOR UPDATE and then Team FOR UPDATE, so a drop that kept
 * the Team-first membership lock would run Team -> League while
 * `forceTransaction` runs League -> Team (requireCommissioner with forUpdate,
 * then `SELECT * FROM "teams" ... FOR UPDATE`). That is an AB/BA pair, and
 * Postgres resolves it by killing one transaction with SQLSTATE 40P01.
 *
 * A fake pool cannot demonstrate this: the fakes are single-client and
 * serialize by construction, so a "race" against them proves nothing. Only two
 * real connections whose transactions actually overlap can - the same reason
 * tradeCapacityRace.pg.test.js (#946) exists.
 *
 * The interleaving is FORCED rather than hoped for, so this is a deterministic
 * test and not a flaky one. A third connection holds the Team row, which parks
 * the forced transaction after it has taken the League lock and before it can
 * take the Team lock:
 *
 *   1. Holder H opens a transaction and takes the Team row FOR UPDATE.
 *   2. forceTransaction starts. It takes the League row FOR UPDATE, then blocks
 *      on the Team row behind H.
 *   3. dropPlayer starts.
 *        - League-then-Team (fixed): its FIRST lock request is the League row,
 *          held by forceTransaction, so it blocks there holding nothing.
 *        - Team-then-League (the revert): it queues for the Team row behind H
 *          instead, holding nothing yet.
 *   4. H commits and releases the Team row.
 *        - Fixed: forceTransaction takes the Team row, finishes, releases the
 *          League row, and the drop then runs. Both succeed. No deadlock.
 *        - Reverted: the drop wins the Team row (it queued first), then asks
 *          for the League row that forceTransaction holds, while
 *          forceTransaction is still waiting for the Team row the drop now
 *          holds. Cycle. One of them dies with 40P01.
 *
 * Red-tell: restoring `forUpdate: true` on dropPlayer's `requireMember` call in
 * server/services/draft.service.js turns this red - one of the two settled
 * promises rejects with `error.code === '40P01'` ("deadlock detected"), which
 * is exactly what the assertion below forbids.
 *
 * Runs ONLY where a disposable Postgres is available, gated twice: PG_TESTS=1
 * (or its own ROSTER_DROP_LOCK_ORDER_PG_TESTS=1) must be set to exactly '1',
 * and every DATABASE_URL* variable must be ABSENT - the service pool
 * (server/modules/pool) and this file's own pool both build their connection
 * from PG* variables only when no DATABASE_URL is present, so a stray local run
 * can never touch the shared production database. Mirrors
 * tradeCapacityRace.pg.test.js's gating exactly.
 *
 * Discovery is by glob: scripts/run-pg-tests.js runs every
 * server/test/*.pg.test.js, so naming this file *.pg.test.js is the whole of
 * the wiring. It seeds and deletes its own league (a CASCADE removes its teams,
 * team_players, lineup_entries, waiver_players, transactions and
 * notifications) and its own users, and deletes its seeded players EXPLICITLY,
 * because the players table is global and the league CASCADE does not reach it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.ROSTER_DROP_LOCK_ORDER_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('roster drop lock-order PG test (skipped: set PG_TESTS=1 or ROSTER_DROP_LOCK_ORDER_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('roster drop lock-order PG test refuses to run with DATABASE_URL* set', () => {
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
  // Three: the holder, and this file's own reads.
  const pool = new pg.Pool({ ...connection, max: 3 });

  // The real code under test. Both services connect through server/modules/pool,
  // which reads the same PG* variables when no DATABASE_URL is set, so the drop
  // and the forced transaction run against this disposable database on real,
  // separate connections - the only way to make the transactions overlap.
  const draftService = require('../services/draft.service');
  const commissionerService = require('../services/commissioner.service');
  const modulePool = require('../modules/pool');

  // A season of its own, so nothing here collides with another suite's seed
  // data. 2077-2081, 2091, 2094 and 2098-2099 are already spoken for by the
  // holdout, roster-tenure, lineup and trade-race suites.
  const SEASON = 2095;
  const CURRENT_WEEK = 1;

  let leagueId = null;
  let ownerId = null;
  let teamId = null;
  let dropPlayerId = null;
  let addPlayerId = null;
  const seededUserIds = [];
  const seededPlayerIds = [];

  /**
   * Wait until `n` backends in this database are blocked on a lock. Polling
   * pg_stat_activity is what makes the interleaving deterministic instead of
   * relying on a sleep: the next step only runs once the previous one has
   * actually reached the lock it is supposed to be parked on.
   */
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
       VALUES ('rdlo_owner', 'rdlo-owner@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = users.rows[0].id;
    seededUserIds.push(ownerId);

    // The league owner is also the team's manager, so one user is both the
    // commissioner forcing a transaction and the manager dropping - the same
    // league and the same team on both paths, which is the pair the ticket
    // names. transactions_locked stays false: this file is about lock ORDER,
    // and the freeze refusal is proved at the fake-pool seam.
    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG Roster Drop Lock Order', $1, 'rdlo01', $2, $3, 10, 0, 24, 'complete')
       RETURNING "id"`,
      [ownerId, SEASON, CURRENT_WEEK]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Dropper') RETURNING "id"`,
      [leagueId, ownerId]
    );
    teamId = teams.rows[0].id;

    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Drop Me', 'RB', 'RDL'), ('PG Force Add Me', 'WR', 'RDL')
       RETURNING "id", "name"`
    );
    for (const row of players.rows) seededPlayerIds.push(row.id);
    const idByName = new Map(players.rows.map((p) => [p.name, p.id]));
    dropPlayerId = idByName.get('PG Drop Me');
    addPlayerId = idByName.get('PG Force Add Me');

    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, teamId, dropPlayerId]
    );
  });

  test.after(async () => {
    if (leagueId != null) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    }
    if (seededPlayerIds.length) {
      await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [seededPlayerIds]);
    }
    if (seededUserIds.length) {
      await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [seededUserIds]);
    }
    await pool.end();
    await modulePool.end();
  });

  test('a drop and a forced transaction on the same league and team do not deadlock', async () => {
    const holder = await pool.connect();
    let holderOpen = false;
    let settled = null;
    try {
      // 1. Park the Team row so the forced transaction cannot finish.
      await holder.query('BEGIN');
      holderOpen = true;
      await holder.query(`SELECT "id" FROM "teams" WHERE "id" = $1 FOR UPDATE`, [teamId]);

      // 2. The forced transaction takes the League row, then blocks on the Team
      //    row behind the holder.
      const forced = commissionerService.forceTransaction({
        leagueId, userId: ownerId, teamId, action: 'add', playerId: addPlayerId,
      });
      await waitForBlocked(1, 'forceTransaction parked on the team row while holding the league row');

      // 3. The drop starts. Fixed: it blocks on the LEAGUE row, holding nothing.
      //    Reverted (requireMember forUpdate: true): it queues for the TEAM row,
      //    which is what closes the cycle at step 4.
      const drop = draftService.dropPlayer({ leagueId, userId: ownerId, playerId: dropPlayerId });
      await waitForBlocked(2, 'the drop parked on its first lock');

      // 4. Release. Either the two serialize (fixed) or Postgres kills one (revert).
      await holder.query('COMMIT');
      holderOpen = false;
      settled = await Promise.allSettled([forced, drop]);
    } finally {
      if (holderOpen) await holder.query('ROLLBACK');
      holder.release();
    }

    const deadlocked = settled.filter((r) => r.status === 'rejected' && r.reason && r.reason.code === '40P01');
    assert.equal(
      deadlocked.length,
      0,
      `no transaction may die of deadlock detection (40P01); got ${deadlocked.length}: ` +
        deadlocked.map((r) => r.reason.message).join(' | ')
    );

    const rejected = settled.filter((r) => r.status === 'rejected');
    assert.equal(
      rejected.length,
      0,
      `both must succeed once they serialize; got: ${rejected.map((r) => r.reason && r.reason.message).join(' | ')}`
    );

    // The end state proves both really ran rather than both quietly no-opping:
    // the forced add landed and the drop removed the player it was given.
    const roster = await pool.query(
      `SELECT "player_id" FROM "team_players" WHERE "team_id" = $1 ORDER BY "player_id"`,
      [teamId]
    );
    assert.deepEqual(
      roster.rows.map((r) => r.player_id),
      [addPlayerId],
      'the forced add landed and the dropped player is gone'
    );
  });
}
