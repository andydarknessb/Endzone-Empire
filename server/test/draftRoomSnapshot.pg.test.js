/**
 * Disposable-Postgres test for the Draft room snapshot's autopick join (#949).
 *
 * The fast draftRoomSnapshot.test.js proves the SELECT PROJECTS `auto` (a matcher
 * fake can express "the query names AS \"auto\""). It cannot prove the one claim
 * that decides the join is correct: draft_activity is APPEND-ONLY and pick_number
 * is REUSED by an undo + re-pick, so joining draft_picks to draft_activity on
 * (league_id, pick_number, kind='pick') matches MORE THAN ONE row for a
 * re-picked slot and would DUPLICATE the pick in the snapshot - silently
 * lengthening the board. Only a real Postgres actually applies the LATERAL's
 * `ORDER BY feed_seq DESC LIMIT 1`, so this gets a real Postgres and proves, with
 * the COUNT as the assertion, that a slot with two pick-kind activity rows still
 * yields exactly one pick and reads the LATEST autopick fact.
 *
 * The scenario (the join trap the project-lead ruling named):
 *   - pick_number 1 was autopicked (activity row, is_autopick = true), then
 *     undone and re-picked manually (a SECOND pick-kind activity row for the same
 *     pick_number, is_autopick = false, at a higher feed_seq), plus a
 *     kind = 'correction' row for the same pick_number (a distinct kind that must
 *     be excluded). The CURRENT draft_picks row for pick_number 1 is the manual
 *     re-pick.
 *   - pick_number 2 is a KEEPER: pre-filled into draft_picks, never written to
 *     draft_activity, so it has no activity row and must COALESCE to auto = false.
 *
 * Expected: memberSnapshot returns exactly TWO picks (one per draft_picks row),
 * pick_number 1 appears ONCE with auto = false (latest feed_seq, correction
 * excluded), and the keeper reads auto = false.
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

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    return res.rows[0].id;
  }
  async function seedPlayer(name, position, nflTeam) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ($1, $2, $3) RETURNING "id"`,
      [name, position, nflTeam]
    );
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

    // CURRENT draft_picks: the manual re-pick of slot 1, and a keeper at slot 2.
    // draft_picks.team_id is NOT NULL; the reversed original pick's row is gone
    // (an undo hard-deletes it), so only the re-pick row exists for slot 1.
    await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "is_keeper")
       VALUES ($1, $2, $3, 1, false), ($1, $2, $4, 2, true)`,
      [leagueId, teamId, playerOne, playerKeeper]
    );

    const teamIdentity = { id: teamId, name: 'Team One' };
    const player = { id: playerOne, name: 'Star Runningback', position: 'RB', nfl_team: 'KC' };
    // 1) The ORIGINAL autopick at slot 1 (lower feed_seq). Append-only: it stays.
    await appendPickActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 1, auto: true, sourcePickId: null,
    });
    // 2) A commissioner CORRECTION for slot 1 (kind = 'correction'): must be
    //    excluded by the kind = 'pick' filter, never read as the slot's autopick.
    await appendCorrectionActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 1, reason: CORRECTION_REASON,
    });
    // 3) The MANUAL re-pick at slot 1 (highest feed_seq): the current pick, so its
    //    is_autopick = false is the fact the snapshot must read.
    await appendPickActivity(pool, {
      leagueId, team: teamIdentity, player, round: 1, pickNumber: 1, auto: false, sourcePickId: null,
    });
  });

  test.after(async () => {
    await pool.end();
    await knex.destroy();
  });

  test('a slot with two pick-kind activity rows yields exactly one pick, reading the latest autopick fact (#949)', async () => {
    const snapshot = await memberSnapshot(leagueId);

    // THE TRAP, as a count: pick_number 1 has TWO pick-kind activity rows, but the
    // LATERAL resolves to one, so the slot appears exactly ONCE - the board is not
    // silently lengthened.
    const slotOne = snapshot.picks.filter((p) => p.pick_number === 1);
    assert.equal(slotOne.length, 1, 'pick_number 1 must appear exactly once despite two pick-kind activity rows');

    // And it reads the LATEST by feed_seq: the manual re-pick (auto = false), not
    // the stale original autopick and not the excluded correction.
    assert.strictEqual(slotOne[0].auto, false);

    // The keeper has no draft_activity row at all, so its autopick fact COALESCEs
    // to false.
    const keeper = snapshot.picks.find((p) => p.pick_number === 2);
    assert.ok(keeper, 'the keeper pick is present');
    assert.strictEqual(keeper.auto, false);

    // One pick per CURRENT draft_picks row, no duplication from the append-only feed.
    assert.equal(snapshot.picks.length, 2);
  });

  test('an autopicked slot with no later re-pick reads auto = true (control)', async () => {
    // A second league where slot 1 was autopicked and left as-is: the LATERAL
    // reads that one true row. This is the control that proves the false above is
    // the join working, not the column being dark for everyone.
    const owner = await seedUser('draft_room_snapshot_pg_owner2');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      ['Draft Room Snapshot PG 2', owner, 'drsnap949b']
    );
    const otherLeague = league.rows[0].id;
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
    await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "is_keeper")
       VALUES ($1, $2, $3, 1, false)`,
      [otherLeague, otherTeamId, otherPlayer]
    );
    await appendPickActivity(pool, {
      leagueId: otherLeague,
      team: { id: otherTeamId, name: 'Team Two' },
      player: { id: otherPlayer, name: 'Auto Pickee', position: 'QB', nfl_team: 'BUF' },
      round: 1, pickNumber: 1, auto: true, sourcePickId: null,
    });

    const snapshot = await memberSnapshot(otherLeague);
    assert.equal(snapshot.picks.length, 1);
    assert.strictEqual(snapshot.picks[0].auto, true);
  });
}
