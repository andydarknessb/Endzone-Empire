/**
 * Disposable-Postgres test for the Draft room snapshot's autopick join (#949).
 *
 * The fast draftRoomSnapshot.test.js proves the SELECT PROJECTS `auto` (a matcher
 * fake can express "the query names AS \"auto\""). It cannot prove the claim that
 * decides the join is CORRECT: draft_activity is APPEND-ONLY and never deleted (a
 * reset and a rollover both wipe draft_picks and leave activity standing), and
 * pick_number is REUSED (a keeper pre-fill writes no activity row), so a
 * (league_id, pick_number) join makes a fresh keeper inherit a PRIOR draft's
 * autopick fact at the same slot (#949 review F1, a shipped bug). The join keys on
 * draft_activity.source_pick_id = draft_picks.id instead - identity, over a
 * never-reused serial. Only a real Postgres exercises that, so this gets a real
 * Postgres.
 *
 * The scenario:
 *   - Slot 1 was autopicked, then UNDONE and re-picked, plus a CORRECTION: three
 *     activity rows, only the re-pick's source_pick_id points at the current row.
 *     It must appear once and read the re-pick's is_autopick = false.
 *   - Slot 2 is a KEEPER, and a PRIOR draft's is_autopick = true row survives at
 *     pick_number 2 (source_pick_id pointing at the reset draft's deleted row).
 *     The keeper's fresh id is no activity row's source_pick_id, so it reads
 *     false. This is the F1 / F2 red-tell: it goes RED under a (league_id,
 *     pick_number) join.
 *
 * Expected: memberSnapshot returns exactly TWO picks (one per draft_picks row),
 * slot 1 appears ONCE with auto = false, and the keeper reads auto = false.
 *
 * Gated twice, exactly like draftActivity.pg.test.js: DRAFT_ROOM_SNAPSHOT_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must
 * be ABSENT, so a stray local run can never touch shared production. It self-skips
 * on a developer machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_ROOM_SNAPSHOT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft room snapshot PG tests (skipped: set PG_TESTS=1 or DRAFT_ROOM_SNAPSHOT_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft room snapshot PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // memberSnapshot reads through the module-level pool singleton; with DATABASE_URL*
  // absent it reads the standard PG* variables - the disposable database. The same
  // pool serves seeding and the append paths, so all contend on one real DB.
  const pool = require('../modules/pool');
  const { memberSnapshot } = require('../services/draftRoomSnapshot');
  const { appendPickActivity, appendCorrectionActivity } = require('../services/draftActivity');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });
  const CORRECTION_REASON = 'entered against the wrong team; correcting this before we resume play';
  let leagueId = null;
  let teamId = null;
  let playerOne = null;
  let playerKeeper = null;

  // Every row this file creates, tracked so test.after can DELETE all of it. A
  // *.pg.test.js runs SERIALLY against ONE shared migration-smoke database
  // (run-pg-tests.js), so a leaked draft_activity row is an AUTHORITATIVE live
  // event that makes a LATER file's rollback down() correctly refuse (ADR 0012) -
  // exactly what a leak here did to legacyFeedBackfill.pg.test.js. Leagues cascade
  // (draft_activity/picks/teams go with them via ON DELETE CASCADE on league_id),
  // but the global users and players rows carry no league_id, so the cascade
  // cannot reach them and they are deleted by id here (the #992 leak this week).
  const createdLeagues = [];
  const createdUsers = [];
  const createdPlayers = [];

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    createdUsers.push(res.rows[0].id);
    return res.rows[0].id;
  }
  async function seedPlayer(name, position, nflTeam) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ($1, $2, $3) RETURNING "id"`,
      [name, position, nflTeam]
    );
    createdPlayers.push(res.rows[0].id);
    return res.rows[0].id;
  }

  test.before(async () => {
    // Idempotent: in CI migration-smoke the schema is already at latest and this
    // runs nothing; a standalone local run against a fresh disposable DB brings it
    // up to date (and creates knex_migrations) first.
    await knex.migrate.latest();

    const owner = await seedUser('draft_room_snapshot_pg_owner');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      ['Draft Room Snapshot PG', owner, 'drsnap949a']
    );
    leagueId = league.rows[0].id;
    createdLeagues.push(leagueId);
    // Active and unpaused so onTheClock derives, and roster columns set so nothing
    // downstream trips on a null. current_pick is irrelevant to readPicks.
    await pool.query(
      `UPDATE "leagues"
       SET "draft_status" = 'active', "draft_paused" = false, "current_pick" = 2,
           "roster_limit" = 10, "ir_slots" = 0
       WHERE "id" = $1`,
      [leagueId]
    );
    const team = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, 1) RETURNING "id"`,
      [leagueId, owner, 'Team One']
    );
    teamId = team.rows[0].id;
    playerOne = await seedPlayer('Star Runningback', 'RB', 'KC');
    playerKeeper = await seedPlayer('Kept Receiver', 'WR', 'SF');

    const teamIdentity = { id: teamId, name: 'Team One' };
    const player = { id: playerOne, name: 'Star Runningback', position: 'RB', nfl_team: 'KC' };

    // A never-reused draft_picks id that no CURRENT row holds: insert a row and
    // delete it, exactly as a reset / undo / correction hard-deletes a Pick. Its
    // surviving activity row's source_pick_id then points at a row that is gone -
    // which is the whole reason the join keys on identity, not (league_id,
    // pick_number).
    async function deletedPickId(pickNumber) {
      const res = await pool.query(
        `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number")
         VALUES ($1, $2, $3, $4) RETURNING "id"`,
        [leagueId, teamId, playerOne, pickNumber]
      );
      const id = res.rows[0].id;
      await pool.query(`DELETE FROM "draft_picks" WHERE "id" = $1`, [id]);
      return id;
    }
    const reversedSlotOnePickId = await deletedPickId(101); // the undone original at slot 1
    const priorDraftKeeperSlotPickId = await deletedPickId(102); // a prior draft's Pick at slot 2

    // CURRENT draft_picks: the manual re-pick of slot 1, and a keeper at slot 2.
    // The reversed original pick's row is gone (hard-deleted above), so only the
    // re-pick row exists for slot 1; the keeper was pre-filled with NO activity row.
    const current = await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "is_keeper")
       VALUES ($1, $2, $3, 1, false), ($1, $2, $4, 2, true)
       RETURNING "id", "pick_number"`,
      [leagueId, teamId, playerOne, playerKeeper]
    );
    const slotOnePickId = current.rows.find((r) => r.pick_number === 1).id;

    // 1) The ORIGINAL autopick at slot 1, now REVERSED: its source_pick_id points
    //    at the deleted original row, so it must match NO current pick. Append-only,
    //    so it survives the undo (nothing in server/ deletes draft_activity).
    await appendPickActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 1, auto: true, sourcePickId: reversedSlotOnePickId,
    });
    // 2) A commissioner CORRECTION for slot 1 (kind = 'correction', source_pick_id
    //    null): excluded by the kind = 'pick' filter and matches nothing anyway.
    await appendCorrectionActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 1, reason: CORRECTION_REASON,
    });
    // 3) The MANUAL re-pick at slot 1: source_pick_id is the CURRENT row's id, so
    //    the join reads THIS entry's is_autopick = false for the slot.
    await appendPickActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 1, auto: false, sourcePickId: slotOnePickId,
    });
    // 4) THE F1 / F2 RED-TELL: a prior draft's AUTOPICK at slot 2 survives a reset
    //    (draft_picks wiped, draft_activity not), so a stale is_autopick = true row
    //    sits at pick_number 2 - the keeper's slot - with a source_pick_id pointing
    //    at the prior draft's deleted row. The keeper's fresh row was never that
    //    source_pick_id, so an identity join reads false; a (league_id, pick_number)
    //    join would read this stale true and render the keeper "AUTO".
    await appendPickActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 2, auto: true, sourcePickId: priorDraftKeeperSlotPickId,
    });
  });

  test.after(async () => {
    // Delete in dependency order: leagues first so their ON DELETE CASCADE takes
    // the draft_activity / picks / teams with them, then the now-unreferenced
    // global players and users. Leaving the DB exactly as this file found it is
    // what keeps the serial pg run's later files (legacyFeedBackfill) green.
    for (const id of createdLeagues) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [id]);
    for (const id of createdPlayers) await pool.query('DELETE FROM "players" WHERE "id" = $1', [id]);
    for (const id of createdUsers) await pool.query('DELETE FROM "users" WHERE "id" = $1', [id]);
    await knex.destroy();
    await pool.end();
  });

  test('the autopick join keys on identity: undo, correction and a reset-surviving keeper all read the right fact (#949)', async () => {
    const snapshot = await memberSnapshot(leagueId);

    // Slot 1 has THREE activity rows (reversed autopick, correction, re-pick) but
    // appears exactly ONCE - the identity join is 1:0..1, so the board is not
    // lengthened - and reads the CURRENT re-pick's is_autopick = false, not the
    // stale reversed autopick and not the excluded correction.
    const slotOne = snapshot.picks.filter((p) => p.pick_number === 1);
    assert.equal(slotOne.length, 1, 'pick_number 1 must appear exactly once');
    assert.strictEqual(slotOne[0].auto, false);

    // THE F1 / F2 RED-TELL. A stale is_autopick = true pick row sits at the
    // keeper's pick_number (a prior draft's autopick that survived a reset), but
    // the keeper's fresh draft_picks id is no activity row's source_pick_id, so it
    // reads false. This assertion goes RED under a (league_id, pick_number) join -
    // the keeper would inherit the prior draft's AUTO - which is the shipped bug
    // this ticket's first round missed.
    const keeper = snapshot.picks.find((p) => p.pick_number === 2);
    assert.ok(keeper, 'the keeper pick is present');
    assert.strictEqual(keeper.auto, false);

    // One pick per CURRENT draft_picks row, no duplication from the append-only feed.
    assert.equal(snapshot.picks.length, 2);
  });

  test('an autopicked slot whose activity row matches by identity reads auto = true (control)', async () => {
    // A second league where slot 1 was autopicked and left as-is: the activity
    // row's source_pick_id IS the current draft_picks id, so the join reads true.
    // This is the control that proves the false above is the join working, not the
    // column being dark for everyone.
    const owner = await seedUser('draft_room_snapshot_pg_owner2');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      ['Draft Room Snapshot PG 2', owner, 'drsnap949b']
    );
    const otherLeague = league.rows[0].id;
    createdLeagues.push(otherLeague);
    await pool.query(
      `UPDATE "leagues" SET "draft_status" = 'active', "roster_limit" = 10, "ir_slots" = 0 WHERE "id" = $1`,
      [otherLeague]
    );
    const team = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position") VALUES ($1, $2, $3, 1) RETURNING "id"`,
      [otherLeague, owner, 'Team Two']
    );
    const otherTeamId = team.rows[0].id;
    const otherPlayer = await seedPlayer('Auto Pickee', 'QB', 'BUF');
    const otherPick = await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "is_keeper")
       VALUES ($1, $2, $3, 1, false) RETURNING "id"`,
      [otherLeague, otherTeamId, otherPlayer]
    );
    await appendPickActivity(pool, {
      leagueId: otherLeague,
      team: { id: otherTeamId, name: 'Team Two' },
      player: { id: otherPlayer, name: 'Auto Pickee', position: 'QB', nfl_team: 'BUF' },
      round: 1, pickNumber: 1, auto: true, sourcePickId: otherPick.rows[0].id,
    });

    const snapshot = await memberSnapshot(otherLeague);
    assert.equal(snapshot.picks.length, 1);
    assert.strictEqual(snapshot.picks[0].auto, true);
  });
}
