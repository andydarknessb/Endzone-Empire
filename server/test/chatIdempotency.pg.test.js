/**
 * Disposable-Postgres test for the chat idempotency key (#440, migration
 * 20260826000003).
 *
 * The fast socket suite (chatSend.test.js) proves the HANDLER branches
 * correctly on a duplicate, but it does so against a matcher fake that cannot
 * run a real ON CONFLICT or a partial unique index - it plays back whatever the
 * fixture says. The guarantee AC2 rests on ("idempotency keys prevent duplicate
 * text ... sends during retry or reconnect") is a property of the DATABASE, so
 * it gets a real Postgres here:
 *
 * 1. A second insert of the same (user_id, client_msg_id) via the exact handler
 *    statement returns NO row (ON CONFLICT DO NOTHING), and the table still
 *    holds exactly one row for that key - a retry cannot duplicate.
 * 2. A different key from the same author inserts a second row.
 * 3. The index is PARTIAL: two rows with a NULL client_msg_id both insert (a
 *    legacy client, or one that sends no key, is unconstrained).
 * 4. The same key from a DIFFERENT author is not a conflict (uniqueness is per
 *    author).
 *
 * Gated exactly like leagueChatFeed.pg.test.js: CHAT_IDEMPOTENCY_PG_TESTS=1 (or
 * the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must be
 * ABSENT, so a stray local run can never touch the shared production database.
 * Seeds and deletes its own league and users.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.CHAT_IDEMPOTENCY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

// The exact statement the socket handler issues (draftSocket.js chat:send).
const IDEMPOTENT_INSERT = `INSERT INTO "chat_messages" ("league_id", "user_id", "message", "client_msg_id")
   VALUES ($1, $2, $3, $4)
   ON CONFLICT ("user_id", "client_msg_id") WHERE "client_msg_id" IS NOT NULL DO NOTHING
   RETURNING "id", "created_at", "feed_seq"`;

const MIGRATION_NAME = '20260826000003_chat_client_msg_id.js';

if (!ENABLED) {
  test('chat idempotency PG tests (skipped: set PG_TESTS=1 or CHAT_IDEMPOTENCY_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('chat idempotency PG tests refuse to run with DATABASE_URL* set', () => {
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

  let leagueId = null;
  let authorA = null;
  let authorB = null;

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    return res.rows[0].id;
  }

  async function rowCountForKey(userId, key) {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS "n" FROM "chat_messages" WHERE "user_id" = $1 AND "client_msg_id" = $2`,
      [userId, key]
    );
    return res.rows[0].n;
  }

  test.before(async () => {
    // Ensure the idempotency migration is applied on this disposable database.
    // In CI's migration-smoke the schema is already at latest, so this is a
    // no-op; locally it brings a fresh database up to it.
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.latest();

    authorA = await seedUser('chat_idem_pg_a');
    authorB = await seedUser('chat_idem_pg_b');
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code")
       VALUES ('Chat Idempotency PG', $1, 'chatidempg') RETURNING "id"`,
      [authorA]
    );
    leagueId = res.rows[0].id;
    await pool.query(`INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Alpha')`, [leagueId, authorA]);
    await pool.query(`INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Bravo')`, [leagueId, authorB]);
  });

  test.after(async () => {
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (authorA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [authorA]);
    if (authorB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [authorB]);
    await pool.end();
    await knex.destroy();
  });

  test('a retry with the same (author, key) inserts once; the second returns no row', async () => {
    const key = 'retry-key-1';
    const first = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'hello', key]);
    assert.equal(first.rows.length, 1, 'the first send inserts and returns its row');

    const retry = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'hello (retry)', key]);
    assert.equal(retry.rows.length, 0, 'ON CONFLICT DO NOTHING: the retry inserts nothing');
    assert.equal(await rowCountForKey(authorA, key), 1, 'exactly one stored row for the key');
  });

  test('a different key from the same author inserts a second row', async () => {
    const a = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'one', 'distinct-a']);
    const b = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'two', 'distinct-b']);
    assert.equal(a.rows.length, 1);
    assert.equal(b.rows.length, 1);
    assert.notEqual(a.rows[0].id, b.rows[0].id);
  });

  test('the partial index leaves NULL keys unconstrained: two null-key rows both insert', async () => {
    const a = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'no key 1', null]);
    const b = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'no key 2', null]);
    assert.equal(a.rows.length, 1, 'a null-key send always inserts');
    assert.equal(b.rows.length, 1, 'a second null-key send is not a duplicate of the first');
    assert.notEqual(a.rows[0].id, b.rows[0].id);
  });

  test('uniqueness is per author: the same key from another author is not a conflict', async () => {
    const key = 'shared-uuid';
    const a = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorA, 'mine', key]);
    const b = await pool.query(IDEMPOTENT_INSERT, [leagueId, authorB, 'also mine', key]);
    assert.equal(a.rows.length, 1);
    assert.equal(b.rows.length, 1, 'a different author with the same key still inserts');
    assert.notEqual(a.rows[0].id, b.rows[0].id);
  });
}
