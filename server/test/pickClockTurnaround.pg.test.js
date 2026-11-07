/**
 * Disposable-Postgres proof for the Autopick at a snake turnaround (#2684, spec #2681).
 *
 * A timed snake draft: the Team picking last in round 1 times out a second time,
 * so autoPick lands its Autopick and places it in Autodraft (AUTO_ENABLE_TIMEOUTS).
 * Its round-2 turn is the SAME Team's turn, so that turn must be armed on the
 * short Autodraft delay (5s here), not the full pick clock (90s here). The fast
 * suites cannot show the deadline the database actually stores, nor that the move
 * into Autodraft and the re-arm land in one committed transaction, so this gets a
 * real Postgres.
 *
 * Gated twice, exactly like draftAct.pg.test.js: PG_TESTS=1 (or the per-file
 * PICK_CLOCK_TURNAROUND_PG_TESTS=1) must be set, and every DATABASE_URL* variable
 * must be ABSENT, so a stray local run can never touch shared production. It
 * self-skips on a developer machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.PICK_CLOCK_TURNAROUND_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('pick clock turnaround PG tests (skipped: set PG_TESTS=1 or PICK_CLOCK_TURNAROUND_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('pick clock turnaround PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // autoPick uses the module-level pool singleton; with DATABASE_URL* absent it
  // reads the standard PG* variables - the disposable database. CI migrates before
  // test:pg, so this file does not migrate.
  const pool = require('../modules/pool');
  const { autoPick } = require('../services/pickClock.service');
  const { teamForPick } = require('../services/draftOrder.service');
  const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
  // Each test reads the room fan-out in order, so it can check what a real Draft
  // room heard after the Autopick's pickLanded.
  const room = registerRecordingBroadcast();

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

  // Two Teams, Alpha at draft position 1 and Bravo at position 2, a snake draft
  // with a 90s pick clock and a 5s Autodraft delay. The Team on the clock at
  // `currentPick` (0-based) has one timeout already, Autodraft off, and an
  // elapsed deadline: the state the expiring firing sees.
  async function seedLeague({ currentPick, onClockPosition }) {
    leagueSeq += 1;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      [`Pick Clock Turnaround ${leagueSeq}`, ownerA, `pcturn${leagueSeq}`]
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
        [leagueId, owner, name, position, onClock ? 1 : 0]
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
      `SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    return res.rows;
  }

  // The Draft room hears exactly one stateChanged after the Autopick's pickLanded.
  function assertOneStateChangedAfterPickLanded() {
    const heard = room().calls.map((call) => call.method);
    const landed = heard.indexOf('pickLanded');
    assert.ok(landed >= 0, `the Autopick fanned out pickLanded, heard: ${heard.join(', ')}`);
    const after = heard.slice(landed + 1).filter((method) => method === 'stateChanged').length;
    assert.equal(after, 1, `exactly one stateChanged after pickLanded, heard: ${heard.join(', ')}`);
  }

  test.before(async () => {
    ownerA = await seedUser('pick_clock_turn_a');
    ownerB = await seedUser('pick_clock_turn_b');
    // One unrostered player serves each League's single Autopick.
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team", "adp") VALUES ('Turnaround Player', 'RB', 'KC', 10) RETURNING "id"`
    );
    playerIds.push(res.rows[0].id);
  });

  test.after(async () => {
    // CASCADE from leagues removes teams, picks and rosters before the players go.
    for (const leagueId of leagueIds) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    for (const playerId of playerIds) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerId]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    if (ownerB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB]);
    await pool.end();
  });

  test('an Autopick at a snake turnaround arms the same Team on the Autodraft delay, not the full pick clock', async () => {
    // Round 1, pick index 1: Bravo picks last in the round and times out. Round 2
    // (index 2) is Bravo's turn again under the snake.
    const { leagueId, teamIds } = await seedLeague({ currentPick: 1, onClockPosition: 2 });

    const outcome = await autoPick({ leagueId });
    const returnedAt = Date.now();

    assert.ok(outcome, 'the Autopick landed');
    const league = await readLeague(leagueId);
    const teams = await readTeams(leagueId);
    const onClock = teamForPick(league.current_pick, teams, {
      rotation: league.draft_rotation,
      overrides: league.draft_order_overrides,
    });
    assert.equal(onClock.id, teamIds.Bravo, 'the same Team holds the next turn at the snake turnaround');
    assert.equal(onClock.autodraft, true, 'the Team on the clock was placed in Autodraft');
    const secondsToDeadline = (new Date(league.pick_deadline_at).getTime() - returnedAt) / 1000;
    assert.ok(
      secondsToDeadline <= 7,
      `the next turn is armed on the Autodraft delay (5s), not the 90s pick clock; deadline was ${secondsToDeadline.toFixed(1)}s after the call returned`
    );
    // The expiry timer is armed from this return, so it must agree with the stored
    // deadline, or the turn fires on the 90s value rather than the 5s delay.
    assert.equal(
      new Date(outcome.pickDeadlineAt).getTime(),
      new Date(league.pick_deadline_at).getTime(),
      'the returned deadline is the one the turn is armed with'
    );
    assertOneStateChangedAfterPickLanded();
  });

  test('moving a Team into Autodraft off the turn leaves the next Team clock as landPick armed it', async () => {
    // Round 1, pick index 0: Alpha picks first and times out. The next turn (index 1)
    // belongs to Bravo, who is not in Autodraft, so the move must not re-arm it.
    const { leagueId, teamIds } = await seedLeague({ currentPick: 0, onClockPosition: 1 });

    const outcome = await autoPick({ leagueId });

    assert.ok(outcome, 'the Autopick landed');
    const league = await readLeague(leagueId);
    const teams = await readTeams(leagueId);
    const onClock = teamForPick(league.current_pick, teams, {
      rotation: league.draft_rotation,
      overrides: league.draft_order_overrides,
    });
    assert.equal(onClock.id, teamIds.Bravo, 'Bravo holds the next turn');
    assert.equal(onClock.autodraft, false, 'Bravo is not in Autodraft');
    assert.equal(
      new Date(league.pick_deadline_at).getTime(),
      new Date(outcome.pickDeadlineAt).getTime(),
      'the next Team clock is the one landPick armed, unchanged by the move into Autodraft'
    );
    const movedTeam = teams.find((row) => row.id === teamIds.Alpha);
    assert.equal(movedTeam.autodraft, true, 'Alpha was placed in Autodraft after its second timeout');
    assertOneStateChangedAfterPickLanded();
  });
}
