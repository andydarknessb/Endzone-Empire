/**
 * Disposable-Postgres test for `placeOnWaivers`'s ON CONFLICT clause (#1375,
 * ADR 0043, review f1): the greater-of clear time and the never-touched
 * dropping-team/interrupted-stash columns are both encoded in the SQL text
 * itself (`waiver.service.js`), not in application logic, so a mocked unit
 * test can only prove that some function it trusts to implement the rule
 * behaves as expected - the fake pool's own handler re-implements the rule
 * in JS and is blind to the real SET clause. Only a real conflict on a real
 * Postgres row proves the SQL does what the docblock says.
 *
 * What it proves, in order:
 *   1. Two writes to the SAME (league, player) row, in EITHER order, leave
 *      `available_at` at the LATER of the two instants - never the more
 *      recent WRITE, the greater VALUE.
 *   2. A second write with no dropping team, conflicting with a row a first
 *      write already gave a dropping team and an interrupted stash, leaves
 *      those three columns exactly as the first write set them - the second
 *      caller's null/default values are never applied on conflict.
 *
 * Red-tell (verified by hand while writing this file, not automated here):
 * reverting placeOnWaivers' ON CONFLICT clause to
 *   DO UPDATE SET "available_at" = EXCLUDED."available_at", "updated_at" = now(),
 *                 "dropped_by_team_id" = EXCLUDED."dropped_by_team_id",
 *                 "interrupted_slot" = EXCLUDED."interrupted_slot",
 *                 "interrupted_ir_attested" = EXCLUDED."interrupted_ir_attested"
 * (the pre-#1375 base) turns both tests below red: test 1's "later write
 * moves it backward" case fails because the base clause always takes
 * EXCLUDED, and test 2 fails because the second write's null dropping team
 * blanks the first write's real one.
 *
 * Runs ONLY where a disposable Postgres is available, gated twice: PG_TESTS=1
 * (or its own PLACE_ON_WAIVERS_PG_TESTS=1) must be set to exactly '1', and
 * every DATABASE_URL* variable must be ABSENT - this file's own pool and the
 * service pool (server/modules/pool) both build their connection from PG*
 * variables only when no DATABASE_URL is present, so a stray local run can
 * never touch the shared production database. Mirrors
 * rosterDropLockOrder.pg.test.js's gating exactly.
 *
 * Discovery is by glob: scripts/run-pg-tests.js runs every
 * server/test/*.pg.test.js, so naming this file *.pg.test.js is the whole of
 * the wiring. It seeds and deletes its own league (a CASCADE removes its
 * teams and waiver_players rows) and its own players, since the players
 * table is global and the league CASCADE does not reach it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.PLACE_ON_WAIVERS_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('placeOnWaivers ON CONFLICT PG tests (skipped: set PG_TESTS=1 or PLACE_ON_WAIVERS_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('placeOnWaivers ON CONFLICT PG tests refuse to run with DATABASE_URL* set', () => {
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
  // The real code under test, connecting through server/modules/pool, which
  // reads the same PG* variables when no DATABASE_URL is present.
  const { placeOnWaivers } = require('../services/waiver.service');
  const modulePool = require('../modules/pool');

  // A season of its own; nothing here reads or writes nfl_games or any other
  // season-keyed table, so collision with another suite's seed data is not a
  // concern, but a distinct value keeps a human scanning `leagues` honest.
  const SEASON = 2096;
  const CURRENT_WEEK = 2;

  let ownerId = null;
  let leagueId = null;
  let teamId = null;
  let playerId = null;

  async function currentRow() {
    const result = await pool.query(
      `SELECT "available_at", "dropped_by_team_id", "interrupted_slot", "interrupted_ir_attested"
       FROM "waiver_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    );
    return result.rows[0] || null;
  }

  async function clearHold() {
    await pool.query(`DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "player_id" = $2`, [leagueId, playerId]);
  }

  test.before(async () => {
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('pow_owner', 'pow-owner@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = users.rows[0].id;

    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG Place On Waivers', $1, 'pow001', $2, $3, 10, 0, 24, 'complete')
       RETURNING "id"`,
      [ownerId, SEASON, CURRENT_WEEK]
    );
    leagueId = league.rows[0].id;

    const team = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Dropper') RETURNING "id"`,
      [leagueId, ownerId]
    );
    teamId = team.rows[0].id;

    const player = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Waiver Player', 'RB', 'POW') RETURNING "id"`
    );
    playerId = player.rows[0].id;
  });

  test.afterEach(clearHold);

  test.after(async () => {
    await clearHold();
    if (leagueId != null) await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    if (playerId != null) await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
    if (ownerId != null) await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [ownerId]);
    await pool.end();
    await modulePool.end();
  });

  test('ON CONFLICT keeps the greater of two clears, whichever order they are written in', async () => {
    const earlier = new Date('2026-09-14T18:00:00Z');
    const later = new Date('2026-09-16T23:15:00Z');

    // Later write first, then an earlier one: the earlier write must not
    // move the clear backward.
    await placeOnWaivers(pool, { leagueId, playerId, waiverPeriodHours: 24, availableAt: later });
    await placeOnWaivers(pool, { leagueId, playerId, waiverPeriodHours: 24, availableAt: earlier });
    let row = await currentRow();
    assert.equal(row.available_at.toISOString(), later.toISOString(), 'an earlier write never moves the clear backward');

    await clearHold();

    // Earlier write first, then a later one: the later write must move the
    // clear forward.
    await placeOnWaivers(pool, { leagueId, playerId, waiverPeriodHours: 24, availableAt: earlier });
    await placeOnWaivers(pool, { leagueId, playerId, waiverPeriodHours: 24, availableAt: later });
    row = await currentRow();
    assert.equal(row.available_at.toISOString(), later.toISOString(), 'a later write moves the clear forward');
  });

  test('ON CONFLICT never applies a second write\'s dropping team or interrupted-stash columns', async () => {
    const dropClear = new Date('2026-09-14T18:00:00Z');
    const weekClear = new Date('2026-09-16T23:15:00Z');

    // A drop writes first: names the dropping team, records the interrupted
    // stash.
    await placeOnWaivers(pool, {
      leagueId, playerId, waiverPeriodHours: 24, availableAt: dropClear,
      droppedByTeamId: teamId, interruptedSlot: 'IR', interruptedIrAttested: true,
    });
    // The kickoff hold job's own call conflicts: no dropping team, a later
    // clear.
    await placeOnWaivers(pool, { leagueId, playerId, waiverPeriodHours: 24, availableAt: weekClear });

    const row = await currentRow();
    assert.equal(row.available_at.toISOString(), weekClear.toISOString(), 'the clear time moved to the later write');
    assert.equal(row.dropped_by_team_id, teamId, 'the dropping team survives a conflicting write that named none');
    assert.equal(row.interrupted_slot, 'IR', 'the interrupted slot survives a conflicting write that named none');
    assert.equal(row.interrupted_ir_attested, true, 'the IR attestation survives a conflicting write that named none');
  });
}
