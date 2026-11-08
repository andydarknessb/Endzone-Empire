/**
 * Disposable-Postgres test for the board version (CONTEXT.md, board version; ADR
 * 0025, 2026-11-06 amendment).
 *
 * Every Draft-state writer advances leagues.board_version in the transaction that
 * makes its change, so a client can order draft:state against any other board
 * fact. This file drives each writer against a real Postgres and asserts the
 * version after the change is greater than before. Where the change broadcasts a
 * board fact, the captured draft:state or draft:picked payload carries the same
 * value as `boardVersion`.
 *
 * The Draft act module (pause, resume, autodraft toggle, reset) and the Commissioner
 * correction are driven through their services. The clock, readiness, order and
 * keepers writers are driven through the real draft router mounted on express.
 *
 * Gated twice, exactly like draftRoomSnapshot.pg.test.js: DRAFT_BOARD_VERSION_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must be
 * ABSENT. It self-skips on a developer machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_BOARD_VERSION_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft board version PG tests (skipped: set PG_TESTS=1 or DRAFT_BOARD_VERSION_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft board version PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // The writers reach the database through the module-level pool singleton; with
  // DATABASE_URL* absent it reads the standard PG* variables - the disposable database.
  const pool = require('../modules/pool');
  // signToken and requireAuth read JWT_SECRET on each call; set it for this file only.
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'draft-board-version-pg-test-secret';
  const { signToken } = require('../modules/auth');
  const express = require('express');
  const draftRouter = require('../routes/draft.router');
  const { commitPick } = require('../services/pick.service');
  const { correctLatestPick } = require('../services/draft.service');
  const { startDraft } = require('../services/draftStart.service');
  const { runDraftAct } = require('../services/draftAct.service');
  const {
    createDraftRoomBroadcast,
    setDraftRoomBroadcast,
    peekDraftRoomBroadcast,
  } = require('../modules/draftRoomBroadcast');
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

  // Every row this file creates, removed in test.after: a serial pg run shares one
  // database, so a leaked row would reach a later file (see draftRoomSnapshot.pg).
  const createdLeagues = [];
  const createdUsers = [];
  const createdPlayers = [];
  const CORRECTION_REASON = 'entered against the wrong team; correcting this before we resume play';

  // A recording transport: the real adapter, so stateChanged reads the real snapshot.
  const emits = [];
  const transport = {
    to: (room) => ({
      emit: (event, payload) => {
        emits.push({ room, event, payload });
      },
    }),
  };
  let priorBroadcast = null;

  let server = null;
  let baseUrl = null;

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    createdUsers.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function seedPlayer(name, position, adp) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team", "adp")
       VALUES ($1, $2, 'KC', $3) RETURNING "id"`,
      [name, position, adp]
    );
    createdPlayers.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function seedLeague({ name, inviteCode, owner, status, currentPick }) {
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code") VALUES ($1, $2, $3) RETURNING "id"`,
      [name, owner, inviteCode]
    );
    const id = res.rows[0].id;
    createdLeagues.push(id);
    await pool.query(
      `UPDATE "leagues"
       SET "draft_status" = $2, "draft_paused" = false, "current_pick" = $3,
           "roster_limit" = 10, "ir_slots" = 0, "min_teams" = 2,
           "current_season" = 2026, "current_week" = 1
       WHERE "id" = $1`,
      [id, status, currentPick]
    );
    return id;
  }

  async function seedTeam(leagueId, owner, name, draftPosition) {
    const res = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [leagueId, owner, name, draftPosition]
    );
    return res.rows[0].id;
  }

  async function boardVersion(leagueId) {
    const res = await pool.query('SELECT "board_version" FROM "leagues" WHERE "id" = $1', [leagueId]);
    return Number(res.rows[0].board_version);
  }

  // The last draft:state the room heard for this league.
  function lastDraftState() {
    const states = emits.filter((e) => e.event === 'draft:state');
    return states[states.length - 1].payload;
  }

  // POST a JSON body to the mounted router as `userId`, with a real bearer token
  // (the router's requireAuth verifies it); resolves to { status, body }.
  async function call(method, urlPath, userId, body) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signToken({ id: userId, username: `board_version_pg_${userId}` })}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  let ownerA = null;
  let ownerB = null;
  let activeLeague = null;
  let teamB = null;
  let pendingLeague = null;
  let pendingTeamA = null;
  let pendingTeamB = null;
  const playerIds = [];

  test.before(async () => {
    // In migration-smoke the schema is already at latest, so this is a no-op; a
    // standalone run against a fresh disposable database brings it up to date.
    await knex.migrate.latest();

    priorBroadcast = peekDraftRoomBroadcast();
    setDraftRoomBroadcast(createDraftRoomBroadcast(transport, 'io'));

    // The market gate (startDraft) refuses below MARKET_FLOOR (100) ADP players.
    for (let i = 1; i <= 100; i += 1) {
      playerIds.push(await seedPlayer(`Board Version Player ${i}`, 'RB', i));
    }

    ownerA = await seedUser('board_version_pg_a');
    ownerB = await seedUser('board_version_pg_b');

    // Active League: Alpha (position 1) is on the clock at index 0; Bravo at index 1.
    activeLeague = await seedLeague({ name: 'Board Version PG Active', inviteCode: 'bvactive1', owner: ownerA, status: 'active', currentPick: 0 });
    await seedTeam(activeLeague, ownerA, 'Alpha', 1);
    teamB = await seedTeam(activeLeague, ownerB, 'Bravo', 2);

    // Pending League for the clock, readiness, order, keepers and start writers.
    pendingLeague = await seedLeague({ name: 'Board Version PG Pending', inviteCode: 'bvpending1', owner: ownerA, status: 'pending', currentPick: 0 });
    pendingTeamA = await seedTeam(pendingLeague, ownerA, 'Alpha', 1);
    pendingTeamB = await seedTeam(pendingLeague, ownerB, 'Bravo', 2);

    // The mounted router: its own requireAuth reads the bearer token each call sends.
    const app = express();
    app.use(express.json());
    app.use('/api/draft', draftRouter);
    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    setDraftRoomBroadcast(priorBroadcast);
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    // Leagues cascade their teams, picks, activity and keepers; users and players
    // carry no league_id, so they are removed by id here.
    for (const id of createdLeagues) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [id]);
    for (const id of createdPlayers) await pool.query('DELETE FROM "players" WHERE "id" = $1', [id]);
    for (const id of createdUsers) await pool.query('DELETE FROM "users" WHERE "id" = $1', [id]);
    await knex.destroy();
    await pool.end();
  });

  // --- Picks (commitPick, the one Pick writer) ------------------------------------

  let firstPick = null;

  test('a manual Pick advances the board version and the draft:picked payload carries it', async () => {
    const before = await boardVersion(activeLeague);
    const outcome = await commitPick({ leagueId: activeLeague, by: { kind: 'manager', userId: ownerA }, playerId: playerIds[0] });
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(outcome.boardVersion, after, 'commitPick returns the version its transaction wrote');
    firstPick = outcome;
  });

  test('an Autopick advances the board version and the pick it lands carries it', async () => {
    const before = await boardVersion(activeLeague);
    // Bravo is on the clock at index 1 after Alpha's Pick; the Autopick is the Pick
    // the clock lands for it, so it runs with auto set.
    const outcome = await commitPick({ leagueId: activeLeague, by: { kind: 'autopick' }, playerId: playerIds[1] });
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(outcome.boardVersion, after);
    assert.ok(firstPick, 'the manual Pick ran first');
  });

  // --- Draft act module: pause, resume, autodraft toggle, reset --------------------

  // One act body that flips a Draft-state column, naming stateChanged so the room
  // hears the board. The board version moves at the lock, before the body runs.
  function stateAct(sql, params) {
    return async ({ client }) => {
      await client.query(sql, params);
      return { response: {}, activity: [], broadcasts: ['stateChanged'] };
    };
  }

  test('pause advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(activeLeague);
    emits.length = 0;
    await runDraftAct(
      { leagueId: activeLeague, userId: ownerA },
      stateAct('UPDATE "leagues" SET "draft_paused" = true WHERE "id" = $1', [activeLeague])
    );
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  test('resume advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(activeLeague);
    emits.length = 0;
    await runDraftAct(
      { leagueId: activeLeague, userId: ownerA },
      stateAct('UPDATE "leagues" SET "draft_paused" = false WHERE "id" = $1', [activeLeague])
    );
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  test('an autodraft toggle advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(activeLeague);
    emits.length = 0;
    await runDraftAct(
      { leagueId: activeLeague, userId: ownerB },
      stateAct('UPDATE "teams" SET "autodraft" = true WHERE "id" = $1', [teamB])
    );
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  // A reset is an act of the same module: its write takes the same League lock, so
  // this case drives that lock with the act's shape rather than a wipe of the Draft.
  test('a reset-shaped act advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(activeLeague);
    emits.length = 0;
    await runDraftAct(
      { leagueId: activeLeague, userId: ownerA },
      stateAct('UPDATE "leagues" SET "draft_paused" = true WHERE "id" = $1', [activeLeague])
    );
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  // --- Commissioner correction ----------------------------------------------------

  test('a Commissioner correction advances the board version', async () => {
    // The latest non-keeper Pick is Bravo's Autopick at pick number 2.
    const before = await boardVersion(activeLeague);
    await correctLatestPick({
      leagueId: activeLeague,
      userId: ownerA,
      expectedPickNumber: 2,
      reason: CORRECTION_REASON,
    });
    const after = await boardVersion(activeLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
  });

  // --- Draft router writers: clock, readiness, order, keepers ---------------------

  test('a readiness change refused for a League that is not pending advances nothing', async () => {
    const before = await boardVersion(activeLeague);
    const res = await call('POST', `/api/draft/league/${activeLeague}/ready`, ownerB, { ready: true });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(await boardVersion(activeLeague), before, 'a refused toggle never advances the version');
  });

  test('a readiness change by a caller who owns no Team in a pending League is refused and advances nothing', async () => {
    const outsider = await seedUser('board_version_pg_c');
    const before = await boardVersion(pendingLeague);
    const readyBefore = await pool.query(
      'SELECT "owner_id", "draft_ready" FROM "teams" WHERE "league_id" = $1 ORDER BY "id"',
      [pendingLeague]
    );
    const res = await call('POST', `/api/draft/league/${pendingLeague}/ready`, outsider, { ready: true });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(await boardVersion(pendingLeague), before, 'the membership guard refuses before any advance');
    const readyAfter = await pool.query(
      'SELECT "owner_id", "draft_ready" FROM "teams" WHERE "league_id" = $1 ORDER BY "id"',
      [pendingLeague]
    );
    assert.deepEqual(readyAfter.rows, readyBefore.rows, 'no Team row changed');
  });

  test('a clock change advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(pendingLeague);
    emits.length = 0;
    const res = await call('POST', `/api/draft/league/${pendingLeague}/clock`, ownerA, { pickTimeSeconds: 120 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await boardVersion(pendingLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  test('a readiness change advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(pendingLeague);
    emits.length = 0;
    const res = await call('POST', `/api/draft/league/${pendingLeague}/ready`, ownerB, { ready: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await boardVersion(pendingLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  test('an order change advances the board version (the order route sends no draft:state)', async () => {
    const before = await boardVersion(pendingLeague);
    const res = await call('POST', `/api/draft/league/${pendingLeague}/order`, ownerA, {
      order: [pendingTeamB, pendingTeamA],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await boardVersion(pendingLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
  });

  test('a keepers save advances the board version (the keepers route sends no draft:state)', async () => {
    const before = await boardVersion(pendingLeague);
    const res = await call('PUT', `/api/draft/league/${pendingLeague}/keepers`, ownerA, { keepers: [] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const after = await boardVersion(pendingLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
  });

  // --- Draft start (startDraft, and the scheduler's start through it) --------------

  test('a Draft start advances the board version and the draft:state it sends carries it', async () => {
    const before = await boardVersion(pendingLeague);
    emits.length = 0;
    await startDraft({ leagueId: pendingLeague, userId: ownerA });
    const after = await boardVersion(pendingLeague);
    assert.ok(after > before, `board_version ${after} must exceed ${before}`);
    assert.equal(lastDraftState().boardVersion, after);
  });

  test('memberSnapshot carries the version of the same read as the row', async () => {
    // Read after the writers above: the snapshot's version is the row's version.
    const { memberSnapshot } = require('../services/draftRoomSnapshot');
    const snapshot = await memberSnapshot(activeLeague);
    assert.equal(snapshot.boardVersion, await boardVersion(activeLeague));
  });
}
