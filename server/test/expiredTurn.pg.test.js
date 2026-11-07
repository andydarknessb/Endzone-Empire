/**
 * Disposable-Postgres proof for the expired turn (#2694, spec #2681).
 *
 * An Autopick names the turn its firing saw expire: { pickNumber, deadline }. The
 * commit fences that turn under the League lock, so a second firing, or a Pick that
 * landed first, refuses CLOCK_MOVED with no Pick inserted and no timeout counted. A
 * genuine timeout's consequences (the streak, the move into Autodraft, the re-arm at
 * a snake turnaround) commit with the Pick, so a failure after the Pick's insert
 * rolls all of it back together. The fast suites cannot show the stored state or the
 * lock order, so this gets a real Postgres.
 *
 * Gated like pickClockTurnaround.pg.test.js: PG_TESTS=1 (or EXPIRED_TURN_PG_TESTS=1)
 * must be set, and every DATABASE_URL* variable must be ABSENT, so a stray local run
 * can never touch shared production. It self-skips on a developer machine and
 * EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.EXPIRED_TURN_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('expired turn PG tests (skipped: set PG_TESTS=1 or EXPIRED_TURN_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('expired turn PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // landPick and autoPick use the module-level pool singleton; with DATABASE_URL*
  // absent they read the standard PG* variables - the disposable database. CI
  // migrates before test:pg, so this file does not migrate.
  const pool = require('../modules/pool');
  const { landPick } = require('../services/pick.service');
  const { autoPick } = require('../services/pickClock.service');
  const { teamForPick } = require('../services/draftOrder.service');
  const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
  registerRecordingBroadcast();

  let ownerA = null;
  let ownerB = null;
  const playerIds = [];
  const leagueIds = [];
  let leagueSeq = 0;

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    return res.rows[0].id;
  }

  // Two Teams, Alpha at draft position 1 and Bravo at position 2, a snake draft with
  // a 90s pick clock and a 5s Autodraft delay. The Team on the clock at `currentPick`
  // (0-based) starts with `onClockTimeouts` consecutive timeouts, Autodraft off, and
  // an elapsed deadline: the state the expiring firing sees.
  async function seedLeague({ currentPick, onClockPosition, onClockTimeouts }) {
    leagueSeq += 1;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      [`Expired Turn ${leagueSeq}`, ownerA, `expturn${leagueSeq}`]
    );
    const leagueId = league.rows[0].id;
    leagueIds.push(leagueId);
    await pool.query(
      `UPDATE "leagues"
       SET "draft_status" = 'active', "draft_paused" = false, "draft_type" = 'snake',
           "draft_rotation" = 'snake', "current_pick" = $2, "pick_time_seconds" = 90,
           "autodraft_delay_seconds" = 5, "roster_limit" = 10, "ir_slots" = 0,
           "current_season" = 2026, "current_week" = 1,
           "pick_deadline_at" = now() - make_interval(secs => 1)
       WHERE "id" = $1`,
      [leagueId, currentPick]
    );
    const teamIds = {};
    for (const [name, owner, position] of [['Alpha', ownerA, 1], ['Bravo', ownerB, 2]]) {
      const onClock = position === onClockPosition;
      const res = await pool.query(
        `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position", "consecutive_timeouts", "autodraft")
         VALUES ($1, $2, $3, $4, $5, false) RETURNING "id"`,
        [leagueId, owner, name, position, onClock ? onClockTimeouts : 0]
      );
      teamIds[name] = res.rows[0].id;
    }
    return { leagueId, teamIds };
  }

  async function readLeague(leagueId) {
    const res = await pool.query('SELECT * FROM "leagues" WHERE "id" = $1', [leagueId]);
    return res.rows[0];
  }

  async function readTeams(leagueId) {
    const res = await pool.query(
      `SELECT "id", "owner_id", "autodraft", "draft_position", "consecutive_timeouts" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    return res.rows;
  }

  async function countPicks(leagueId) {
    const res = await pool.query('SELECT COUNT(*)::int AS n FROM "draft_picks" WHERE "league_id" = $1', [leagueId]);
    return res.rows[0].n;
  }

  // The turn a firing reads off the locked row: the Pick it would insert, and the deadline it saw.
  function expiredTurnOf(league) {
    return { pickNumber: league.current_pick + 1, deadline: league.pick_deadline_at };
  }

  async function teamById(leagueId, teamId) {
    return (await readTeams(leagueId)).find((row) => row.id === teamId);
  }

  test.before(async () => {
    ownerA = await seedUser('expired_turn_a');
    ownerB = await seedUser('expired_turn_b');
    for (let i = 0; i < 6; i += 1) {
      const res = await pool.query(
        `INSERT INTO "players" ("name", "position", "nfl_team", "adp")
         VALUES ($1, 'RB', 'KC', $2) RETURNING "id"`,
        [`Expired Turn Player ${i}`, 10 + i]
      );
      playerIds.push(res.rows[0].id);
    }
  });

  test.after(async () => {
    // CASCADE from leagues removes teams, picks and rosters before the players go.
    for (const leagueId of leagueIds) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    for (const playerId of playerIds) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerId]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    if (ownerB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB]);
    await pool.end();
  });

  test('two firings for one expired turn land one Autopick and count one timeout', async () => {
    const { leagueId, teamIds } = await seedLeague({ currentPick: 0, onClockPosition: 1, onClockTimeouts: 0 });
    const expired = expiredTurnOf(await readLeague(leagueId));

    const results = await Promise.allSettled([
      landPick({ leagueId, by: { kind: 'autopick' }, playerId: playerIds[0], expiredTurn: expired }),
      landPick({ leagueId, by: { kind: 'autopick' }, playerId: playerIds[1], expiredTurn: expired }),
    ]);

    const landed = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');
    assert.equal(landed.length, 1, 'exactly one firing lands the Autopick');
    assert.equal(refused.length, 1, 'the other firing is refused');
    assert.equal(refused[0].reason.code, 'CLOCK_MOVED', 'the refused firing is the stale one');
    assert.equal(await countPicks(leagueId), 1, 'one Pick is in the draft');
    assert.equal((await teamById(leagueId, teamIds.Alpha)).consecutive_timeouts, 1, 'one timeout is counted');

    // A later sweep of the same league finds the next turn's clock armed, so it autopicks nothing.
    assert.equal(await autoPick({ leagueId }), null, 'the next turn is not expired');
    assert.equal(await countPicks(leagueId), 1, 'the sweep adds no Pick');
  });

  test('a manual Pick that commits before the firing refuses the Autopick CLOCK_MOVED, with no Pick and no timeout', async () => {
    const { leagueId, teamIds } = await seedLeague({ currentPick: 0, onClockPosition: 1, onClockTimeouts: 1 });
    const expired = expiredTurnOf(await readLeague(leagueId));

    // Alpha's owner picks first: the manual Pick lands and clears Alpha's streak.
    await landPick({ leagueId, by: { kind: 'manager', userId: ownerA }, playerId: playerIds[2] });

    await assert.rejects(
      landPick({ leagueId, by: { kind: 'autopick' }, playerId: playerIds[3], expiredTurn: expired }),
      (err) => err.statusCode === 409 && err.code === 'CLOCK_MOVED'
    );
    assert.equal(await countPicks(leagueId), 1, 'only the manual Pick is in the draft');
    const teams = await readTeams(leagueId);
    assert.equal(teams.find((row) => row.id === teamIds.Alpha).consecutive_timeouts, 0, 'Alpha counts no timeout');
    assert.equal(teams.find((row) => row.id === teamIds.Bravo).consecutive_timeouts, 0, 'Bravo is not charged a timeout');
  });

  test('a second consecutive timeout moves the Team into Autodraft inside the Autopick, so a failure after the Pick insert leaves neither the Pick nor the streak', async () => {
    const { leagueId, teamIds } = await seedLeague({ currentPick: 0, onClockPosition: 1, onClockTimeouts: 1 });
    const expired = expiredTurnOf(await readLeague(leagueId));

    // Force the Autodraft flag write to fail, after the Pick's insert and before COMMIT.
    await pool.query(
      `CREATE OR REPLACE FUNCTION expired_turn_flip_fails() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'forced after the Pick insert'; END $$`
    );
    await pool.query(
      `CREATE TRIGGER expired_turn_flip_fails BEFORE UPDATE OF "autodraft" ON "teams"
       FOR EACH ROW WHEN (NEW."autodraft" AND NOT OLD."autodraft")
       EXECUTE FUNCTION expired_turn_flip_fails()`
    );
    try {
      await assert.rejects(
        landPick({ leagueId, by: { kind: 'autopick' }, playerId: playerIds[4], expiredTurn: expired }),
        /forced after the Pick insert/
      );
      assert.equal(await countPicks(leagueId), 0, 'the Pick rolled back with the failed flip');
      const alpha = await teamById(leagueId, teamIds.Alpha);
      assert.equal(alpha.consecutive_timeouts, 1, 'the streak rolled back with the flip');
      assert.equal(alpha.autodraft, false, 'Alpha is not in Autodraft');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS expired_turn_flip_fails ON "teams"');
      await pool.query('DROP FUNCTION IF EXISTS expired_turn_flip_fails()');
    }

    // With the failure gone, the same expired turn still lands, and the move commits with the Pick.
    await landPick({ leagueId, by: { kind: 'autopick' }, playerId: playerIds[4], expiredTurn: expired });
    assert.equal(await countPicks(leagueId), 1, 'the Autopick lands once the failure is gone');
    const alpha = await teamById(leagueId, teamIds.Alpha);
    assert.equal(alpha.consecutive_timeouts, 2, 'the second consecutive timeout is counted');
    assert.equal(alpha.autodraft, true, 'Alpha is moved into Autodraft with its Pick');
  });

  test('at a snake turnaround, the turn after the move is armed with the Autodraft delay', async () => {
    // Round 1, pick index 1: Bravo picks last in the round and times out a second time.
    // Round 2 (index 2) is Bravo's turn again under the snake, so it is armed on the short delay.
    const { leagueId, teamIds } = await seedLeague({ currentPick: 1, onClockPosition: 2, onClockTimeouts: 1 });
    const expired = expiredTurnOf(await readLeague(leagueId));

    const outcome = await landPick({ leagueId, by: { kind: 'autopick' }, playerId: playerIds[5], expiredTurn: expired });

    const league = await readLeague(leagueId);
    const onClock = teamForPick(league.current_pick, await readTeams(leagueId), {
      rotation: league.draft_rotation,
      overrides: league.draft_order_overrides,
    });
    assert.equal(onClock.id, teamIds.Bravo, 'the same Team holds the next turn');
    assert.equal(onClock.autodraft, true, 'the Team on the clock was moved into Autodraft');
    const secondsToDeadline = (new Date(league.pick_deadline_at).getTime() - Date.now()) / 1000;
    assert.ok(secondsToDeadline <= 7, `the turn is armed on the Autodraft delay (5s), not 90s; ${secondsToDeadline.toFixed(1)}s`);
    assert.equal(
      new Date(outcome.pickDeadlineAt).getTime(),
      new Date(league.pick_deadline_at).getTime(),
      'the returned deadline is the one the turn is armed with'
    );
  });
}
