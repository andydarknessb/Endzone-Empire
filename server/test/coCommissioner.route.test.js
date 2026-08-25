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
const GRANTED_AT = '2026-08-12T10:00:00.000Z';

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
    // The projection keeps the username (the SELECT is shared with the
    // notification fan-out's read); what leaves the server is the serialized
    // roster, which is what the assertions below check.
    [/FROM "league_commissioners" JOIN "users"/, () => ({
      rows: [{ user_id: 42, username: 'alice', created_at: GRANTED_AT, teamId: 11, teamName: "Alice's Team" }],
    })],
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
  // #324: the roster leaves the server in ONE shape wherever it leaves from.
  // This endpoint is owner-gated, so it is the commissioner's shape - the
  // account id grant and revoke are built on, beside Team identity, and no
  // username on any path.
  assert.deepEqual(response.body.coCommissioners, [
    { user_id: 42, grantedAt: GRANTED_AT, teamId: 11, teamName: "Alice's Team" },
  ]);
  assert.ok(calls.some((sql) => /^INSERT INTO "league_commissioners"/.test(sql)));
  assert.ok(calls.some((sql) => /^INSERT INTO "transactions"/.test(sql)));
  assert.ok(calls.some((sql) => /^INSERT INTO "notifications"/.test(sql)));
  assert.ok(calls.includes('COMMIT'));
});

test('the owner can revoke a co-commissioner', async (t) => {
  const calls = withMockClient(t);

  const response = await del(OWNER_ID, 42);

  assert.equal(response.status, 200);
  // #324: the same one shape as the grant above. Asserted on BOTH bodies and
  // not just the grant's, because "every path serializes" is the claim, and a
  // claim tested on one of two paths is tested on neither.
  assert.deepEqual(response.body.coCommissioners, [
    { user_id: 42, grantedAt: GRANTED_AT, teamId: 11, teamName: "Alice's Team" },
  ]);
  assert.ok(calls.some((sql) => /^DELETE FROM "league_commissioners"/.test(sql)));
  assert.ok(calls.includes('COMMIT'));
  // The activity log names the revoked member's Team, resolved by the roles module.
  const logged = calls.findIndex((sql) => /^INSERT INTO "transactions"/.test(sql));
  assert.ok(logged >= 0, 'a transaction row was logged');
  assert.ok(calls.params[logged].includes(11), `logged params carry team id 11: ${JSON.stringify(calls.params[logged])}`);
});

/**
 * #274: the refusal tests below used to discard the call log this mock already
 * returns. Every write in the grant/revoke flow is answered by a live default
 * handler above, so a guard moved below any of them writes for real, rolls
 * back, and answers with the identical status and message.
 */
const countMatching = (calls, re) => calls.filter((sql) => re.test(sql)).length;
const GRANT = /^INSERT INTO "league_commissioners"/;
const REVOKE = /^DELETE FROM "league_commissioners"/;
const LOG = /^INSERT INTO "transactions"/;
const NOTIFY = /^INSERT INTO "notifications"/;

test('a co-commissioner cannot promote anyone — that stays with the owner', async (t) => {
  const calls = withMockClient(t);

  const response = await post(99, { userId: 42 });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /only the league owner/);
  // #274: counts, and the log/notify pair as well as the grant itself.
  assert.equal(countMatching(calls, GRANT), 0, 'no role was granted');
  assert.equal(countMatching(calls, LOG), 0, 'no activity row claimed one was');
  assert.equal(countMatching(calls, NOTIFY), 0, 'nobody was told they had been promoted');
  assert.ok(calls.includes('ROLLBACK')); // complementary only
});

test('a co-commissioner cannot revoke another co-commissioner', async (t) => {
  const calls = withMockClient(t);

  const response = await del(99, 42);

  assert.equal(response.status, 403);
  assert.equal(countMatching(calls, REVOKE), 0, 'no role was revoked');
  assert.equal(countMatching(calls, LOG), 0, 'no activity row claimed one was');
  assert.equal(countMatching(calls, NOTIFY), 0);
});

test('promoting a non-member is rejected', async (t) => {
  const calls = withMockClient(t, [[/FROM "teams" JOIN "users"/, () => ({ rows: [] })]]);

  const response = await post(OWNER_ID, { userId: 4242 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /not a member of this league/);
  // #274. The default INSERT handler answers successfully, so a membership
  // check moved below the grant would make a non-member a co-commissioner,
  // roll back, and return this same 400.
  assert.equal(countMatching(calls, GRANT), 0, 'the non-member was not granted the role');
});

test('promoting the owner is rejected — they already hold the role', async (t) => {
  const calls = withMockClient(t);

  const response = await post(OWNER_ID, { userId: OWNER_ID });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /already the commissioner/);
  assert.equal(countMatching(calls, GRANT), 0, 'no duplicate grant row was written');
});

test('promoting an existing co-commissioner conflicts', async (t) => {
  const calls = withMockClient(t, [[/^INSERT INTO "league_commissioners"/, () => ({ rows: [] })]]);

  const response = await post(OWNER_ID, { userId: 42 });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /already a co-commissioner/);
  // #274, and the seam is deliberately NOT the grant: this 409 is raised BY
  // the insert's own empty RETURNING (ON CONFLICT DO NOTHING), so the grant
  // statement is supposed to run and a zero count here would be wrong. What
  // the refusal still protects is the log and the notification - a guard below
  // those writes a spurious activity row and tells someone they were promoted
  // when they were not.
  assert.equal(countMatching(calls, LOG), 0, 'no activity row for a grant that did not happen');
  assert.equal(countMatching(calls, NOTIFY), 0, 'and no false "you were promoted" notification');
  assert.equal(calls.filter((sql) => sql === 'COMMIT').length, 0); // complementary only
});

test('revoking someone who is not a co-commissioner 404s', async (t) => {
  const calls = withMockClient(t, [[/^DELETE FROM "league_commissioners"/, () => ({ rows: [] })]]);

  const response = await del(OWNER_ID, 42);

  assert.equal(response.status, 404);
  assert.match(response.body.error, /not a co-commissioner/);
  // Same shape as the row above: the DELETE legitimately runs and finds
  // nothing, so the protected work is the log and the notification.
  assert.equal(countMatching(calls, LOG), 0, 'no activity row for a revoke that did not happen');
  assert.equal(countMatching(calls, NOTIFY), 0);
  assert.equal(calls.filter((sql) => sql === 'COMMIT').length, 0); // complementary only
});

test('a non-integer userId is rejected before any database work', async (t) => {
  const calls = withMockClient(t);

  const response = await post(OWNER_ID, { userId: 'alice' });

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
