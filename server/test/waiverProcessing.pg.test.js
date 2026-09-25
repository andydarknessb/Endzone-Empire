/**
 * Disposable-Postgres proof of ADR 0048's global claim order (#1670).
 *
 * processWaivers walks every due claim in the league in one order: bid (FAAB),
 * Waiver priority, the team's Claim order, submission time. The fake-pool suites
 * only see the SQL text; this runs the real function once against real rows and
 * asserts on the stored claims, the team priorities and the returned manifest.
 *
 * Seed (FAAB league, teams T1 priority 1 and T2 priority 2):
 *   player A: T1 bids 5 (better priority), T2 bids 20      -> T2 wins on bid
 *   player B: T1 and T2 both bid 4                         -> T1 wins on priority
 *   players X, Y: T1 bids 3 on each, both dropping D       -> Claim order: X wins,
 *                                                             Y is invalid (sibling note)
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or WAIVER_PROCESSING_PG_TESTS=1) must be set and
 * every DATABASE_URL* variable must be ABSENT, so a stray local run can never
 * touch the shared production database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.WAIVER_PROCESSING_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('waiver processing PG tests (skipped: set PG_TESTS=1 or WAIVER_PROCESSING_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('waiver processing PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
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
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'RB', 'WPR') RETURNING "id"`,
      [name]
    );
    playerIds.push(row.id);
    return row.id;
  };
  const seedClaim = async ({ teamId, playerId, bid, order, dropPlayerId = null }) =>
    (await one(
      `INSERT INTO "waiver_claims" ("league_id", "team_id", "player_id", "drop_player_id", "bid", "claim_order")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING "id"`,
      [leagueId, teamId, playerId, dropPlayerId, bid, order]
    )).id;

  test.before(async () => {
    for (const n of [1, 2]) {
      const u = await one(
        `INSERT INTO "users" ("username", "email", "password")
         VALUES ($1, $2, 'x') RETURNING "id"`,
        [`wproc_pg_${n}`, `wproc-pg-${n}@example.invalid`]
      );
      userIds.push(u.id);
    }
    leagueId = (await one(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "current_season", "current_week",
                              "roster_limit", "ir_slots", "waiver_period_hours", "draft_status", "waiver_type")
       VALUES ('PG Waiver Processing', $1, 'wproc01', 2026, 1, 10, 0, 24, 'complete', 'faab') RETURNING "id"`,
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
    world.a = await seedPlayer('WPR Player A');
    world.b = await seedPlayer('WPR Player B');
    world.x = await seedPlayer('WPR Player X');
    world.y = await seedPlayer('WPR Player Y');
    world.d = await seedPlayer('WPR Dropped D');
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, world.t1, world.d]
    );

    world.claims = {
      t1a: await seedClaim({ teamId: world.t1, playerId: world.a, bid: 5, order: 1 }),
      t1b: await seedClaim({ teamId: world.t1, playerId: world.b, bid: 4, order: 2 }),
      t1x: await seedClaim({ teamId: world.t1, playerId: world.x, bid: 3, order: 3, dropPlayerId: world.d }),
      t1y: await seedClaim({ teamId: world.t1, playerId: world.y, bid: 3, order: 4, dropPlayerId: world.d }),
      t2a: await seedClaim({ teamId: world.t2, playerId: world.a, bid: 20, order: 1 }),
      t2b: await seedClaim({ teamId: world.t2, playerId: world.b, bid: 4, order: 2 }),
    };
  });

  test.after(async () => {
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (playerIds.length) await pool.query('DELETE FROM "players" WHERE "id" = ANY($1)', [playerIds]);
    if (userIds.length) await pool.query('DELETE FROM "users" WHERE "id" = ANY($1)', [userIds]);
    await pool.end();
  });

  test('one processing run resolves claims in bid, Waiver priority, Claim order (ADR 0048)', async () => {
    const { claims: c } = world;
    const manifest = await waiver.processWaivers({ leagueId });

    const stored = new Map(
      (await pool.query(
        `SELECT "id", "status", "note", "winning_team_id", "winning_bid" FROM "waiver_claims" WHERE "league_id" = $1`,
        [leagueId]
      )).rows.map((r) => [r.id, r])
    );
    const shape = (id) => {
      const r = stored.get(id);
      return { status: r.status, winner: r.winning_team_id, bid: r.winning_bid };
    };

    // Player A: the higher bid beats the better Waiver priority.
    assert.deepEqual(shape(c.t2a), { status: 'won', winner: world.t2, bid: 20 });
    assert.deepEqual(shape(c.t1a), { status: 'lost', winner: world.t2, bid: 20 });

    // Player B: equal bids, the better Waiver priority wins.
    assert.deepEqual(shape(c.t1b), { status: 'won', winner: world.t1, bid: 4 });
    assert.deepEqual(shape(c.t2b), { status: 'lost', winner: world.t1, bid: 4 });

    // Shared drop: the first in Claim order wins, the second is invalid and
    // names the first. An invalid claim lost to nobody.
    assert.deepEqual(shape(c.t1x), { status: 'won', winner: world.t1, bid: 3 });
    assert.deepEqual(shape(c.t1y), { status: 'invalid', winner: null, bid: null });
    assert.match(stored.get(c.t1y).note, /^your #3 claim already dropped WPR Dropped D$/);

    // The last winner (T1) is at the back of Waiver priority.
    const priorities = new Map(
      (await pool.query(`SELECT "id", "waiver_priority" FROM "teams" WHERE "league_id" = $1`, [leagueId]))
        .rows.map((r) => [r.id, r.waiver_priority])
    );
    assert.equal(priorities.get(world.t1), 2);
    assert.equal(priorities.get(world.t2), 1);

    // The returned manifest names every terminal outcome, lost included.
    const byClaim = new Map(manifest.results.map((r) => [r.claimId, r]));
    assert.equal(manifest.processed, 6);
    assert.equal(manifest.results.length, 6);
    assert.deepEqual(byClaim.get(c.t1a), { claimId: c.t1a, playerId: world.a, status: 'lost', teamId: world.t2 });
    assert.deepEqual(byClaim.get(c.t2b), { claimId: c.t2b, playerId: world.b, status: 'lost', teamId: world.t1 });
    assert.deepEqual(byClaim.get(c.t2a), { claimId: c.t2a, playerId: world.a, status: 'won', teamId: world.t2 });
    assert.equal(byClaim.get(c.t1y).status, 'invalid');
  });
}
