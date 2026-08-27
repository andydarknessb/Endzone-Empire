/**
 * Disposable-Postgres test for the GIF-message content shape (#446, migration
 * 20260827000021).
 *
 * The migration RELAXES chat_messages.message to nullable so a captionless GIF
 * can exist, and RESTORES the text guarantee that relax removed with a CHECK:
 * a 'text' row must have a non-null message and no gif columns, a 'gif' row must
 * carry all three of gif_provider / gif_asset_id / gif_description and may have
 * a null caption. That CHECK is the ONLY thing keeping a text row from silently
 * losing its NOT NULL, so it gets a real Postgres here in BOTH directions:
 *
 * 1. A text row with a NULL message is REJECTED (the guarantee is load-bearing,
 *    not decorative) - a check_violation, code 23514.
 * 2. A gif row with all three gif fields and a NULL caption is ACCEPTED.
 * 3. A gif row missing a required gif field (null description) is REJECTED.
 * 4. A text row that also carries a gif column is REJECTED (the two shapes are
 *    mutually exclusive).
 *
 * Gated exactly like chatIdempotency.pg.test.js: PG_TESTS=1 (or the specific
 * CHAT_GIF_MESSAGE_PG_TESTS=1) must be set, and every DATABASE_URL* variable
 * must be ABSENT, so a stray local run can never touch the shared production
 * database. Seeds and deletes its own league and user.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.CHAT_GIF_MESSAGE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

const MIGRATION_NAME = '20260827000021_chat_gif_message.js';
const CHECK_VIOLATION = '23514';

if (!ENABLED) {
  test('chat GIF-message PG tests (skipped: set PG_TESTS=1 or CHAT_GIF_MESSAGE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('chat GIF-message PG tests refuse to run with DATABASE_URL* set', () => {
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
  let userId = null;

  // Insert one chat_messages row with an explicit content shape, returning the
  // row (or throwing on the CHECK). Column set kept minimal; feed_seq is
  // trigger-allocated so it is not supplied.
  async function insertShape({ message, contentKind, provider = null, assetId = null, description = null }) {
    return pool.query(
      `INSERT INTO "chat_messages"
         ("league_id", "user_id", "message", "content_kind",
          "gif_provider", "gif_asset_id", "gif_description")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING "id"`,
      [leagueId, userId, message, contentKind, provider, assetId, description]
    );
  }

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.latest();

    const u = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('chat_gif_pg', 'chat_gif_pg@example.invalid', 'x') RETURNING "id"`
    );
    userId = u.rows[0].id;
    const l = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code")
       VALUES ('Chat GIF PG', $1, 'chatgifpg') RETURNING "id"`,
      [userId]
    );
    leagueId = l.rows[0].id;
    await pool.query(`INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Alpha')`, [leagueId, userId]);
  });

  test.after(async () => {
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (userId) await pool.query('DELETE FROM "users" WHERE "id" = $1', [userId]);
    await pool.end();
    await knex.destroy();
  });

  test('a text row with a NULL message is REJECTED: the CHECK restores the guarantee the relax removed', async () => {
    await assert.rejects(
      () => insertShape({ message: null, contentKind: 'text' }),
      (err) => {
        assert.equal(err.code, CHECK_VIOLATION, `expected a check_violation, got ${err.code}: ${err.message}`);
        return true;
      }
    );
  });

  test('a gif row with all three gif fields and a NULL caption is ACCEPTED (a captionless GIF, AC1)', async () => {
    const res = await insertShape({
      message: null,
      contentKind: 'gif',
      provider: 'fake',
      assetId: 'abc123',
      description: 'a cat knocking a cup off a table',
    });
    assert.equal(res.rows.length, 1, 'a well-formed captionless gif row inserts');
  });

  test('a gif row missing its required description is REJECTED', async () => {
    await assert.rejects(
      () => insertShape({ message: 'caption', contentKind: 'gif', provider: 'fake', assetId: 'abc123', description: null }),
      (err) => {
        assert.equal(err.code, CHECK_VIOLATION);
        return true;
      }
    );
  });

  test('a text row that also carries a gif column is REJECTED (the two shapes are mutually exclusive)', async () => {
    await assert.rejects(
      () => insertShape({ message: 'hi', contentKind: 'text', assetId: 'abc123' }),
      (err) => {
        assert.equal(err.code, CHECK_VIOLATION);
        return true;
      }
    );
  });
}
