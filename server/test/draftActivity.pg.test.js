/**
 * Disposable-Postgres test for the Draft-activity feed (#435, ADR 0012).
 *
 * Every claim here is about the DATABASE, and a matcher fake cannot express any
 * of them: the fast suites do not run triggers, and the whole point of #435 is
 * that Draft activity and League chat SHARE one per-league sequence a real
 * Postgres allocates. So it gets a real Postgres.
 *
 * Claims, in build order:
 *
 * 1. SHARED SEQUENCE. A chat insert and an appendPickActivity insert for one
 *    league draw from the SAME `league_feed_sequences` counter, so their
 *    positions interleave into one contiguous run (chat 1, pick 2, chat 3,
 *    pick 4), and a second league's run is independent.
 * 2. COMBINED READ. listCombinedDraftFeed interleaves both kinds by feed_seq,
 *    oldest-first, shaping each by type, and pages older by a feed_seq cursor.
 *    A Pick entry carries the snapshotted Team, player, position, NFL team,
 *    round, overall Pick number and its autopick flag (#435 AC2, AC3).
 * 3. BLOCKING. A blocked author's CHAT drops from a viewer's combined read, but
 *    that author's authoritative Draft ACTIVITY stays visible (user story 83).
 * 4. OWN-TABLE GUARD (#471). The allocator RAISES on an explicitly-supplied
 *    feed_seq, so draft_activity positions are always counter-allocated - an
 *    enforced per-table invariant. This is NOT the cross-table enforcement of
 *    #471 (chat can still explicit-write); it is the tripwire that makes #436
 *    lift the guard deliberately rather than introduce an explicit position by
 *    accident.
 * 5. CONCURRENCY. N concurrent inserts across BOTH kinds for one league take a
 *    unique, contiguous run - the counter row lock serializing them is the real
 *    mechanism behind the deterministic order (#435 AC4).
 * 6. GUARDED ROLLBACK. down() refuses while the table holds rows (ADR 0012's
 *    append-only history), and the table survives the refusal.
 *
 * Gated twice, exactly like leagueChatFeed.pg.test.js: DRAFT_ACTIVITY_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable
 * must be ABSENT, so a stray local run can never touch shared production.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  appendPickActivity,
  appendLifecycleActivity,
  DRAFT_ACTIVITY,
  PICK,
  DRAFT_START,
  PAUSE,
  RESET,
  COMPLETE,
} = require('../services/draftActivity');
const { listCombinedDraftFeed, LEAGUE_CHAT } = require('../services/leagueFeed');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_ACTIVITY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft activity PG tests (skipped: set PG_TESTS=1 or DRAFT_ACTIVITY_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft activity PG tests refuse to run with DATABASE_URL* set', () => {
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
  const pool = new pg.Pool({ ...connection, max: 2 });
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });

  const MIGRATION_NAME = '20260826000004_draft_activity.js';
  const migration = require('../db/migrations/20260826000004_draft_activity');
  // #437 relaxes the Pick columns to NULL for lifecycle kinds and adds the
  // pick-fields CHECK. Applied here for a standalone run; the CI migration-smoke
  // has already run every migration to latest before this suite.
  const LIFECYCLE_MIGRATION_NAME = '20260826000006_draft_activity_lifecycle.js';

  let leagueA = null;
  let leagueB = null;
  let ownerA = null;
  let ownerB = null;
  let teamA = null;
  let teamB = null;
  let playerId = null;

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
  async function seedPlayer(name, position, nflTeam) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, $2, $3) RETURNING "id"`,
      [name, position, nflTeam]
    );
    return res.rows[0].id;
  }
  // A live chat insert: names no feed_seq, so the trigger allocates it.
  async function liveChat(leagueId, userId, message) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message")
       VALUES ($1, $2, $3) RETURNING "id", "feed_seq"`,
      [leagueId, userId, message]
    );
    return res.rows[0];
  }
  // A pick activity through the real service against the disposable pool.
  function pickActivity(leagueId, team, player, round, pickNumber, auto = false) {
    return appendPickActivity(pool, { leagueId, team, player, round, pickNumber, auto });
  }

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.up({ name: MIGRATION_NAME });
    const appliedLifecycle = await knex('knex_migrations').where({ name: LIFECYCLE_MIGRATION_NAME }).first();
    if (!appliedLifecycle) await knex.migrate.up({ name: LIFECYCLE_MIGRATION_NAME });

    ownerA = await seedUser('draft_activity_pg_a');
    ownerB = await seedUser('draft_activity_pg_b');
    leagueA = await seedLeague('Draft Activity PG A', ownerA, 'draftactpga');
    leagueB = await seedLeague('Draft Activity PG B', ownerB, 'draftactpgb');
    teamA = await seedTeam(leagueA, ownerA, 'Alpha');
    teamB = await seedTeam(leagueA, ownerB, 'Bravo');
    playerId = await seedPlayer('Pat Mahomes', 'QB', 'KC');
  });

  test.after(async () => {
    // CASCADE from leagues removes chat_messages and draft_activity rows, so the
    // append-only guard sees an empty table when migration-smoke rolls back.
    if (leagueA) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueA]);
    if (leagueB) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueB]);
    if (playerId) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerId]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    if (ownerB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB]);
    await pool.end();
    await knex.destroy();
  });

  test('chat and Pick activity share one per-league sequence and interleave', async () => {
    const c1 = await liveChat(leagueA, ownerA, 'good luck');
    const a1 = await pickActivity(leagueA, { id: teamA, name: 'Alpha' }, { id: playerId, name: 'Pat Mahomes', position: 'QB', nfl_team: 'KC' }, 1, 1, false);
    const c2 = await liveChat(leagueA, ownerB, 'lets go');
    const a2 = await pickActivity(leagueA, { id: teamB, name: 'Bravo' }, { id: playerId, name: 'Pat Mahomes', position: 'QB', nfl_team: 'KC' }, 1, 2, true);

    // One contiguous run across BOTH tables, allocated in insert order.
    assert.deepEqual(
      [Number(c1.feed_seq), a1.seq, Number(c2.feed_seq), a2.seq],
      [1, 2, 3, 4],
      'a chat and an activity insert draw from the same per-league counter'
    );

    // League B's run is independent: its first entry is seq 1, not 5.
    const b1 = await liveChat(leagueB, ownerB, 'other league');
    assert.equal(Number(b1.feed_seq), 1, 'the counter is per league');
  });

  test('combined read interleaves both kinds oldest-first and snapshots the Pick', async () => {
    const feed = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    assert.deepEqual(feed.map((e) => e.seq), [1, 2, 3, 4], 'ordered by the shared feed_seq');
    assert.deepEqual(feed.map((e) => e.type), [LEAGUE_CHAT, DRAFT_ACTIVITY, LEAGUE_CHAT, DRAFT_ACTIVITY]);

    const pick = feed[1];
    assert.equal(pick.kind, PICK);
    assert.equal(pick.teamId, teamA);
    assert.equal(pick.teamName, 'Alpha');
    assert.deepEqual(pick.player, { id: playerId, name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC' });
    assert.equal(pick.round, 1);
    assert.equal(pick.pickNumber, 1);
    assert.equal(pick.isAutopick, false);
    assert.ok(pick.created_at, 'the event carries its own timestamp');

    // The autopick was labeled only because the write said so (#435 AC3).
    assert.equal(feed[3].isAutopick, true);
  });

  test('the combined read pages older entries by a feed_seq cursor', async () => {
    const older = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA, before: 3 });
    assert.deepEqual(older.map((e) => e.seq), [1, 2], 'before=3 returns the two entries just older than seq 3');
  });

  test('blocking hides the blocked author chat but keeps their Draft activity', async () => {
    // ownerA blocks ownerB. B authored chat seq 3 and pick activity seq 4.
    await pool.query(
      `INSERT INTO "user_blocks" ("blocker_id", "blocked_id") VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ownerA, ownerB]
    );
    const feed = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    const seqs = feed.map((e) => e.seq);
    assert.ok(!seqs.includes(3), 'the blocked author\'s chat is hidden');
    assert.ok(seqs.includes(4), 'the blocked author\'s authoritative Draft activity stays visible');
    // Cleanup so the block does not leak into later assertions.
    await pool.query('DELETE FROM "user_blocks" WHERE "blocker_id" = $1 AND "blocked_id" = $2', [ownerA, ownerB]);
  });

  test('the allocator refuses an explicitly-supplied feed_seq (own-table guard, #471)', async () => {
    // An explicit feed_seq is refused outright by fn_allocate_draft_activity_feed_seq,
    // so draft_activity positions are ALWAYS counter-allocated - an enforced
    // per-table invariant, not a convention the caller is trusted to keep.
    //
    // This guard is NOT the cross-table enforcement of #471: chat still has its
    // own index and could hold the same position; the counter is what keeps the
    // two apart in practice. The guard's job is to make #436 lift it DELIBERATELY
    // (and confront #471) rather than introduce an explicit position by accident.
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO "draft_activity"
             ("league_id", "kind", "team_id", "team_name", "player_name", "round", "pick_number", "feed_seq")
           VALUES ($1, 'pick', $2, 'Alpha', 'Dup', 1, 9, 1)`,
          [leagueA, teamA]
        ),
      /must not be supplied explicitly|trigger-allocated|#471/i,
      'an explicit feed_seq claim is refused by the guard, whatever value it names'
    );
  });

  test('concurrent chat and activity inserts draw a unique, contiguous per-league run', async () => {
    // The real mechanism behind AC4: the counter row lock serializes concurrent
    // inserts across BOTH tables, so N inserts fired at once still take positions
    // that are unique and gap-free. Uses league B, whose only prior entry is the
    // single 'other league' chat at seq 1, so the new run is a clean 2..N+1.
    const before = await pool.query(
      `SELECT COALESCE(MAX("last_seq"), 0)::int AS last FROM "league_feed_sequences" WHERE "league_id" = $1`,
      [leagueB]
    );
    const start = before.rows[0].last;

    const N = 12;
    const jobs = [];
    for (let i = 0; i < N; i += 1) {
      // Alternate the two kinds so the serialization is genuinely cross-table.
      if (i % 2 === 0) {
        jobs.push(liveChat(leagueB, ownerB, `c${i}`));
      } else {
        jobs.push(
          pickActivity(
            leagueB,
            { id: teamB, name: 'Bravo' },
            { id: playerId, name: 'Pat Mahomes', position: 'QB', nfl_team: 'KC' },
            1,
            i,
            false
          )
        );
      }
    }
    const results = await Promise.all(jobs);
    const seqs = results
      .map((r) => Number(r.feed_seq !== undefined ? r.feed_seq : r.seq))
      .sort((a, b) => a - b);

    const expected = Array.from({ length: N }, (_, i) => start + 1 + i);
    assert.deepEqual(seqs, expected, 'N concurrent inserts took a unique, contiguous run with no gap or collision');
    assert.equal(new Set(seqs).size, N, 'every allocated position is distinct');
  });

  test('lifecycle activity shares the sequence, interleaves, and reads back with no Pick facts (#437)', async () => {
    // leagueA has reached seq 4 (chat/pick/chat/pick); the guard and concurrency
    // tests consumed no leagueA positions, so lifecycle draws 5, 6, 7 next.
    const start = await appendLifecycleActivity(pool, { leagueId: leagueA, kind: DRAFT_START, team: { id: teamA, name: 'Alpha' } });
    const pause = await appendLifecycleActivity(pool, { leagueId: leagueA, kind: PAUSE, team: { id: teamA, name: 'Alpha' } });
    const complete = await appendLifecycleActivity(pool, { leagueId: leagueA, kind: COMPLETE, team: null });
    assert.deepEqual([start.seq, pause.seq, complete.seq], [5, 6, 7], 'lifecycle draws from the same per-league counter as chat and Picks');

    const feed = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    const tail = feed.slice(-3);
    assert.deepEqual(tail.map((e) => e.kind), [DRAFT_START, PAUSE, COMPLETE], 'lifecycle events interleave in shared-seq order');
    for (const e of tail) {
      assert.equal(e.type, DRAFT_ACTIVITY);
      // A lifecycle entry is not a Pick: it carries none of the Pick facts.
      assert.equal('player' in e, false);
      assert.equal('round' in e, false);
      assert.equal('pickNumber' in e, false);
      assert.ok(e.created_at, 'the event carries its own timestamp');
    }
    assert.equal(tail[0].teamName, 'Alpha', 'the start is attributed to its acting Team');
    assert.equal(tail[2].teamId, null, 'the completion is an actor-less transition');
    assert.equal(tail[2].teamName, null);
  });

  test('the pick-fields CHECK still requires a Pick to carry its snapshot, but frees lifecycle kinds', async () => {
    // A 'pick' row missing its player is refused: the invariant #435 relied on,
    // now stated as "for a pick" after the columns were relaxed for lifecycle.
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO "draft_activity" ("league_id", "kind", "team_id", "team_name", "round", "pick_number")
           VALUES ($1, 'pick', $2, 'Alpha', 1, 9)`,
          [leagueA, teamA]
        ),
      /pick_fields_present|check constraint/i,
      'a Pick with a null player is refused by the CHECK'
    );
    // A lifecycle row with null player / round / pick_number is allowed.
    const ok = await appendLifecycleActivity(pool, { leagueId: leagueA, kind: RESET, team: { id: teamA, name: 'Alpha' } });
    assert.ok(ok.seq > 0, 'a lifecycle kind may carry null Pick columns');
  });

  test('deleting draft_picks leaves append-only Draft activity intact (reset semantics, #437 AC3)', async () => {
    // A real Pick row to delete, so this proves there is NO cascade from
    // draft_picks to draft_activity, not merely that the delete found nothing.
    await pool.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number") VALUES ($1, $2, $3, 99)`,
      [leagueA, teamA, playerId]
    );
    const before = await pool.query(`SELECT COUNT(*)::int AS n FROM "draft_activity" WHERE "league_id" = $1`, [leagueA]);
    await pool.query(`DELETE FROM "draft_picks" WHERE "league_id" = $1`, [leagueA]);
    const after = await pool.query(`SELECT COUNT(*)::int AS n FROM "draft_activity" WHERE "league_id" = $1`, [leagueA]);
    assert.ok(before.rows[0].n > 0, 'the league has append-only activity to preserve');
    assert.equal(after.rows[0].n, before.rows[0].n, 'wiping picks never erases earlier Pick or lifecycle activity');
  });

  test('down() refuses to drop the table while it holds append-only history', async () => {
    await assert.rejects(() => migration.down(knex), /append-only|refusing/i);
    // The refusal happened BEFORE any drop: the table is still there.
    const still = await pool.query(
      `SELECT to_regclass('public.draft_activity') AS present`
    );
    assert.ok(still.rows[0].present, 'the table survives the refused rollback');
  });
}
