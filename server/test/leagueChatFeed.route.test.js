const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-chat-feed-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const authed = () => `Bearer ${signToken({ id: 9, username: 'member' })}`;

// The feed SELECT the route runs, captured so a test can assert the cursor and
// page it built. Membership is answered true; the block-filtered feed read
// returns one typed-shape row carrying feed_seq.
function mockFeed(t) {
  const captured = { sql: null, params: null };
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [{ 1: 1 }] };
    if (text.includes('FROM "chat_messages"')) {
      captured.sql = text;
      captured.params = params;
      return {
        rows: [{
          id: 5,
          message: 'good luck everyone',
          created_at: '2026-09-01T00:00:00.000Z',
          feed_seq: 7,
          teamId: 12,
          teamName: 'Sunday Scaries',
        }],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  return captured;
}

test('GET chat returns the latest 100 typed entries, oldest-first', async (t) => {
  const captured = mockFeed(t);
  const res = await request(app).get('/api/league/12/chat').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.deepEqual(res.body[0], {
    type: 'league_chat',
    id: 5,
    seq: 7,
    teamId: 12,
    teamName: 'Sunday Scaries',
    message: 'good luck everyone',
    hidden: false,
    created_at: '2026-09-01T00:00:00.000Z',
  });
  // Latest page: limit 100, no cursor predicate.
  assert.deepEqual(captured.params, [12, 9, 100]);
  assert.doesNotMatch(captured.sql, /"feed_seq" < \$/);
});

test('GET chat?before=<seq> pages older than the cursor', async (t) => {
  const captured = mockFeed(t);
  const res = await request(app).get('/api/league/12/chat?before=7').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.match(captured.sql, /"chat_messages"\."feed_seq" < \$3/);
  assert.deepEqual(captured.params, [12, 9, 7, 100]);
});

test('GET chat?after=<seq> resumes newer than the cursor, ascending (#442)', async (t) => {
  const captured = mockFeed(t);
  const res = await request(app).get('/api/league/12/chat?after=7').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.match(captured.sql, /"chat_messages"\."feed_seq" > \$3/);
  assert.match(captured.sql, /ORDER BY "chat_messages"\."feed_seq" ASC/);
  assert.deepEqual(captured.params, [12, 9, 7, 100]);
});

test('GET chat ignores a non-integer before cursor', async (t) => {
  const captured = mockFeed(t);
  const res = await request(app).get('/api/league/12/chat?before=abc').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.doesNotMatch(captured.sql, /"feed_seq" < \$/);
  assert.deepEqual(captured.params, [12, 9, 100]);
});

test('GET chat is members-only', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const res = await request(app).get('/api/league/12/chat').set('Authorization', authed());
  assert.equal(res.status, 403);
});

test('GET chat rejects a non-integer league id', async (t) => {
  t.mock.method(pool, 'query', async () => {
    throw new Error('no query should run for an invalid league id');
  });
  const res = await request(app).get('/api/league/abc/chat').set('Authorization', authed());
  assert.equal(res.status, 400);
});
