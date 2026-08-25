const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

/**
 * GET /api/league/:id/join-requests (#115 / #379): the commissioner's queue
 * of pending public join requests. Served row shape is exactly
 * `{ id, team_name, created_at }` -- the requester's account name is never
 * selected, so a request is actioned by its id and shown by its proposed
 * Team name, per CONTEXT.md's Team identity rule and pattern from
 * coCommissioner.route.test.js.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'join-requests-queue-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const OWNER_ID = 7;

const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

test('GET /:id/join-requests serves exactly id, team_name, created_at, and the query itself never touches "users"', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (/^SELECT 1 FROM "leagues"/.test(text)) return { rows: [{ '?column?': 1 }] };
    if (/^SELECT "join_requests"\."id"/.test(text)) {
      // What the real driver would hand back: exactly the columns the SQL
      // selects. Unlike the shared, widened Discover-card row behind the
      // invite preview, this query has no `extraColumns` seam to smuggle a
      // future column through -- the SELECT list itself is the contract, so
      // the row the test's fake DB answers with is deliberately narrow too.
      return { rows: [{ id: 3, team_name: 'Eve Picks', created_at: '2026-08-20T00:00:00.000Z' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .get('/api/league/5/join-requests')
    .set('Authorization', authed(OWNER_ID));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, [{ id: 3, team_name: 'Eve Picks', created_at: '2026-08-20T00:00:00.000Z' }]);

  // The commissioner-gate query ran, and the list query never selects or
  // joins "users" -- the requester's account name is never in play to strip.
  assert.ok(calls.some((c) => /^SELECT 1 FROM "leagues"/.test(c.text)));
  const listCall = calls.find((c) => /^SELECT "join_requests"\."id"/.test(c.text));
  assert.ok(listCall, 'the join-requests list query ran');
  assert.doesNotMatch(listCall.text, /"users"/, 'no join or select against "users"');
  assert.doesNotMatch(listCall.text, /username/i, 'no username column is selected');
});

test('GET /:id/join-requests still 403s for a non-commissioner caller', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (/^SELECT 1 FROM "leagues"/.test(text)) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .get('/api/league/5/join-requests')
    .set('Authorization', authed(99));

  assert.equal(res.status, 403);
  assert.match(res.body.error, /not the commissioner/);
  // The commissioner gate refused before the list query ever ran.
  assert.equal(calls.filter((c) => /^SELECT "join_requests"\."id"/.test(c.text)).length, 0);
});
