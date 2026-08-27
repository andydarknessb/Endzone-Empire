/**
 * Disposable-Postgres test for the legacy feed backfill and cutover (#436,
 * ADR 0012).
 *
 * Every claim here is about the DATABASE - a re-sequencing UPDATE, explicit
 * legacy positions claimed through the shared registry, a boundary row, a
 * counter high-water, a guarded rollback - and a matcher fake cannot express any
 * of them: the fast suites run no triggers and no window-function backfill. So
 * it gets a real Postgres, seeding legacy chat and Picks while the migration is
 * DOWN (the pre-#436 production shape: chat already carries #434's feed_seq, the
 * registry mirrors it, draft_picks holds Picks with no activity) and rolling it
 * UP to observe the cutover.
 *
 * Claims, in the order #436's acceptance criteria list them:
 *
 * 1. COMBINED ORDER + TIE-BREAK (AC1, AC2). Chat and Picks interleave into one
 *    per-league chronology by (created_at, Pick-before-chat at an equal instant,
 *    source id); every legacy row is marked legacy and keeps its source id and
 *    timestamp; keepers backfill like any Pick; round is derived from team count;
 *    an absent autopick fact reads false, not fabricated.
 * 2. THE BOUNDARY (AC3). One 'cutover' row sits just past the legacy set, is not
 *    itself legacy, and the counter is seeded to it so live entries continue
 *    strictly past it. A chat-only league gets a boundary too and keeps its
 *    order.
 * 3. RECONCILIATION (AC5). A freshly backfilled feed reconciles clean: source
 *    coverage, per-league uniqueness, registry coverage and counter high-water.
 * 4. ROLLING-DEPLOY GAP (AC4). An old instance's Pick committed after the
 *    migration (a draft_picks row with no activity) fails reconciliation, and
 *    captureLegacyPicks appends it idempotently as a LIVE entry past the
 *    boundary, after which reconciliation is clean again.
 * 5. APPEND-ONLY THROUGH UNDO / RESET (AC8). Deleting the source Pick (undo, or
 *    the reset's bulk delete) leaves its backfilled activity entry standing.
 * 6. DELETION PROPAGATION (AC6). Removing a chat message removes its feed
 *    position too, leaving a gap with no retained copy and no orphan the
 *    registry would flag.
 * 7. GUARDED ROLLBACK (AC7). down() REFUSES while an authoritative live event
 *    exists, and is LOSSLESS while only legacy + boundary do: it restores the
 *    #434 chat-only order and re-derives on the next up().
 *
 * Gated twice, exactly like leagueChatFeed.pg.test.js and
 * sharedFeedPosition.pg.test.js: LEGACY_FEED_BACKFILL_PG_TESTS=1 (or the
 * umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must be
 * ABSENT, so a stray local run can never touch the shared production database.
 * Seeds and deletes its own leagues and users.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listCombinedDraftFeed } = require('../services/leagueFeed');
const { appendPickActivity } = require('../services/draftActivity');
const {
  captureLegacyPicks,
  reconcileLegacyFeed,
} = require('../services/legacyFeedBackfill');
const { deleteChatMessagesBatch } = require('../services/retention.service');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEGACY_FEED_BACKFILL_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('legacy feed backfill PG tests (skipped: set PG_TESTS=1 or LEGACY_FEED_BACKFILL_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('legacy feed backfill PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
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
  const pool = new pg.Pool({ ...connection, max: 4 });
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });

  const MIGRATION_NAME = '20260827000010_backfill_legacy_feed.js';

  // Timestamps: T2 is shared by a Pick and a message in league A so the
  // record-type tie-break (Pick before chat) is exercised, not assumed.
  const T1 = '2026-09-01T00:00:00.000Z';
  const T2 = '2026-09-01T00:05:00.000Z';
  const T3 = '2026-09-01T00:10:00.000Z';
  const T4 = '2026-09-01T00:15:00.000Z';
  const T5 = '2026-09-01T00:20:00.000Z';

  // Seeded ids, filled in test.before.
  const L = {}; // league ids by key
  const owner = {}; // owner id by league key
  const team = {}; // { key: { alpha, bravo } }
  const chatA = {}; // league A chat ids by label

  let playerSeq = 0;

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    return res.rows[0].id;
  }
  async function seedLeague(name, ownerId, code) {
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code")
       VALUES ($1, $2, $3) RETURNING "id"`,
      [name, ownerId, code]
    );
    return res.rows[0].id;
  }
  async function seedTeam(leagueId, ownerId, name) {
    const res = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, $3) RETURNING "id"`,
      [leagueId, ownerId, name]
    );
    return res.rows[0].id;
  }
  async function seedPlayer() {
    playerSeq += 1;
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, $2, $3) RETURNING "id"`,
      [`Player ${playerSeq}`, 'RB', 'KC']
    );
    return res.rows[0].id;
  }
  // A legacy chat insert against the pre-#436 shape (chat already has #434's
  // feed_seq via its trigger; the registry claims it via #471's trigger).
  async function seedChat(leagueId, userId, message, createdAt) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message", "created_at")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [leagueId, userId, message, createdAt]
    );
    return res.rows[0].id;
  }
  // A surviving Pick: a draft_picks row with no activity, the source the backfill
  // reads. Uses a fresh player so the (league_id, player_id) unique holds.
  async function seedPick(leagueId, teamId, pickNumber, createdAt, isKeeper = false) {
    const playerId = await seedPlayer();
    await pool.query(
      `INSERT INTO "draft_picks"
         ("league_id", "team_id", "player_id", "pick_number", "is_keeper", "created_at")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leagueId, teamId, playerId, pickNumber, isKeeper, createdAt]
    );
    return playerId;
  }
  async function feedOf(leagueId, viewerId) {
    return listCombinedDraftFeed(pool, { leagueId, viewerId });
  }
  async function counterOf(leagueId) {
    const res = await pool.query('SELECT "last_seq" FROM "league_feed_sequences" WHERE "league_id" = $1', [leagueId]);
    return res.rows[0] ? Number(res.rows[0].last_seq) : null;
  }
  async function chatSeqs(leagueId) {
    const res = await pool.query('SELECT "feed_seq" FROM "chat_messages" WHERE "league_id" = $1 ORDER BY "feed_seq"', [leagueId]);
    return res.rows.map((r) => Number(r.feed_seq));
  }
  async function registryCount(leagueId) {
    const res = await pool.query('SELECT count(*)::int AS n FROM "league_feed_positions" WHERE "league_id" = $1', [leagueId]);
    return res.rows[0].n;
  }

  test.before(async () => {
    // Roll the backfill DOWN so the seed lands in the pre-#436 shape, then UP to
    // observe the cutover. Only this migration moves; nothing depends on it.
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (applied) await knex.migrate.down({ name: MIGRATION_NAME });

    const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const k of keys) {
      owner[k] = await seedUser(`legacy_feed_${k.toLowerCase()}`);
      L[k] = await seedLeague(`Legacy Feed ${k}`, owner[k], `legacyfeed${k.toLowerCase()}`);
      team[k] = { alpha: await seedTeam(L[k], owner[k], 'Alpha'), bravo: await seedTeam(L[k], owner[k], 'Bravo') };
    }

    // League A: chat interleaved with Picks, a shared instant, a keeper, a
    // round rollover. Seeded in a deliberate created_at order.
    chatA.c1 = await seedChat(L.A, owner.A, 'good luck all', T1);
    await seedPick(L.A, team.A.alpha, 1, T2, true); // keeper at the shared instant
    chatA.c2 = await seedChat(L.A, owner.A, 'nice keeper', T2); // ties the Pick
    await seedPick(L.A, team.A.bravo, 2, T3);
    await seedPick(L.A, team.A.alpha, 3, T4); // round 2 (2 teams)
    chatA.c3 = await seedChat(L.A, owner.A, 'gg', T5);

    // League B: chat only, two messages.
    await seedChat(L.B, owner.B, 'b-one', T1);
    await seedChat(L.B, owner.B, 'b-two', T2);

    // League C: one Pick + one message (a straggler is added after migration).
    await seedChat(L.C, owner.C, 'c-chat', T1);
    await seedPick(L.C, team.C.alpha, 1, T2);

    // League D: two Picks + a message (undo/reset delete them later).
    await seedChat(L.D, owner.D, 'd-chat', T1);
    await seedPick(L.D, team.D.alpha, 1, T2);
    await seedPick(L.D, team.D.bravo, 2, T3);

    // League E: three messages (one is deleted later).
    await seedChat(L.E, owner.E, 'e-one', T1);
    chatA.eMid = await seedChat(L.E, owner.E, 'e-two', T2);
    await seedChat(L.E, owner.E, 'e-three', T3);

    // League F: one message (a live Pick is appended later to block rollback).
    await seedChat(L.F, owner.F, 'f-chat', T1);

    await knex.migrate.up({ name: MIGRATION_NAME });
  });

  test.after(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.up({ name: MIGRATION_NAME });
    for (const k of Object.keys(L)) {
      if (L[k]) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [L[k]]);
    }
    for (const k of Object.keys(owner)) {
      if (owner[k]) await pool.query('DELETE FROM "users" WHERE "id" = $1', [owner[k]]);
    }
    await pool.query(`DELETE FROM "players" WHERE "name" LIKE 'Player %'`);
    await pool.end();
    await knex.destroy();
  });

  test('chat and Picks interleave into one legacy order, Pick before chat at a tie (AC1, AC2)', async () => {
    const feed = await feedOf(L.A, owner.A);
    // Expected combined order: c1(T1), pick#1(T2), c2(T2 chat, after the Pick),
    // pick#2(T3), pick#3(T4), c3(T5), then the boundary.
    assert.deepEqual(feed.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7], 'contiguous 1..7 including the boundary');
    assert.deepEqual(
      feed.map((e) => [e.type, e.kind ?? null]),
      [
        ['league_chat', null],
        ['draft_activity', 'pick'],
        ['league_chat', null],
        ['draft_activity', 'pick'],
        ['draft_activity', 'pick'],
        ['league_chat', null],
        ['draft_activity', 'cutover'],
      ],
      'a Pick at the shared instant sorts before the message at that instant'
    );
    assert.equal(feed[0].message, 'good luck all');
    assert.equal(feed[2].message, 'nice keeper');
  });

  test('every legacy row is marked legacy, the boundary is not (AC2, AC3)', async () => {
    const feed = await feedOf(L.A, owner.A);
    assert.deepEqual(
      feed.map((e) => e.isLegacy),
      [true, true, true, true, true, true, false],
      'the six legacy rows read legacy; the cutover boundary does not'
    );
    assert.equal(feed[6].kind, 'cutover');
    assert.equal(feed[6].isLegacy, false);
  });

  test('a legacy Pick snapshots Team, player and derived round; a keeper is a Pick; autopick is not fabricated (AC1)', async () => {
    const feed = await feedOf(L.A, owner.A);
    const pick1 = feed[1];
    assert.equal(pick1.kind, 'pick');
    assert.equal(pick1.teamName, 'Alpha');
    assert.equal(pick1.pickNumber, 1);
    assert.equal(pick1.round, 1, 'pick 1 of 2 teams is round 1');
    assert.equal(pick1.isAutopick, false, 'an unstored autopick fact reads false, not fabricated');
    assert.equal(typeof pick1.player.name, 'string');
    const pick3 = feed[4];
    assert.equal(pick3.pickNumber, 3);
    assert.equal(pick3.round, 2, 'pick 3 of 2 teams rolls over to round 2');
  });

  test('the counter is seeded past the boundary so a live entry continues strictly after it (AC3)', async () => {
    assert.equal(await counterOf(L.A), 7, 'counter at the boundary position');
    assert.equal(await registryCount(L.A), 7, 'seven registered positions (six legacy + boundary)');
    // A live chat now continues at 8, never reusing a legacy or boundary slot.
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message") VALUES ($1, $2, 'a-live') RETURNING "feed_seq"`,
      [L.A, owner.A]
    );
    assert.equal(Number(res.rows[0].feed_seq), 8);
    assert.equal(await counterOf(L.A), 8);
    // Undo the live insert so the later rollback test sees only legacy + boundary.
    await pool.query(`DELETE FROM "chat_messages" WHERE "league_id" = $1 AND "message" = 'a-live'`, [L.A]);
    await pool.query(
      `DELETE FROM "league_feed_positions" WHERE "league_id" = $1 AND "feed_seq" = 8`,
      [L.A]
    );
    await pool.query('UPDATE "league_feed_sequences" SET "last_seq" = 7 WHERE "league_id" = $1', [L.A]);
  });

  test('a chat-only league keeps its order and still gets a boundary (AC3)', async () => {
    const feed = await feedOf(L.B, owner.B);
    assert.deepEqual(feed.map((e) => [e.type, e.kind ?? null, e.seq]), [
      ['league_chat', null, 1],
      ['league_chat', null, 2],
      ['draft_activity', 'cutover', 3],
    ]);
    assert.equal(await counterOf(L.B), 3);
  });

  test('a freshly backfilled feed reconciles clean (AC5)', async () => {
    const report = await reconcileLegacyFeed(pool, { leagueId: L.A });
    assert.deepEqual(report, { ok: true, failures: [] });
    const all = await reconcileLegacyFeed(pool);
    assert.equal(all.ok, true, `whole-database reconciliation is clean: ${JSON.stringify(all.failures)}`);
  });

  test('a completed Draft backfills every Pick as legacy, with no live entry and nothing left to capture (AC8)', async () => {
    // League A is a completed Draft: every Pick was committed before the
    // migration, so all three land as legacy Pick entries and none is live, and
    // a capture pass finds no straggler (the draft produces no more Picks).
    const feed = await feedOf(L.A, owner.A);
    const picks = feed.filter((e) => e.kind === 'pick');
    assert.equal(picks.length, 3, 'all three committed Picks are in the feed');
    assert.ok(picks.every((p) => p.isLegacy === true), 'every Pick of a completed Draft is legacy');
    assert.equal(feed.filter((e) => e.kind === 'pick' && e.isLegacy === false).length, 0, 'a completed Draft has no live Pick');
    assert.equal(await captureLegacyPicks(pool, { leagueId: L.A }), 0, 'a completed Draft has no straggler to capture');
    assert.equal((await reconcileLegacyFeed(pool, { leagueId: L.A })).ok, true);
  });

  test('a rolling-deploy straggler Pick fails reconciliation, then captures as a live entry past the boundary (AC4)', async () => {
    // An old instance commits a Pick AFTER the migration: a draft_picks row with
    // no activity. Reconciliation catches the uncovered Pick.
    await seedPick(L.C, team.C.bravo, 2, T3);
    const before = await reconcileLegacyFeed(pool, { leagueId: L.C });
    assert.equal(before.ok, false);
    assert.equal(before.failures[0].check, 'source-coverage');

    // Capture appends exactly it, as a LIVE (not legacy) entry past the boundary.
    const captured = await captureLegacyPicks(pool, { leagueId: L.C });
    assert.equal(captured, 1, 'exactly the straggler is captured');
    const feed = await feedOf(L.C, owner.C);
    const last = feed[feed.length - 1];
    assert.equal(last.kind, 'pick');
    assert.equal(last.pickNumber, 2);
    assert.equal(last.isLegacy, false, 'a straggler committed after cutover is a live entry, not legacy');
    const boundary = feed.find((e) => e.kind === 'cutover');
    assert.ok(last.seq > boundary.seq, 'the captured Pick sits past the boundary');

    // Idempotent: a second capture does nothing and the feed reconciles clean.
    assert.equal(await captureLegacyPicks(pool, { leagueId: L.C }), 0, 're-capture is a no-op');
    const after = await reconcileLegacyFeed(pool, { leagueId: L.C });
    assert.deepEqual(after, { ok: true, failures: [] });
  });

  test('a backfilled Pick entry survives undo and reset of its source Pick (AC8, append-only)', async () => {
    const before = await feedOf(L.D, owner.D);
    const picksBefore = before.filter((e) => e.kind === 'pick');
    assert.equal(picksBefore.length, 2);

    // Undo: the pick service hard-deletes the latest draft_picks row.
    await pool.query('DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = 2', [L.D]);
    let feed = await feedOf(L.D, owner.D);
    assert.equal(feed.filter((e) => e.kind === 'pick').length, 2, 'the append-only activity entry outlives the undone Pick');

    // Reset: the draft reset bulk-deletes every draft_picks row for the league.
    await pool.query('DELETE FROM "draft_picks" WHERE "league_id" = $1', [L.D]);
    feed = await feedOf(L.D, owner.D);
    assert.equal(feed.filter((e) => e.kind === 'pick').length, 2, 'both legacy Pick entries stand after a reset');
    // Reconciliation still clean: no draft_picks remain, so nothing is uncovered.
    assert.equal((await reconcileLegacyFeed(pool, { leagueId: L.D })).ok, true);
  });

  test('removing a chat message leaves a gap with no retained copy and no orphan position (AC6)', async () => {
    const before = await feedOf(L.E, owner.E);
    assert.deepEqual(before.map((e) => e.seq), [1, 2, 3, 4], 'three messages plus a boundary');

    // Retention/account deletion path: delete the middle message AND its
    // registered position together.
    const removed = await deleteChatMessagesBatch(`"league_id" = ${Number(L.E)} AND "message" = 'e-two'`, [], pool);
    assert.equal(removed, 1);

    const feed = await feedOf(L.E, owner.E);
    assert.deepEqual(feed.map((e) => e.seq), [1, 3, 4], 'seq 2 is a gap; nothing renumbered');
    assert.equal(feed.some((e) => e.message === 'e-two'), false, 'the removed content is gone, not retained');
    // No orphan position remains, so reconciliation stays clean and the counter
    // never reuses the freed slot.
    assert.equal(await registryCount(L.E), 3, 'the deleted message took its registry position with it');
    assert.equal((await reconcileLegacyFeed(pool, { leagueId: L.E })).ok, true);
  });

  test('rollback REFUSES while an authoritative live event exists (AC7)', async () => {
    // Append a live Pick past league F's boundary (is_legacy false).
    await appendPickActivity(pool, {
      leagueId: L.F,
      team: { id: team.F.alpha, name: 'Alpha' },
      player: { id: await seedPlayer(), name: 'Live Player', position: 'WR', nfl_team: 'KC' },
      round: 1,
      pickNumber: 1,
      auto: false,
    });
    await assert.rejects(
      () => knex.migrate.down({ name: MIGRATION_NAME }),
      /refusing to roll back|append-only/i,
      'down() refuses to erase live Draft history'
    );
    // The failed down() rolled back, so the migration is still applied. Remove
    // the live event (and its position) so the lossless-rollback test below can
    // run - and delete league F entirely so no live activity lingers.
    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [L.F]);
    L.F = null;
  });

  test('rollback is LOSSLESS while only legacy + boundary exist: down() restores #434 order, up() re-derives (AC7)', async () => {
    // Leagues C and D still carry live/mutated activity from earlier tests;
    // delete them so only the pristine legacy leagues (A, B) and the
    // gap-bearing E remain, none holding a live event.
    for (const k of ['C', 'D', 'E']) {
      if (L[k]) {
        await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [L[k]]);
        L[k] = null;
      }
    }

    await knex.migrate.down({ name: MIGRATION_NAME });
    // League A's chat is back to the #434 chat-only order (contiguous 1..3 by
    // created_at, id), and its Picks are no longer in activity.
    assert.deepEqual(await chatSeqs(L.A), [1, 2, 3], 'chat restored to contiguous #434 order');
    const act = await pool.query('SELECT count(*)::int AS n FROM "draft_activity" WHERE "league_id" = $1', [L.A]);
    assert.equal(act.rows[0].n, 0, 'the legacy Pick and boundary rows are gone');

    // Forward again: the backfill re-derives exactly the same combined feed.
    await knex.migrate.up({ name: MIGRATION_NAME });
    const feed = await feedOf(L.A, owner.A);
    assert.deepEqual(feed.map((e) => [e.type, e.kind ?? null, e.seq]), [
      ['league_chat', null, 1],
      ['draft_activity', 'pick', 2],
      ['league_chat', null, 3],
      ['draft_activity', 'pick', 4],
      ['draft_activity', 'pick', 5],
      ['league_chat', null, 6],
      ['draft_activity', 'cutover', 7],
    ], 'up() re-derives the identical combined order');
    assert.equal(await counterOf(L.A), 7);
  });
}
