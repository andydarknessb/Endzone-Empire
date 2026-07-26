const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'chat-unread-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const authed = () => `Bearer ${signToken({ id: 9, username: 'member' })}`;

test('GET chat/unread counts others\' unseen messages with blocked-user parity', async (t) => {
  let unreadSql = null;
  let unreadParams = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [{ 1: 1 }] };
    if (text.includes('COUNT(*)::int AS "unread"')) {
      unreadSql = text;
      unreadParams = params;
      return { rows: [{ unread: 4 }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .get('/api/league/12/chat/unread')
    .set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { unread: 4 });
  assert.deepEqual(unreadParams, [12, 9]);
  // Own messages never count, the read marker gates the window (a user with
  // no marker counts everything), and blocked users are filtered exactly
  // like the history endpoint.
  assert.match(unreadSql, /"chat_messages"\."user_id" <> \$2/);
  assert.match(unreadSql, /COALESCE\(\s*\(SELECT "last_read_at" FROM "chat_reads"/);
  assert.match(unreadSql, /to_timestamp\(0\)/);
  assert.match(unreadSql, /NOT EXISTS \(\s*SELECT 1 FROM "user_blocks"/);
});

test('GET chat/unread is members-only', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .get('/api/league/12/chat/unread')
    .set('Authorization', authed());
  assert.equal(res.status, 403);
});

test('POST chat/read upserts the caller\'s marker to now', async (t) => {
  let readSql = null;
  let readParams = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [{ 1: 1 }] };
    if (text.includes('INSERT INTO "chat_reads"')) {
      readSql = text;
      readParams = params;
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .post('/api/league/12/chat/read')
    .set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(readParams, [12, 9]);
  assert.match(readSql, /ON CONFLICT \("league_id", "user_id"\) DO UPDATE SET "last_read_at" = now\(\)/);
});

test('POST chat/read is members-only', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .post('/api/league/12/chat/read')
    .set('Authorization', authed());
  assert.equal(res.status, 403);
});

test('chat unread/read reject a non-integer league id', async () => {
  const unread = await request(app)
    .get('/api/league/abc/chat/unread')
    .set('Authorization', authed());
  assert.equal(unread.status, 400);

  const read = await request(app)
    .post('/api/league/abc/chat/read')
    .set('Authorization', authed());
  assert.equal(read.status, 400);
});
