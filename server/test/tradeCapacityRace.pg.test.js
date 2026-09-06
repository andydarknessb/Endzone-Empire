/**
 * Disposable-Postgres test for the concurrent-trade roster-capacity race (#946).
 *
 * The defect: executeTrade runs its roster-capacity check while loadTrade holds
 * FOR UPDATE on the TRADES row only. loadTrade read the league and both teams
 * with plain SELECTs, no lock. Two trades on DIFFERENT trade rows that both send
 * a player to the SAME team lock two different trade rows (no contention), both
 * read the same roster count, both pass capacity, and both commit. The team ends
 * over its limit with no error anywhere.
 *
 * A hand-rolled fake pool cannot demonstrate this: the fakes are single-client
 * and serialize by construction, so a "race" against them proves nothing. Only
 * two REAL connections whose transactions actually overlap can. This is why the
 * ticket exists separately (#946) and why it gets a real Postgres.
 *
 * The claim, in the order a roster actually moves:
 *
 *   Team A sits one below its capacity. Two pending trades each send Team A a
 *   player (net +1 each) from two different other teams. Both receiving owners'
 *   accepts run CONCURRENTLY on real connections. With the League row locked
 *   FOR UPDATE the second accept blocks until the first commits, then re-reads
 *   the now-incremented count and is REFUSED (409). Exactly one trade executes;
 *   Team A lands exactly AT capacity, never over.
 *
 *   Reverting the lock change (dropping FOR UPDATE from loadTrade's league read)
 *   turns this red: both accepts read the stale sub-capacity count, both commit,
 *   and Team A ends one OVER capacity. The test asserts the fixed behaviour, so
 *   that revert flips exactly this assertion.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated twice:
 * PG_TESTS=1 (or its own TRADE_CAPACITY_RACE_PG_TESTS=1) must be set, and every
 * DATABASE_URL* variable must be ABSENT -- the service pool (server/modules/pool)
 * and this file's own pool both build their connection from PG* variables only
 * when no DATABASE_URL is present, so a stray local run can never touch the
 * shared production database. Mirrors rosterTenures.pg.test.js's gating exactly.
 *
 * Discovery is by glob: scripts/run-pg-tests.js runs every server/test/*.pg.test.js,
 * so naming this file *.pg.test.js is the whole of the wiring -- there is no list
 * to edit. It seeds and deletes its own league (a CASCADE removes its teams,
 * trades, trade_items, team_players, lineup_entries, transactions and
 * notifications) and its own users, so it leaves the shared database as it found
 * it, the way the other seed-and-delete files do.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.TRADE_CAPACITY_RACE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('trade capacity race PG test (skipped: set PG_TESTS=1 or TRADE_CAPACITY_RACE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('trade capacity race PG test refuses to run with DATABASE_URL* set', () => {
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

  // The real code under test. trade.service connects through server/modules/pool,
  // which reads the same PG* variables when no DATABASE_URL is set, so the two
  // accepts below run against this disposable database on real, separate
  // connections -- the only way to make the transactions overlap.
  const tradeService = require('../services/trade.service');
  const modulePool = require('../modules/pool');
  const {
    createDraftRoomBroadcast,
    setDraftRoomBroadcast,
  } = require('../modules/draftRoomBroadcast');

  // A league of its own, so nothing here collides with another suite's seed data
  // in the shared disposable database. 2077-2081, 2091 and 2098-2099 are already
  // spoken for by the holdout, roster-tenure and lineup suites.
  const SEASON = 2094;
  const CURRENT_WEEK = 1;
  // roster_limit 3 with ir_slots 0 makes rosterCapacity exactly 3 (it short-
  // circuits to draftRosterSize = roster_limit - ir_slots when ir_slots is 0).
  const ROSTER_LIMIT = 3;

  let priorBroadcast = null;
  let leagueId = null;
  let ownerAId = null;
  let teamA = null;
  let tradeId1 = null;
  let tradeId2 = null;
  const seededUserIds = [];

  async function rosterCount(teamId) {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [teamId]
    );
    return result.rows[0].n;
  }

  async function tradeStatus(tradeId) {
    const result = await pool.query(`SELECT "status" FROM "trades" WHERE "id" = $1`, [tradeId]);
    return result.rows[0].status;
  }

  test.before(async () => {
    // respondToTrade fires a post-commit room broadcast; getDraftRoomBroadcast()
    // throws when boot never registered one. Register a recording no-op so a
    // successful accept does not turn into a thrown "not initialised".
    priorBroadcast = setDraftRoomBroadcast(
      createDraftRoomBroadcast({ to: () => ({ emit: () => {} }) }, 'test')
    );

    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('tcr_owner_a', 'tcr-owner-a@example.invalid', 'x'),
              ('tcr_owner_b', 'tcr-owner-b@example.invalid', 'x'),
              ('tcr_owner_c', 'tcr-owner-c@example.invalid', 'x')
       RETURNING "id"`
    );
    for (const row of users.rows) seededUserIds.push(row.id);
    ownerAId = users.rows[0].id;
    const ownerBId = users.rows[1].id;
    const ownerCId = users.rows[2].id;

    // trade_veto_votes 0 disables the review window, so an accept executes the
    // trade in the same transaction (respondToTrade's reviewed === false path);
    // trade_deadline_week null means no deadline; ir_slots 0 pins capacity to 3.
    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "trade_veto_votes")
       VALUES ('PG Trade Capacity Race', $1, 'tcr001', $2, $3, $4, 0, 0)
       RETURNING "id"`,
      [ownerAId, SEASON, CURRENT_WEEK, ROSTER_LIMIT]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Receiver'), ($1, $3, 'PG Sender B'), ($1, $4, 'PG Sender C')
       RETURNING "id", "name"`,
      [leagueId, ownerAId, ownerBId, ownerCId]
    );
    teamA = teams.rows.find((t) => t.name === 'PG Receiver').id;
    const teamB = teams.rows.find((t) => t.name === 'PG Sender B').id;
    const teamC = teams.rows.find((t) => t.name === 'PG Sender C').id;

    // Team A holds two of its three spots; each incoming player fills the last
    // one, so either trade alone is legal and the two together are one over.
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG A Held One', 'QB', 'TCA'),
              ('PG A Held Two', 'RB', 'TCA'),
              ('PG Incoming One', 'WR', 'TCB'),
              ('PG Incoming Two', 'WR', 'TCC')
       RETURNING "id", "name"`
    );
    const idByName = new Map(players.rows.map((p) => [p.name, p.id]));
    const heldOne = idByName.get('PG A Held One');
    const heldTwo = idByName.get('PG A Held Two');
    const incomingOne = idByName.get('PG Incoming One');
    const incomingTwo = idByName.get('PG Incoming Two');

    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES
         ($1, $2, $3), ($1, $2, $4),
         ($1, $5, $6),
         ($1, $7, $8)`,
      [leagueId, teamA, heldOne, heldTwo, teamB, incomingOne, teamC, incomingTwo]
    );

    // Two pending trades, each proposed to Team A (A is the RECEIVING owner and
    // accepts both). Each item moves one player TO Team A and nothing back, so
    // each is a net +1 for Team A. proposeTrade would reject a one-directional
    // offer; the race is about execution, so the rows are seeded directly.
    const madeTrades = await pool.query(
      `INSERT INTO "trades" ("league_id", "proposing_team_id", "receiving_team_id", "status")
       VALUES ($1, $2, $3, 'pending'), ($1, $4, $3, 'pending')
       RETURNING "id", "proposing_team_id"`,
      [leagueId, teamB, teamA, teamC]
    );
    tradeId1 = madeTrades.rows.find((r) => r.proposing_team_id === teamB).id;
    tradeId2 = madeTrades.rows.find((r) => r.proposing_team_id === teamC).id;

    await pool.query(
      `INSERT INTO "trade_items" ("trade_id", "player_id", "from_team_id", "to_team_id")
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $4)`,
      [tradeId1, incomingOne, teamB, teamA, tradeId2, incomingTwo, teamC]
    );
  });

  test.after(async () => {
    if (leagueId != null) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    }
    if (seededUserIds.length) {
      await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [seededUserIds]);
    }
    setDraftRoomBroadcast(priorBroadcast);
    await pool.end();
    await modulePool.end();
  });

  test('two concurrent trades into a full-but-one roster: one executes, one is refused, roster never exceeds capacity', async () => {
    assert.equal(await rosterCount(teamA), ROSTER_LIMIT - 1, 'precondition: Team A starts one below capacity');

    // Both accepts, by the same receiving owner, launched in one tick so their
    // transactions overlap on real connections.
    const results = await Promise.allSettled([
      tradeService.respondToTrade({ tradeId: tradeId1, userId: ownerAId, action: 'accept' }),
      tradeService.respondToTrade({ tradeId: tradeId2, userId: ownerAId, action: 'accept' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(
      fulfilled.length,
      1,
      `exactly one trade must execute; got ${fulfilled.length} executed, ${rejected.length} refused`
    );
    assert.equal(rejected.length, 1, 'exactly one trade must be refused');
    assert.equal(fulfilled[0].value.status, 'executed', 'the winning accept reports executed');
    assert.equal(
      rejected[0].reason.statusCode,
      409,
      `the refused accept is a 409 capacity refusal, got: ${rejected[0].reason && rejected[0].reason.message}`
    );

    assert.equal(
      await rosterCount(teamA),
      ROSTER_LIMIT,
      'Team A ends AT capacity, never over -- the whole point of the lock'
    );

    // One trade executed, the other stayed pending (its transaction rolled back).
    const statuses = [await tradeStatus(tradeId1), await tradeStatus(tradeId2)].sort();
    assert.deepEqual(
      statuses,
      ['executed', 'pending'],
      'one trade committed as executed, the refused one rolled back to pending'
    );
  });
}
