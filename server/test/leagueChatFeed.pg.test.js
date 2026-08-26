/**
 * Disposable-Postgres test for the League chat feed sequence (#434, ADR 0012).
 *
 * Everything here is a claim about the DATABASE, and a matcher fake cannot
 * express any of them: the fast suites do not run triggers or window-function
 * backfills, so a mocked "the seq was allocated" only proves the fixture said
 * so. The per-league sequence is the whole mechanism this ticket rests on, so
 * it gets a real Postgres.
 *
 * Claims, in the order the feature is built:
 *
 * 1. BACKFILL numbers each league's legacy messages 1..N by (created_at, id) -
 *    a total order even when two messages share an instant - and seeds the
 *    counter to each league's high-water mark. Two leagues are independent.
 * 2. The TRIGGER continues each league's run on a plain insert that names no
 *    feed_seq (an old deploy's insert during a rollout), monotonically and
 *    per league, with no gap and no collision.
 * 3. The unique (league_id, feed_seq) index REJECTS a second row that claims a
 *    position already handed out.
 * 4. listLeagueChatFeed reads the latest page oldest-first and pages older by a
 *    feed_seq cursor.
 * 5. A DELETE (what retention and account deletion do) leaves the feed with a
 *    GAP at the removed position rather than a renumbered run or a retained
 *    copy, and the counter does not reuse the freed value.
 *
 * Gated twice, exactly like rosterTenures.pg.test.js: LEAGUE_CHAT_FEED_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable
 * must be ABSENT, so a stray local run can never touch the shared production
 * database. Seeds and deletes its own leagues and users, colliding with no
 * other suite's data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listLeagueChatFeed } = require('../services/leagueFeed');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEAGUE_CHAT_FEED_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('league chat feed PG tests (skipped: set PG_TESTS=1 or LEAGUE_CHAT_FEED_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('league chat feed PG tests refuse to run with DATABASE_URL* set', () => {
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

  const MIGRATION_NAME = '20260826000001_league_chat_feed_sequence.js';

  // Two shared timestamps: TIE is used twice in league A so the (created_at, id)
  // tiebreak is actually exercised, not assumed.
  const T1 = '2026-09-01T00:00:00.000Z';
  const TIE = '2026-09-01T00:05:00.000Z';
  const T3 = '2026-09-01T00:10:00.000Z';

  let leagueA = null;
  let leagueB = null;
  let ownerA = null;
  let ownerB = null;
  // League A's legacy message ids in insertion order (a, tie1, tie2, c).
  const legacyA = [];
  let legacyB = null;

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
    await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, $3)`,
      [leagueId, ownerId, name]
    );
  }

  // A legacy insert: while the migration is DOWN the feed_seq column does not
  // exist, so this is a plain (league_id, user_id, message, created_at) row -
  // exactly the pre-#434 shape the backfill must number.
  async function seedLegacyChat(leagueId, userId, message, createdAt) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message", "created_at")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [leagueId, userId, message, createdAt]
    );
    return res.rows[0].id;
  }

  // A live insert AFTER the migration: names no feed_seq, so the trigger
  // allocates it, and RETURNING hands the position straight back (the socket
  // path).
  async function liveChat(leagueId, userId, message) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message")
       VALUES ($1, $2, $3) RETURNING "id", "feed_seq"`,
      [leagueId, userId, message]
    );
    return res.rows[0];
  }

  async function seqOf(id) {
    const res = await pool.query('SELECT "feed_seq" FROM "chat_messages" WHERE "id" = $1', [id]);
    return res.rows[0] ? Number(res.rows[0].feed_seq) : null;
  }

  async function counterOf(leagueId) {
    const res = await pool.query('SELECT "last_seq" FROM "league_feed_sequences" WHERE "league_id" = $1', [leagueId]);
    return res.rows[0] ? Number(res.rows[0].last_seq) : null;
  }

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (applied) await knex.migrate.down({ name: MIGRATION_NAME });

    ownerA = await seedUser('chat_feed_pg_a');
    ownerB = await seedUser('chat_feed_pg_b');
    leagueA = await seedLeague('Chat Feed PG A', ownerA, 'chatfeedpga');
    leagueB = await seedLeague('Chat Feed PG B', ownerB, 'chatfeedpgb');
    await seedTeam(leagueA, ownerA, 'Alpha');
    await seedTeam(leagueB, ownerB, 'Bravo');

    // League A: four legacy messages, two sharing TIE so the id tiebreak runs.
    legacyA.push(await seedLegacyChat(leagueA, ownerA, 'a-first', T1));
    legacyA.push(await seedLegacyChat(leagueA, ownerA, 'a-tie-1', TIE));
    legacyA.push(await seedLegacyChat(leagueA, ownerA, 'a-tie-2', TIE));
    legacyA.push(await seedLegacyChat(leagueA, ownerA, 'a-third', T3));
    // League B: one legacy message, to prove the counter is per league.
    legacyB = await seedLegacyChat(leagueB, ownerB, 'b-only', T1);

    await knex.migrate.up({ name: MIGRATION_NAME });
  });

  test.after(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.up({ name: MIGRATION_NAME });
    if (leagueA) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueA]);
    if (leagueB) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueB]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    if (ownerB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB]);
    await pool.end();
    await knex.destroy();
  });

  test('backfill numbers each league 1..N by (created_at, id), tie broken by id', async () => {
    // Insertion order is id order, so the two TIE rows resolve to 2 then 3.
    assert.deepEqual(
      await Promise.all(legacyA.map(seqOf)),
      [1, 2, 3, 4],
      'league A legacy rows are numbered in (created_at, id) order'
    );
    assert.equal(await seqOf(legacyB), 1, 'league B is numbered independently');
    assert.equal(await counterOf(leagueA), 4, 'league A counter seeded to its high-water mark');
    assert.equal(await counterOf(leagueB), 1, 'league B counter seeded to its high-water mark');
  });

  test('the trigger continues each league monotonically and independently', async () => {
    const a5 = await liveChat(leagueA, ownerA, 'a-live-5');
    assert.equal(Number(a5.feed_seq), 5, 'league A continues past its backfilled max');
    assert.equal(await counterOf(leagueA), 5);

    const b2 = await liveChat(leagueB, ownerB, 'b-live-2');
    assert.equal(Number(b2.feed_seq), 2, 'league B advances on its own counter, not A');
    assert.equal(await counterOf(leagueB), 2);

    const a6 = await liveChat(leagueA, ownerA, 'a-live-6');
    assert.equal(Number(a6.feed_seq), 6);
  });

  test('the unique (league_id, feed_seq) index rejects a duplicate position', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO "chat_messages" ("league_id", "user_id", "message", "feed_seq")
         VALUES ($1, $2, 'dupe', 1)`,
        [leagueA, ownerA]
      ),
      /duplicate key|unique/i,
      'a second row at an already-issued position is refused'
    );
  });

  test('listLeagueChatFeed reads oldest-first and pages older by a feed_seq cursor', async () => {
    // League A now holds seq 1..6. The latest page is all of them, ascending.
    const latest = await listLeagueChatFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    assert.deepEqual(latest.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
    for (const entry of latest) {
      assert.equal(entry.type, 'league_chat');
      assert.equal(typeof entry.seq, 'number');
    }

    // A small page from the top, then the page just older than its lowest seq.
    const head = await listLeagueChatFeed(pool, { leagueId: leagueA, viewerId: ownerA, limit: 2 });
    assert.deepEqual(head.map((e) => e.seq), [5, 6], 'a bounded latest page is still oldest-first');
    const older = await listLeagueChatFeed(pool, { leagueId: leagueA, viewerId: ownerA, before: head[0].seq, limit: 2 });
    assert.deepEqual(older.map((e) => e.seq), [3, 4], 'before=<seq> returns the page just older');
  });

  test('a deleted message leaves a gap, not a renumber or a retained copy', async () => {
    // Retention and account deletion both hard-delete chat_messages rows.
    // Delete seq 3 (a tie row) and confirm the feed simply skips it.
    await pool.query('DELETE FROM "chat_messages" WHERE "id" = $1', [legacyA[2]]);

    const feed = await listLeagueChatFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    assert.deepEqual(feed.map((e) => e.seq), [1, 2, 4, 5, 6], 'seq 3 is a gap; nothing renumbered');
    assert.equal(
      feed.some((e) => e.message === 'a-tie-2'),
      false,
      'the removed content is gone, not retained as a copy'
    );
    // The freed position is never reused: the next insert continues past 6.
    const next = await liveChat(leagueA, ownerA, 'a-live-7');
    assert.equal(Number(next.feed_seq), 7);
    assert.equal(await counterOf(leagueA), 7);
  });
}
