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
 * `{ id, team_name, created_at }`, built fresh via listJoinRequests()'s own
 * allowlist rather than passed through as `result.rows`, so a row wider than
 * the contract (the fake DB below still carries `username`, as if a join to
 * "users" regrew) cannot reach the client. A request is actioned by its id
 * and shown by its proposed Team name, per CONTEXT.md's Team identity rule
 * and the pattern in coCommissioner.route.test.js.
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

test('GET /:id/join-requests serves exactly id, team_name, created_at, however wide the row is', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (/^SELECT 1 FROM "leagues"/.test(text)) return { rows: [{ '?column?': 1 }] };
    if (/^SELECT "join_requests"\."id"/.test(text)) {
      // A DB-shaped row wider than the contract, as if the query still
      // carried (or regrew) a join to "users": listJoinRequests() builds the
      // served row fresh via allowlisted(), the same defense PREVIEW_FIELDS
      // uses, so this extra column must not survive regardless of what the
      // query itself does or doesn't select.
      return { rows: [{ id: 3, team_name: 'Eve Picks', created_at: '2026-08-20T00:00:00.000Z', username: 'eve' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app)
    .get('/api/league/5/join-requests')
    .set('Authorization', authed(OWNER_ID));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, [{ id: 3, team_name: 'Eve Picks', created_at: '2026-08-20T00:00:00.000Z' }]);
  assert.equal('username' in res.body[0], false, 'the requester account name is not served');

  // The commissioner-gate query ran, and the list query itself never selects
  // or joins "users" either -- belt and suspenders with the allowlist above.
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
