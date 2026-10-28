/**
 * Disposable-Postgres test for the kickoff tick's array write (#2602, spec
 * #2602 item 4/6): `holdKickedOffPlayersForLeague` now hands the whole
 * league's kicked-off pool to `placeOnWaiversForPlayers`, one INSERT ...
 * SELECT ... unnest, instead of calling `placeOnWaivers` once per player.
 *
 * What the unnest form could get wrong, and what this proves on real
 * Postgres rather than a fake that re-implements the rule in JS:
 *   1. A player a drop already holds with a clear LATER than the week clear
 *      keeps that clear, and keeps the dropping team and interrupted stash,
 *      when the tick's single statement also names him. (The candidate
 *      filter normally excludes him before the write; a drop landing between
 *      the candidate SELECT and that statement is the race the conflict rule
 *      is for, #1375 review f3.)
 *   2. A player with no row gets the week's clear time - one statement, and
 *      both players' rows come out of it.
 *
 * Runs ONLY where a disposable Postgres is available, gated twice: PG_TESTS=1
 * (or its own KICKOFF_WAIVER_HOLD_PG_TESTS=1) must be set to exactly '1', and
 * every DATABASE_URL* variable must be ABSENT - this file's own pool and the
 * service pool (server/modules/pool) both build their connection from PG*
 * variables only when no DATABASE_URL is present, so a stray local run can
 * never touch the shared production database. Mirrors
 * placeOnWaivers.pg.test.js's gating exactly.
 *
 * Discovery is by glob: scripts/run-pg-tests.js runs every
 * server/test/*.pg.test.js, so naming this file *.pg.test.js is the whole of
 * the wiring. It seeds and deletes its own league (a CASCADE removes its
 * teams and waiver_players rows) and its own players, since the players
 * table is global and the league CASCADE does not reach it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.KICKOFF_WAIVER_HOLD_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('kickoff waiver hold PG tests (skipped: set PG_TESTS=1 or KICKOFF_WAIVER_HOLD_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('kickoff waiver hold PG tests refuse to run with DATABASE_URL* set', () => {
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
  const { placeOnWaivers, placeOnWaiversForPlayers } = require('../services/waiver.service');
  const modulePool = require('../modules/pool');

  // Its own season, so a human scanning `leagues` can tell whose seed this is;
  // nothing here reads or writes any season-keyed table.
  const SEASON = 2095;
  const CURRENT_WEEK = 3;
  const WEEK_CLEAR = new Date('2026-09-17T23:15:00Z');
  const DROP_CLEAR = new Date('2026-09-19T18:00:00Z'); // later than the week clear

  let ownerId = null;
  let leagueId = null;
  let teamId = null;
  let heldPlayerId = null; // a drop already holds him, with the later clear
  let newPlayerId = null; // nobody holds him yet

  async function rowFor(playerId) {
    const result = await pool.query(
      `SELECT "available_at", "dropped_by_team_id", "interrupted_slot", "interrupted_ir_attested"
       FROM "waiver_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    );
    return result.rows[0] || null;
  }

  async function clearHolds() {
    await pool.query(`DELETE FROM "waiver_players" WHERE "league_id" = $1`, [leagueId]);
  }

  test.before(async () => {
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('kwh_owner', 'kwh-owner@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = users.rows[0].id;

    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG Kickoff Waiver Hold', $1, 'kwh001', $2, $3, 10, 0, 24, 'complete')
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

    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('KWH Held Player', 'RB', 'KWH'), ('KWH New Player', 'WR', 'KWH')
       RETURNING "id"`
    );
    heldPlayerId = players.rows[0].id;
    newPlayerId = players.rows[1].id;
  });

  test.after(async () => {
    await clearHolds();
    if (leagueId != null) await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    if (heldPlayerId != null || newPlayerId != null) {
      await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [[heldPlayerId, newPlayerId]]);
    }
    if (ownerId != null) await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [ownerId]);
    await pool.end();
    await modulePool.end();
  });

  test("one array write keeps a drop's later clear and gives a new player the week clear", async () => {
    // The drop, written the way every drop path writes it: names the team and
    // records the interrupted stash, with its own later clear.
    await placeOnWaivers(pool, {
      leagueId, playerId: heldPlayerId, waiverPeriodHours: 24, availableAt: DROP_CLEAR,
      droppedByTeamId: teamId, interruptedSlot: 'IR', interruptedIrAttested: true,
    });

    // The tick's statement, for the whole league at once.
    const written = await placeOnWaiversForPlayers(pool, {
      leagueId, playerIds: [heldPlayerId, newPlayerId], waiverPeriodHours: 24, availableAt: WEEK_CLEAR,
    });
    assert.equal(written, 2);

    const held = await rowFor(heldPlayerId);
    assert.equal(held.available_at.toISOString(), DROP_CLEAR.toISOString(), "the drop's later clear survives");
    assert.equal(held.dropped_by_team_id, teamId, 'the dropping team survives');
    assert.equal(held.interrupted_slot, 'IR', 'the interrupted slot survives');

    const inserted = await rowFor(newPlayerId);
    assert.equal(inserted.available_at.toISOString(), WEEK_CLEAR.toISOString(), "a new hold gets the week's clear");
    assert.equal(inserted.dropped_by_team_id, null, 'a tick hold names no dropping team');
  });
}
