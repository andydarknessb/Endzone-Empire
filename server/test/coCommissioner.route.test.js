const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'co-commissioner-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const OWNER_ID = 7;

/**
 * Mock client with a regex -> handler SQL dispatch table. `overrides` are
 * matched before the defaults, so a test can make one statement behave
 * differently without restating the rest.
 */
function withMockClient(t, overrides = []) {
  const calls = [];
  calls.params = [];
  const defaults = [
    [/^BEGIN$/, () => ({ rows: [] })],
    [/^COMMIT$/, () => ({ rows: [] })],
    [/^ROLLBACK$/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 1, owner_id: OWNER_ID, name: 'Sunday Ballers' }] })],
    [/FROM "teams" JOIN "users"/, () => ({ rows: [{ id: 11, username: 'alice' }] })],
    [/^INSERT INTO "league_commissioners"/, () => ({ rows: [{ user_id: 42 }] })],
    [/^DELETE FROM "league_commissioners"/, () => ({ rows: [{ user_id: 42 }] })],
    // The revoked member's Team, looked up through the roles module's requireMember.
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({ rows: [{ id: 11, owner_id: 42 }] })],
    [/FROM "league_commissioners" JOIN "users"/, () => ({ rows: [{ user_id: 42, username: 'alice' }] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ];
  const handlers = [...overrides, ...defaults];
  const client = {
    query: async (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(text);
      calls.params.push(params);
      for (const [pattern, handler] of handlers) {
        if (pattern.test(text)) return handler(text, params);
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

const post = (userId, body) => request(app)
  .post('/api/league/1/co-commissioners')
  .set('Authorization', `Bearer ${signToken({ id: userId, username: `u${userId}` })}`)
  .send(body);

const del = (userId, targetId) => request(app)
  .delete(`/api/league/1/co-commissioners/${targetId}`)
  .set('Authorization', `Bearer ${signToken({ id: userId, username: `u${userId}` })}`);

test('the owner can promote a league member to co-commissioner', async (t) => {
  const calls = withMockClient(t);

  const response = await post(OWNER_ID, { userId: 42 });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.coCommissioners, [{ user_id: 42, username: 'alice' }]);
  assert.ok(calls.some((sql) => /^INSERT INTO "league_commissioners"/.test(sql)));
  assert.ok(calls.some((sql) => /^INSERT INTO "transactions"/.test(sql)));
  assert.ok(calls.some((sql) => /^INSERT INTO "notifications"/.test(sql)));
  assert.ok(calls.includes('COMMIT'));
});

test('the owner can revoke a co-commissioner', async (t) => {
  const calls = withMockClient(t);

  const response = await del(OWNER_ID, 42);

  assert.equal(response.status, 200);
  assert.ok(calls.some((sql) => /^DELETE FROM "league_commissioners"/.test(sql)));
  assert.ok(calls.includes('COMMIT'));
  // The activity log names the revoked member's Team, resolved by the roles module.
  const logged = calls.findIndex((sql) => /^INSERT INTO "transactions"/.test(sql));
  assert.ok(logged >= 0, 'a transaction row was logged');
  assert.ok(calls.params[logged].includes(11), `logged params carry team id 11: ${JSON.stringify(calls.params[logged])}`);
});

test('a co-commissioner cannot promote anyone — that stays with the owner', async (t) => {
  const calls = withMockClient(t);

  const response = await post(99, { userId: 42 });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /only the league owner/);
  assert.ok(!calls.some((sql) => /^INSERT INTO "league_commissioners"/.test(sql)));
  assert.ok(calls.includes('ROLLBACK'));
});

test('a co-commissioner cannot revoke another co-commissioner', async (t) => {
  const calls = withMockClient(t);

  const response = await del(99, 42);

  assert.equal(response.status, 403);
  assert.ok(!calls.some((sql) => /^DELETE FROM "league_commissioners"/.test(sql)));
});

test('promoting a non-member is rejected', async (t) => {
  withMockClient(t, [[/FROM "teams" JOIN "users"/, () => ({ rows: [] })]]);

  const response = await post(OWNER_ID, { userId: 4242 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /not a member of this league/);
});

test('promoting the owner is rejected — they already hold the role', async (t) => {
  withMockClient(t);

  const response = await post(OWNER_ID, { userId: OWNER_ID });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /already the commissioner/);
});

test('promoting an existing co-commissioner conflicts', async (t) => {
  withMockClient(t, [[/^INSERT INTO "league_commissioners"/, () => ({ rows: [] })]]);

  const response = await post(OWNER_ID, { userId: 42 });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /already a co-commissioner/);
});

test('revoking someone who is not a co-commissioner 404s', async (t) => {
  withMockClient(t, [[/^DELETE FROM "league_commissioners"/, () => ({ rows: [] })]]);

  const response = await del(OWNER_ID, 42);

  assert.equal(response.status, 404);
  assert.match(response.body.error, /not a co-commissioner/);
});

test('a non-integer userId is rejected before any database work', async (t) => {
  const calls = withMockClient(t);

  const response = await post(OWNER_ID, { userId: 'alice' });

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
