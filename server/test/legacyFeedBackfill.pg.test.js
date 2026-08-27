/**
 * Disposable-Postgres test for the legacy feed backfill and cutover (#436,
 * ADR 0012).
 *
 * Every claim here is about the DATABASE - a re-sequencing UPDATE, explicit
 * legacy positions claimed through the shared registry, a boundary row, a
 * counter high-water, source-identity coverage, a guarded rollback - and a
 * matcher fake cannot express any of them. So it gets a real Postgres, seeding
 * legacy chat and Picks while the migration is DOWN (the pre-#436 production
 * shape) and rolling it UP to observe the cutover.
 *
 * Claims, grouped by acceptance criterion:
 *
 *   AC1/AC2  Chat and non-keeper Picks interleave into one per-league chronology
 *            by (created_at, Pick-before-chat at a tie, source id); every legacy
 *            row is marked legacy and keeps its source id and timestamp; round is
 *            derived from team count; an absent autopick fact reads false.
 *   AC2/AC3  One 'cutover' row sits just past the legacy set, is not itself
 *            legacy, and the counter is seeded to it. A chat-only league too.
 *   AC5      A freshly backfilled feed reconciles clean, and an undo + re-pick is
 *            reported UNCOVERED (never a false green) until captured.
 *   AC4      An old instance's post-migration Pick captures idempotently as a
 *            LIVE entry past the boundary.
 *   AC8      A completed Draft's non-keeper Picks are all legacy; a KEEPER is
 *            never a feed entry; a backfilled Pick survives undo and reset.
 *   AC6      Retention and account deletion both leave a gap with no retained
 *            copy and no orphan registry position.
 *   AC7      down() REFUSES while a live event exists and is lossless otherwise.
 *
 * Gated twice, exactly like the sibling pg suites: LEGACY_FEED_BACKFILL_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must
 * be ABSENT, so a stray local run can never touch the shared production database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listCombinedDraftFeed } = require('../services/leagueFeed');
const { appendPickActivity } = require('../services/draftActivity');
const { captureLegacyPicks, reconcileLegacyFeed } = require('../services/legacyFeedBackfill');
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

  // T2 is shared by a Pick and a message in league A so the record-type tie-break
  // (Pick before chat) is exercised, not assumed.
  const T1 = '2026-09-01T00:00:00.000Z';
  const T2 = '2026-09-01T00:05:00.000Z';
  const T3 = '2026-09-01T00:10:00.000Z';
  const T4 = '2026-09-01T00:15:00.000Z';

  const L = {}; // league ids by key
  const owner = {}; // alpha's owner id by league key (also league owner + viewer)
  const ownerB = {}; // bravo's owner id by league key (distinct owner per team)
  const team = {}; // { key: { alpha, bravo } }

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
  async function seedChat(leagueId, userId, message, createdAt) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message", "created_at")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [leagueId, userId, message, createdAt]
    );
    return res.rows[0].id;
  }
  // A surviving Pick: a draft_picks row with no activity, the source the backfill
  // reads. Returns { pickId, playerId } so undo/re-pick tests can reference it.
  async function seedPick(leagueId, teamId, pickNumber, createdAt, isKeeper = false) {
    const playerId = await seedPlayer();
    const res = await pool.query(
      `INSERT INTO "draft_picks"
         ("league_id", "team_id", "player_id", "pick_number", "is_keeper", "created_at")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING "id"`,
      [leagueId, teamId, playerId, pickNumber, isKeeper, createdAt]
    );
    return { pickId: res.rows[0].id, playerId };
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

  let keeperPlayerId = null; // league A's keeper player, to prove it is excluded

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (applied) await knex.migrate.down({ name: MIGRATION_NAME });

    const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (const k of keys) {
      // Two owners per league: teams_league_id_owner_id_unique forbids one owner
      // holding two teams in a league, so alpha and bravo get distinct owners.
      // owner[k] (alpha's) is also the league owner and the feed viewer; no
      // scenario relies on the two teams sharing an owner.
      owner[k] = await seedUser(`legacy_feed_${k.toLowerCase()}`);
      ownerB[k] = await seedUser(`legacy_feed_${k.toLowerCase()}_b`);
      L[k] = await seedLeague(`Legacy Feed ${k}`, owner[k], `legacyfeed${k.toLowerCase()}`);
      team[k] = { alpha: await seedTeam(L[k], owner[k], 'Alpha'), bravo: await seedTeam(L[k], ownerB[k], 'Bravo') };
    }

    // League A: a completed Draft. Chat interleaved with non-keeper Picks, a
    // shared instant (p1 ties c2), a round rollover, and a KEEPER that must be
    // excluded from the feed. pick_numbers: keeper 1, then non-keepers 2 and 3.
    await seedChat(L.A, owner.A, 'good luck all', T1);
    const keeper = await seedPick(L.A, team.A.alpha, 1, T1, true); // keeper, excluded
    keeperPlayerId = keeper.playerId;
    await seedPick(L.A, team.A.alpha, 2, T2); // non-keeper, ties c2, round 1
    await seedChat(L.A, owner.A, 'nice pick', T2); // ties the Pick
    await seedPick(L.A, team.A.bravo, 3, T3); // non-keeper, round 2
    await seedChat(L.A, owner.A, 'gg', T4);
    await pool.query(`UPDATE "leagues" SET "draft_status" = 'complete' WHERE "id" = $1`, [L.A]);

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

    // League E: three messages (one is deleted later, retention style).
    await seedChat(L.E, owner.E, 'e-one', T1);
    await seedChat(L.E, owner.E, 'e-two', T2);
    await seedChat(L.E, owner.E, 'e-three', T3);

    // League F: one message (a live Pick is appended later to block rollback).
    await seedChat(L.F, owner.F, 'f-chat', T1);

    // League G: one Pick + one message (undo + re-pick false-green test).
    await seedChat(L.G, owner.G, 'g-chat', T1);
    await seedPick(L.G, team.G.alpha, 1, T2);

    // League H: two messages by two owners (account-deletion test deletes one).
    await seedChat(L.H, owner.H, 'h-owner', T1);
    await seedChat(L.H, ownerB.H, 'h-other', T2);

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
    for (const k of Object.keys(ownerB)) {
      if (ownerB[k]) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB[k]]);
    }
    await pool.query(`DELETE FROM "players" WHERE "name" LIKE 'Player %'`);
    await pool.end();
    await knex.destroy();
  });

  test('chat and non-keeper Picks interleave into one legacy order, Pick before chat at a tie (AC1, AC2)', async () => {
    const feed = await feedOf(L.A, owner.A);
    // c1(T1), p1(T2), c2(T2), p2(T3), c3(T4), then the boundary. The keeper is
    // absent, so there are two Pick entries, not three.
    assert.deepEqual(feed.map((e) => e.seq), [1, 2, 3, 4, 5, 6], 'contiguous 1..6 including the boundary');
    assert.deepEqual(
      feed.map((e) => [e.type, e.kind ?? null]),
      [
        ['league_chat', null],
        ['draft_activity', 'pick'],
        ['league_chat', null],
        ['draft_activity', 'pick'],
        ['league_chat', null],
        ['draft_activity', 'cutover'],
      ],
      'a Pick at the shared instant sorts before the message at that instant'
    );
    assert.equal(feed[0].message, 'good luck all');
    assert.equal(feed[2].message, 'nice pick');
  });

  test('a keeper is never a legacy feed entry (AC8)', async () => {
    const feed = await feedOf(L.A, owner.A);
    const picks = feed.filter((e) => e.kind === 'pick');
    assert.equal(picks.length, 2, 'two non-keeper Picks; the keeper is not among them');
    assert.equal(
      picks.some((p) => p.player && p.player.id === keeperPlayerId),
      false,
      'the keeper player never appears as a Pick entry'
    );
  });

  test('every legacy row is marked legacy, the boundary is not; round derives from team count (AC1, AC2, AC3)', async () => {
    const feed = await feedOf(L.A, owner.A);
    assert.deepEqual(
      feed.map((e) => e.isLegacy),
      [true, true, true, true, true, false],
      'the five legacy rows read legacy; the cutover boundary does not'
    );
    assert.equal(feed[5].kind, 'cutover');
    assert.equal(feed[1].round, 1, 'pick_number 2 of 2 teams is round 1');
    assert.equal(feed[1].isAutopick, false, 'an unstored autopick fact reads false, not fabricated');
    assert.equal(feed[3].round, 2, 'pick_number 3 of 2 teams rolls over to round 2');
    assert.equal(typeof feed[1].player.name, 'string');
  });

  test('the counter is seeded past the boundary so a live entry continues strictly after it (AC3)', async () => {
    assert.equal(await counterOf(L.A), 6, 'counter at the boundary position');
    assert.equal(await registryCount(L.A), 6, 'six registered positions (five legacy + boundary)');
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message") VALUES ($1, $2, 'a-live') RETURNING "feed_seq"`,
      [L.A, owner.A]
    );
    assert.equal(Number(res.rows[0].feed_seq), 7);
    // Undo the live insert so the later rollback test sees only legacy + boundary.
    await pool.query(`DELETE FROM "chat_messages" WHERE "league_id" = $1 AND "message" = 'a-live'`, [L.A]);
    await pool.query(`DELETE FROM "league_feed_positions" WHERE "league_id" = $1 AND "feed_seq" = 7`, [L.A]);
    await pool.query('UPDATE "league_feed_sequences" SET "last_seq" = 6 WHERE "league_id" = $1', [L.A]);
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

  test('a completed Draft reconciles clean: every non-keeper Pick covered, keeper never uncovered (AC5, AC8)', async () => {
    const report = await reconcileLegacyFeed(pool, { leagueId: L.A });
    assert.deepEqual(report, { ok: true, failures: [] });
    // The keeper is skipped, so capture finds no straggler and never fabricates it.
    assert.equal(await captureLegacyPicks(pool, { leagueId: L.A }), 0, 'a completed Draft has no straggler, and no keeper is captured');
    assert.deepEqual(await reconcileLegacyFeed(pool, { leagueId: L.A }), { ok: true, failures: [] });
  });

  test('a rolling-deploy straggler Pick captures as a live entry past the boundary (AC4)', async () => {
    await seedPick(L.C, team.C.bravo, 2, T3);
    const before = await reconcileLegacyFeed(pool, { leagueId: L.C });
    assert.equal(before.ok, false);
    assert.equal(before.failures[0].check, 'source-coverage');

    const captured = await captureLegacyPicks(pool, { leagueId: L.C });
    assert.equal(captured, 1, 'exactly the straggler is captured');
    const feed = await feedOf(L.C, owner.C);
    const last = feed[feed.length - 1];
    assert.equal(last.kind, 'pick');
    assert.equal(last.pickNumber, 2);
    assert.equal(last.isLegacy, false, 'a straggler committed after cutover is a live entry, not legacy');
    const boundary = feed.find((e) => e.kind === 'cutover');
    assert.ok(last.seq > boundary.seq, 'the captured Pick sits past the boundary');

    assert.equal(await captureLegacyPicks(pool, { leagueId: L.C }), 0, 're-capture is a no-op');
    assert.deepEqual(await reconcileLegacyFeed(pool, { leagueId: L.C }), { ok: true, failures: [] });
  });

  test('an undo + re-pick is reported UNCOVERED, never a false green, then captures the new Pick (AC5, Blocker 1)', async () => {
    // League G backfilled: g-chat(1), pick(2, legacy source_pick_id set), boundary(3).
    const feedBefore = await feedOf(L.G, owner.G);
    const oldPick = feedBefore.find((e) => e.kind === 'pick');
    assert.ok(oldPick && oldPick.isLegacy, 'the original Pick is a legacy entry');
    assert.deepEqual(await reconcileLegacyFeed(pool, { leagueId: L.G }), { ok: true, failures: [] });

    // Old-instance undo: hard-delete the draft_picks row (the legacy entry survives).
    await pool.query('DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = 1', [L.G]);
    // Old-instance re-pick: a NEW draft_picks row REUSING pick_number 1, different player.
    const newPlayer = await seedPlayer();
    await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "created_at")
       VALUES ($1, $2, $3, 1, $4)`,
      [L.G, team.G.alpha, newPlayer, T3]
    );

    // The re-picked Pick reuses a number a legacy entry holds. Coverage-by-identity
    // reports it UNCOVERED - the pick_number match that would falsely pass is gone.
    const stale = await reconcileLegacyFeed(pool, { leagueId: L.G });
    assert.equal(stale.ok, false, 'a re-picked number is NOT reported covered by the reversed Pick');
    assert.equal(stale.failures[0].check, 'source-coverage');

    // Capture appends the new Pick; now both the reversed legacy Pick and the new
    // live Pick are in the feed, and reconciliation is clean.
    assert.equal(await captureLegacyPicks(pool, { leagueId: L.G }), 1);
    const feedAfter = await feedOf(L.G, owner.G);
    assert.equal(feedAfter.filter((e) => e.kind === 'pick').length, 2, 'the reversed Pick and the re-pick both stand');
    assert.deepEqual(await reconcileLegacyFeed(pool, { leagueId: L.G }), { ok: true, failures: [] });
  });

  test('a backfilled Pick entry survives undo and reset of its source Pick (AC8, append-only)', async () => {
    const before = await feedOf(L.D, owner.D);
    assert.equal(before.filter((e) => e.kind === 'pick').length, 2);

    await pool.query('DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = 2', [L.D]);
    let feed = await feedOf(L.D, owner.D);
    assert.equal(feed.filter((e) => e.kind === 'pick').length, 2, 'the append-only activity entry outlives the undone Pick');

    await pool.query('DELETE FROM "draft_picks" WHERE "league_id" = $1', [L.D]);
    feed = await feedOf(L.D, owner.D);
    assert.equal(feed.filter((e) => e.kind === 'pick').length, 2, 'both legacy Pick entries stand after a reset');
    assert.equal((await reconcileLegacyFeed(pool, { leagueId: L.D })).ok, true);
  });

  test('retention removes a chat message with no retained copy and no orphan position (AC6)', async () => {
    const before = await feedOf(L.E, owner.E);
    assert.deepEqual(before.map((e) => e.seq), [1, 2, 3, 4], 'three messages plus a boundary');

    const removed = await deleteChatMessagesBatch(`"league_id" = ${Number(L.E)} AND "message" = 'e-two'`, [], pool);
    assert.equal(removed, 1);

    const feed = await feedOf(L.E, owner.E);
    assert.deepEqual(feed.map((e) => e.seq), [1, 3, 4], 'seq 2 is a gap; nothing renumbered');
    assert.equal(feed.some((e) => e.message === 'e-two'), false, 'the removed content is gone, not retained');
    assert.equal(await registryCount(L.E), 3, 'the deleted message took its registry position with it');
    assert.equal((await reconcileLegacyFeed(pool, { leagueId: L.E })).ok, true);
  });

  test('account deletion removes a member\'s chat and its feed positions, leaving a gap and no orphan (AC6)', async () => {
    const before = await feedOf(L.H, owner.H);
    assert.deepEqual(before.map((e) => e.seq), [1, 2, 3], 'two messages plus a boundary');

    // The privacy.service.deleteUserAccount path: purge the account's feed
    // positions, then delete its chat, in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM "league_feed_positions"
          WHERE "record_kind" = 'league_chat'
            AND "source_id" IN (SELECT "id" FROM "chat_messages" WHERE "user_id" = $1)`,
        [owner.H]
      );
      await client.query('DELETE FROM "chat_messages" WHERE "user_id" = $1', [owner.H]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const feed = await feedOf(L.H, owner.H);
    assert.deepEqual(feed.map((e) => e.seq), [2, 3], 'the deleted member\'s seq 1 is a gap');
    assert.equal(feed.some((e) => e.message === 'h-owner'), false, 'the deleted content is gone, not retained');
    assert.equal(await registryCount(L.H), 2, 'the deleted message took its registry position with it');
    assert.equal((await reconcileLegacyFeed(pool, { leagueId: L.H })).ok, true, 'no orphan position remains');
  });

  test('rollback REFUSES while an authoritative live event exists (AC7)', async () => {
    await appendPickActivity(pool, {
      leagueId: L.F,
      team: { id: team.F.alpha, name: 'Alpha' },
      player: { id: await seedPlayer(), name: 'Live Player', position: 'WR', nfl_team: 'KC' },
      round: 1,
      pickNumber: 1,
      auto: false,
      sourcePickId: null,
    });
    await assert.rejects(
      () => knex.migrate.down({ name: MIGRATION_NAME }),
      /refusing to roll back|append-only/i,
      'down() refuses to erase live Draft history'
    );
    // The failed down() rolled back, so the migration is still applied. Delete
    // every league that now carries a live or captured entry so the lossless
    // rollback below sees only legacy + boundary anywhere.
    for (const k of ['C', 'D', 'E', 'F', 'G', 'H']) {
      if (L[k]) {
        await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [L[k]]);
        L[k] = null;
      }
    }
  });

  test('rollback is LOSSLESS while only legacy + boundary exist: down() restores #434 order, up() re-derives (AC7)', async () => {
    await knex.migrate.down({ name: MIGRATION_NAME });
    // League A's chat is back to the #434 chat-only order (contiguous 1..3), and
    // its Picks are no longer in activity.
    assert.deepEqual(await chatSeqs(L.A), [1, 2, 3], 'chat restored to contiguous #434 order');
    const act = await pool.query('SELECT count(*)::int AS n FROM "draft_activity" WHERE "league_id" = $1', [L.A]);
    assert.equal(act.rows[0].n, 0, 'the legacy Pick and boundary rows are gone');

    await knex.migrate.up({ name: MIGRATION_NAME });
    const feed = await feedOf(L.A, owner.A);
    assert.deepEqual(feed.map((e) => [e.type, e.kind ?? null, e.seq]), [
      ['league_chat', null, 1],
      ['draft_activity', 'pick', 2],
      ['league_chat', null, 3],
      ['draft_activity', 'pick', 4],
      ['league_chat', null, 5],
      ['draft_activity', 'cutover', 6],
    ], 'up() re-derives the identical combined order');
    assert.equal(await counterOf(L.A), 6);
  });
}
