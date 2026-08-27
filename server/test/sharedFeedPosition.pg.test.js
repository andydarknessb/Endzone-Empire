/**
 * Disposable-Postgres test for the shared feed-position namespace (#471,
 * ADR 0012).
 *
 * League chat and Draft activity share ONE per-league chronological position
 * (ADR 0012), allocated from one counter but - before this ticket - enforced
 * only WITHIN each table by its own `(league_id, feed_seq)` unique index.
 * Nothing structural forbade a chat row and an activity row in one league from
 * holding the SAME position; PR #470 proved a real Postgres accepted exactly
 * that. Every claim here is about the DATABASE (a shared registry table, two
 * AFTER INSERT triggers, a counter high-water), and a matcher fake cannot
 * express any of them - the fast suites run no triggers - so it gets a real
 * Postgres.
 *
 * Claims, in the order #471's acceptance criteria list them:
 *
 * 1. CROSS-KIND REJECTION (AC1). With an activity row already at a position, a
 *    chat row EXPLICITLY claiming that same position is refused by the shared
 *    registry - the collision the per-table indexes let through before.
 * 2. ORDINARY CHRONOLOGY preserved (AC2). Ordinary chat and activity inserts
 *    still draw one contiguous per-league run, and each lands exactly one
 *    registry row labelled with its kind.
 * 3. EXPLICIT RESERVATION + COUNTER HIGH-WATER (AC4, AC5). An explicit chat
 *    position beyond the counter claims the namespace and advances the counter,
 *    so the next ordinary allocation continues PAST it and never reuses or sits
 *    behind it - which is also why an explicit chat position and a later
 *    activity allocation do not collide.
 * 4. CONCURRENCY (AC1). N concurrent inserts across BOTH kinds for one league
 *    take a unique, contiguous run and register N distinct positions.
 * 5. LEGACY RECONCILIATION (AC3). up() refuses to enforce over a feed where a
 *    position is already owned by both kinds, naming the collision.
 * 6. IDEMPOTENT BACKFILL + LOSSLESS ROLLBACK (AC3, AC6). Existing rows populate
 *    the registry, a rollback drops it, and the next up() re-derives exactly the
 *    same rows.
 *
 * Gated twice, exactly like leagueChatFeed.pg.test.js and draftActivity.pg.test.js:
 * SHARED_FEED_POSITION_PG_TESTS=1 (or the umbrella PG_TESTS=1) must be set, and
 * every DATABASE_URL* variable must be ABSENT, so a stray local run can never
 * touch the shared production database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { appendPickActivity } = require('../services/draftActivity');

const ENABLED = process.env.PG_TESTS === '1' || process.env.SHARED_FEED_POSITION_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('shared feed position PG tests (skipped: set PG_TESTS=1 or SHARED_FEED_POSITION_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('shared feed position PG tests refuse to run with DATABASE_URL* set', () => {
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

  const MIGRATION_NAME = '20260827000001_shared_feed_position_registry.js';
  const CHAT_KIND = 'league_chat';
  const ACTIVITY_KIND = 'draft_activity';

  let ownerA = null;
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
  // A live chat insert: names no feed_seq, so the chat trigger allocates it and
  // the registry trigger claims it.
  async function liveChat(leagueId, userId, message) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message")
       VALUES ($1, $2, $3) RETURNING "id", "feed_seq"`,
      [leagueId, userId, message]
    );
    return res.rows[0];
  }
  // An EXPLICIT chat insert at a named position: chat (unlike draft_activity)
  // leaves an explicitly-supplied feed_seq untouched. This is the writer PR #470
  // used to force the cross-kind collision, and the path #436 will use.
  function explicitChat(leagueId, userId, message, feedSeq) {
    return pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message", "feed_seq")
       VALUES ($1, $2, $3, $4) RETURNING "id", "feed_seq"`,
      [leagueId, userId, message, feedSeq]
    );
  }
  // A committed Pick through the real service against the disposable pool.
  function pickActivity(leagueId, team, round, pickNumber, auto = false) {
    return appendPickActivity(pool, {
      leagueId,
      team,
      player: { id: playerId, name: 'Pat Mahomes', position: 'QB', nfl_team: 'KC' },
      round,
      pickNumber,
      auto,
    });
  }
  async function counterOf(leagueId) {
    const res = await pool.query('SELECT "last_seq" FROM "league_feed_sequences" WHERE "league_id" = $1', [leagueId]);
    return res.rows[0] ? Number(res.rows[0].last_seq) : null;
  }
  async function registryOf(leagueId) {
    const res = await pool.query(
      `SELECT "feed_seq", "record_kind", "source_id"
         FROM "league_feed_positions" WHERE "league_id" = $1 ORDER BY "feed_seq"`,
      [leagueId]
    );
    return res.rows.map((r) => ({ seq: Number(r.feed_seq), kind: r.record_kind, sourceId: Number(r.source_id) }));
  }

  test.before(async () => {
    // In CI migration-smoke the schema is already at latest; locally this brings
    // a fresh database up to and including the registry migration.
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.latest();

    ownerA = await seedUser('shared_feed_pg_owner');
    playerId = await seedPlayer('Pat Mahomes', 'QB', 'KC');
  });

  test.after(async () => {
    // Leave the registry migration applied for the files that run after this one.
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.latest();
    if (playerId) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerId]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    await pool.end();
    await knex.destroy();
  });

  test('the shared registry rejects a cross-kind duplicate position in BOTH directions (AC1)', async () => {
    // Direction 1: an activity row owns the position, a chat writer collides.
    const l1 = await seedLeague('Shared Feed Cross A', ownerA, 'sharedfeedx1');
    const t1 = await seedTeam(l1, ownerA, 'Alpha');
    const a1 = await pickActivity(l1, { id: t1, name: 'Alpha' }, 1, 1);
    assert.equal(a1.seq, 1, 'the activity row took position 1');
    // A chat row EXPLICITLY claiming position 1 (chat permits explicit
    // positions; this is PR #470's writer) is refused by the shared registry.
    await assert.rejects(
      () => explicitChat(l1, ownerA, 'me too', 1),
      /duplicate key|unique|league_feed_positions/i,
      'the registry rejects a chat row at an activity-owned position'
    );
    const chatCount = await pool.query('SELECT count(*)::int AS n FROM "chat_messages" WHERE "league_id" = $1', [l1]);
    assert.equal(chatCount.rows[0].n, 0, 'the rejected chat insert left no row behind (atomic abort)');

    // Direction 2: a chat row owns the position, an ACTIVITY writer collides.
    // draft_activity's own tripwire (20260826000004) still refuses an EXPLICIT
    // activity feed_seq - lifting that is #436's job - so the realistic way an
    // activity WRITER lands on a taken position is a counter-allocated insert
    // after the counter is rewound behind a reserved position. That is exactly
    // what the registry must catch "regardless of writer", and here it does.
    const l2 = await seedLeague('Shared Feed Cross B', ownerA, 'sharedfeedx2');
    const t2 = await seedTeam(l2, ownerA, 'Alpha');
    const chat = await explicitChat(l2, ownerA, 'chat owns five', 5);
    assert.equal(Number(chat.rows[0].feed_seq), 5, 'the chat row owns position 5');
    // Rewind the counter behind the reserved position so the next allocation
    // collides on it (the shape of a lost high-water, which AC5 otherwise
    // prevents - forced here to prove the registry is the backstop).
    await pool.query('UPDATE "league_feed_sequences" SET "last_seq" = 4 WHERE "league_id" = $1', [l2]);
    await assert.rejects(
      () => pickActivity(l2, { id: t2, name: 'Alpha' }, 1, 1),
      /duplicate key|unique|league_feed_positions/i,
      'the registry rejects an activity allocation that lands on a chat-owned position'
    );
    const actCount = await pool.query('SELECT count(*)::int AS n FROM "draft_activity" WHERE "league_id" = $1', [l2]);
    assert.equal(actCount.rows[0].n, 0, 'the rejected activity insert left no row behind (atomic abort)');

    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [l1]);
    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [l2]);
  });

  test('ordinary chat and activity inserts keep one chronology and each registers once (AC2)', async () => {
    const league = await seedLeague('Shared Feed Ordinary', ownerA, 'sharedfeedo');
    const team = await seedTeam(league, ownerA, 'Alpha');

    const c1 = await liveChat(league, ownerA, 'good luck');
    const a2 = await pickActivity(league, { id: team, name: 'Alpha' }, 1, 1);
    const c3 = await liveChat(league, ownerA, 'nice');
    const a4 = await pickActivity(league, { id: team, name: 'Alpha' }, 1, 2, true);

    assert.deepEqual(
      [Number(c1.feed_seq), a2.seq, Number(c3.feed_seq), a4.seq],
      [1, 2, 3, 4],
      'chat and activity still draw one contiguous per-league run'
    );

    // The registry mirrors that run exactly: one row per record, each labelled.
    assert.deepEqual(await registryOf(league), [
      { seq: 1, kind: CHAT_KIND, sourceId: Number(c1.id) },
      { seq: 2, kind: ACTIVITY_KIND, sourceId: a2.id },
      { seq: 3, kind: CHAT_KIND, sourceId: Number(c3.id) },
      { seq: 4, kind: ACTIVITY_KIND, sourceId: a4.id },
    ]);
    assert.equal(await counterOf(league), 4, 'the counter tracks the shared high-water');

    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [league]);
  });

  test('an explicit position claims the namespace and advances the counter high-water (AC4, AC5)', async () => {
    const league = await seedLeague('Shared Feed Explicit', ownerA, 'sharedfeede');
    const team = await seedTeam(league, ownerA, 'Alpha');

    // Ordinary run to position 2.
    await liveChat(league, ownerA, 'one');
    await pickActivity(league, { id: team, name: 'Alpha' }, 1, 1);
    assert.equal(await counterOf(league), 2);

    // An explicit chat position well beyond the counter (the #436 legacy path).
    const jump = await explicitChat(league, ownerA, 'legacy at ten', 10);
    assert.equal(Number(jump.rows[0].feed_seq), 10);
    assert.equal(await counterOf(league), 10, 'the counter cannot remain behind a reserved position (AC5)');

    // The next ordinary allocation continues PAST the reserved position, so it is
    // never re-handed-out to either kind.
    const next = await pickActivity(league, { id: team, name: 'Alpha' }, 1, 2);
    assert.equal(next.seq, 11, 'the next allocation continues past the reserved position');

    // The reserved position is registered as chat, owned by that row.
    const reg = await registryOf(league);
    const ten = reg.find((r) => r.seq === 10);
    assert.deepEqual(ten, { seq: 10, kind: CHAT_KIND, sourceId: Number(jump.rows[0].id) });

    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [league]);
  });

  test('N concurrent inserts across both kinds take a unique, contiguous run (AC1 concurrency)', async () => {
    const league = await seedLeague('Shared Feed Concurrency', ownerA, 'sharedfeedc');
    const team = await seedTeam(league, ownerA, 'Alpha');

    const N = 12;
    const jobs = [];
    for (let i = 0; i < N; i += 1) {
      if (i % 2 === 0) jobs.push(liveChat(league, ownerA, `c${i}`));
      else jobs.push(pickActivity(league, { id: team, name: 'Alpha' }, 1, i));
    }
    const results = await Promise.all(jobs);
    const seqs = results
      .map((r) => Number(r.feed_seq !== undefined ? r.feed_seq : r.seq))
      .sort((a, b) => a - b);

    assert.deepEqual(seqs, Array.from({ length: N }, (_, i) => i + 1), 'a unique, contiguous run with no gap or collision');

    // The registry holds N distinct positions, one per insert, no duplicate.
    const reg = await registryOf(league);
    assert.equal(reg.length, N, 'every insert registered exactly one position');
    assert.equal(new Set(reg.map((r) => r.seq)).size, N, 'every registered position is distinct');

    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [league]);
  });

  test('up() refuses to enforce over a feed where a position is owned by both kinds (AC3)', async () => {
    // Build a pre-existing cross-kind collision while the registry is DOWN, then
    // prove up() names it and refuses rather than enforcing over it. The
    // collision is forced by rewinding the counter between two allocations - the
    // only way to make both kinds land on one position, since the guard the
    // registry front-runs (draft_activity's own explicit-position RAISE) is what
    // otherwise keeps them apart.
    await knex.migrate.down({ name: MIGRATION_NAME });
    const league = await seedLeague('Shared Feed Reconcile', ownerA, 'sharedfeedr');
    const team = await seedTeam(league, ownerA, 'Alpha');
    try {
      const c1 = await liveChat(league, ownerA, 'first');
      assert.equal(Number(c1.feed_seq), 1);
      // Rewind the counter so the next allocation collides on position 1.
      await pool.query('UPDATE "league_feed_sequences" SET "last_seq" = 0 WHERE "league_id" = $1', [league]);
      const a1 = await pickActivity(league, { id: team, name: 'Alpha' }, 1, 1);
      assert.equal(a1.seq, 1, 'the activity row also landed on position 1 (a genuine collision)');

      await assert.rejects(
        () => knex.migrate.up({ name: MIGRATION_NAME }),
        /reconcile|both a chat row and a draft_activity row|#471/i,
        'up() refuses to enforce over an unreconciled cross-kind collision'
      );
    } finally {
      // Remove the collision and restore the registry for the files after this.
      await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [league]);
      const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
      if (!applied) await knex.migrate.up({ name: MIGRATION_NAME });
    }
  });

  test('backfill is idempotent and rollback is lossless: down() then up() re-derives the registry (AC3, AC6)', async () => {
    const league = await seedLeague('Shared Feed Rollback', ownerA, 'sharedfeedb');
    const team = await seedTeam(league, ownerA, 'Alpha');
    await liveChat(league, ownerA, 'one');
    await pickActivity(league, { id: team, name: 'Alpha' }, 1, 1);
    await liveChat(league, ownerA, 'two');

    const before = await registryOf(league);
    assert.deepEqual(before.map((r) => [r.seq, r.kind]), [[1, CHAT_KIND], [2, ACTIVITY_KIND], [3, CHAT_KIND]]);

    // Roll the registry back (lossless: it mirrors rows the record tables keep)
    // and forward again; the backfill must reproduce exactly the same registry.
    await knex.migrate.down({ name: MIGRATION_NAME });
    const gone = await pool.query(`SELECT to_regclass('public.league_feed_positions') AS present`);
    assert.equal(gone.rows[0].present, null, 'down() dropped the registry table');

    await knex.migrate.up({ name: MIGRATION_NAME });
    const after = await registryOf(league);
    assert.deepEqual(after, before, 'up() re-derived the same registry rows from the record tables');
    assert.equal(await counterOf(league), 3, 'the counter high-water is re-seeded from the registry');

    await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [league]);
  });
}
