/**
 * Disposable-Postgres proof that two overlapping processWaivers runs settle every
 * due claim exactly once (#3000, spec #2998).
 *
 * processWaivers runs inside leagueWrite, which takes the League row FOR NO KEY
 * UPDATE as its first statement. Two runs on one League therefore queue on that
 * row, and the second run must find the first run's claims already settled. The
 * serial waiver test cannot show this; this one forces the overlap.
 *
 * The overlap is forced, not hoped for. A holder connection takes the League row
 * lock, both runs park on their first statement, and the test polls pg_stat_activity
 * until both are waiting on it before the holder commits. If the runs had executed
 * one after the other, nothing would be waiting and the poll would time out.
 *
 * Seed (FAAB league, teams T1 priority 1, T2 priority 2, T3 priority 3):
 *   player A: T1 bids 5, T2 bids 20      -> T2 wins on bid, T1 loses
 *   player U: T3 bids 2, no rival claim  -> T3 wins
 *
 * Gated like the other *.pg.test.js files: PG_TESTS=1 must be set and every
 * DATABASE_URL* variable must be ABSENT, so a stray local run can never touch the
 * shared production database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('waiver concurrency PG test (skipped: set PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('waiver concurrency PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  const pool = require('../modules/pool');
  const waiver = require('../services/waiver.service');
  // processWaivers refreshes roster availability through the Draft room
  // broadcast (#745), which throws when nothing is registered for the process.
  const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
  registerRecordingBroadcast();

  const userIds = [];
  const playerIds = [];
  let leagueId = null;
  const world = {};

  const one = async (text, params) => (await pool.query(text, params)).rows[0];
  const seedPlayer = async (name) => {
    const row = await one(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'RB', 'WCC') RETURNING "id"`,
      [name]
    );
    playerIds.push(row.id);
    return row.id;
  };
  const seedClaim = async ({ teamId, playerId, bid }) =>
    (await one(
      `INSERT INTO "waiver_claims" ("league_id", "team_id", "player_id", "bid", "claim_order")
       VALUES ($1, $2, $3, $4, 1) RETURNING "id"`,
      [leagueId, teamId, playerId, bid]
    )).id;

  // Backends waiting on the League row: processWaivers' first statement is the
  // League UPDATE, so counting only those cannot be satisfied by an unrelated wait.
  const blockedOnLeague = async () => (await pool.query(
    `SELECT COUNT(*)::int AS "n" FROM "pg_stat_activity"
     WHERE "datname" = current_database() AND "backend_type" = 'client backend'
       AND "wait_event_type" = 'Lock' AND "query" LIKE 'UPDATE "leagues"%'`
  )).rows[0].n;
  async function waitForBlockedOnLeague(n) {
    const deadline = Date.now() + 10000;
    let blocked = await blockedOnLeague();
    while (blocked < n && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      blocked = await blockedOnLeague();
    }
    return blocked;
  }

  test.before(async () => {
    for (const n of [1, 2, 3]) {
      const u = await one(
        `INSERT INTO "users" ("username", "email", "password")
         VALUES ($1, $2, 'x') RETURNING "id"`,
        [`wconc_pg_${n}`, `wconc-pg-${n}@example.invalid`]
      );
      userIds.push(u.id);
    }
    leagueId = (await one(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "current_season", "current_week",
                              "roster_limit", "ir_slots", "waiver_period_hours", "draft_status", "waiver_type")
       VALUES ('PG Waiver Concurrency', $1, 'wconc01', 2026, 1, 10, 0, 24, 'complete', 'faab') RETURNING "id"`,
      [userIds[0]]
    )).id;
    world.t1 = (await one(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "waiver_priority", "faab_remaining")
       VALUES ($1, $2, 'PG T1', 1, 100) RETURNING "id"`,
      [leagueId, userIds[0]]
    )).id;
    world.t2 = (await one(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "waiver_priority", "faab_remaining")
       VALUES ($1, $2, 'PG T2', 2, 100) RETURNING "id"`,
      [leagueId, userIds[1]]
    )).id;
    world.t3 = (await one(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "waiver_priority", "faab_remaining")
       VALUES ($1, $2, 'PG T3', 3, 100) RETURNING "id"`,
      [leagueId, userIds[2]]
    )).id;
    world.a = await seedPlayer('WCC Player A');
    world.u = await seedPlayer('WCC Uncontested U');

    world.claims = {
      t1a: await seedClaim({ teamId: world.t1, playerId: world.a, bid: 5 }),
      t2a: await seedClaim({ teamId: world.t2, playerId: world.a, bid: 20 }),
      t3u: await seedClaim({ teamId: world.t3, playerId: world.u, bid: 2 }),
    };
  });

  test.after(async () => {
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (playerIds.length) await pool.query('DELETE FROM "players" WHERE "id" = ANY($1)', [playerIds]);
    if (userIds.length) await pool.query('DELETE FROM "users" WHERE "id" = ANY($1)', [userIds]);
    await pool.end();
  });

  test('two overlapping processWaivers runs on one League settle every due claim exactly once', async () => {
    const { claims: c } = world;
    const holder = await pool.connect();
    let open = false;
    let settled = null;
    try {
      // The League row lock leagueWrite takes first. Both runs queue behind it.
      await holder.query('BEGIN');
      open = true;
      await holder.query(`SELECT "id" FROM "leagues" WHERE "id" = $1 FOR NO KEY UPDATE`, [leagueId]);
      const runs = Promise.allSettled([
        waiver.processWaivers({ leagueId }),
        waiver.processWaivers({ leagueId }),
      ]);
      try {
        const blocked = await waitForBlockedOnLeague(2);
        assert.ok(
          blocked >= 2,
          `expected both processWaivers calls waiting on the League row (UPDATE "leagues") before the lock is released; found ${blocked} such backend(s) in pg_stat_activity`
        );
      } finally {
        await holder.query('COMMIT');
        open = false;
        settled = await runs;
      }
    } finally {
      if (open) await holder.query('ROLLBACK');
      holder.release();
    }

    const rejected = settled
      .filter((r) => r.status === 'rejected')
      .map((r) => `${r.reason && r.reason.code ? r.reason.code : 'no code'}: ${r.reason && r.reason.message}`);
    assert.deepEqual(
      rejected,
      [],
      `neither processWaivers call may reject (40P01 deadlock, 40001 serialization failure); got: ${rejected.join(' | ')}`
    );

    // Across both returned manifests, each due claim appears exactly once.
    const returned = settled.flatMap((r) => r.value.results.map((x) => x.claimId)).sort((a, b) => a - b);
    assert.deepEqual(
      returned,
      Object.values(c).sort((a, b) => a - b),
      'the two runs together must return each due claim exactly once (manifest results, claim ids)'
    );

    const stored = new Map(
      (await pool.query(
        `SELECT "id", "status", "winning_team_id", "winning_bid" FROM "waiver_claims" WHERE "league_id" = $1`,
        [leagueId]
      )).rows.map((r) => [r.id, r])
    );
    const shape = (id) => {
      const r = stored.get(id);
      return { status: r.status, winner: r.winning_team_id, bid: r.winning_bid };
    };
    assert.deepEqual(shape(c.t2a), { status: 'won', winner: world.t2, bid: 20 },
      'waiver_claims: T2 bid 20 on A and must win it, once');
    assert.deepEqual(shape(c.t1a), { status: 'lost', winner: world.t2, bid: 20 },
      'waiver_claims: T1 bid 5 on A and must lose to T2, once');
    assert.deepEqual(shape(c.t3u), { status: 'won', winner: world.t3, bid: 2 },
      'waiver_claims: T3 uncontested on U must win, once');

    const rosterOf = async (playerId) => (await pool.query(
      `SELECT "team_id" FROM "team_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    )).rows.map((r) => r.team_id);
    assert.deepEqual(await rosterOf(world.a), [world.t2],
      'team_players: contested player A on exactly one roster, the highest bidder T2');
    assert.deepEqual(await rosterOf(world.u), [world.t3],
      'team_players: uncontested player U on exactly one roster, T3');

    const budgets = new Map((await pool.query(
      `SELECT "id", "faab_remaining" FROM "teams" WHERE "league_id" = $1`,
      [leagueId]
    )).rows.map((r) => [r.id, r.faab_remaining]));
    assert.equal(budgets.get(world.t2), 80, 'teams.faab_remaining: winner T2 pays bid 20 once (100 - 20)');
    assert.equal(budgets.get(world.t1), 100, 'teams.faab_remaining: loser T1 spends nothing (100)');
    assert.equal(budgets.get(world.t3), 98, 'teams.faab_remaining: winner T3 pays bid 2 once (100 - 2)');

    // One waiver row per won claim in the activity log; a double settle would add a second row per player.
    const waiverRows = (await pool.query(
      `SELECT "team_id", "detail"->>'playerId' AS "player_id" FROM "transactions"
       WHERE "league_id" = $1 AND "type" = 'waiver'`,
      [leagueId]
    )).rows.map((r) => `${r.team_id}:${r.player_id}`);
    assert.deepEqual(
      waiverRows.sort(),
      [`${world.t2}:${world.a}`, `${world.t3}:${world.u}`].sort(),
      'transactions: one waiver row per won claim (T2 on A, T3 on U), no second row for either'
    );
  });
}
