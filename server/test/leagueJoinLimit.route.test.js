const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const membership = require('../services/leagueMembership.service');
const { createFakePool } = require('./helpers/fakePool');

/**
 * POST /api/league/join failure limiter (#2554): 10 failed joins (no League
 * with that code) per 10 minutes, counted per user and per IP; a successful
 * join does not count. New codes are 16 hex characters; 8-character legacy
 * codes still join.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-join-limit-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;
const LEGACY_CODE = 'e402e816';

/** A fresh router per test: the limiters' stores are module-instance state. */
function makeApp(t) {
  t.mock.method(membership, 'joinLeague', async (client, { leagueId, userId }) => ({
    team: { id: 900 + userId, league_id: leagueId, owner_id: userId },
  }));
  createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "invite_code" = \$1 FOR UPDATE$/, (text, [code]) => ({
      rows: code === LEGACY_CODE ? [{ id: 7, invite_code: code }] : [],
    })],
    [/^INSERT INTO "leagues"/, (text, params) => ({ rows: [{ id: 8, invite_code: params[2] }] })],
  ]).install(t);
  delete require.cache[require.resolve('../routes/league.router')];
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/league', require('../routes/league.router'));
  return app;
}

const join = (app, userId, inviteCode, ip = '203.0.113.1') =>
  request(app).post('/api/league/join').set('Authorization', authed(userId)).set('X-Forwarded-For', ip).send({ inviteCode });

test('after 10 failed joins in 10 minutes a user\'s next join is a 429', async (t) => {
  const app = makeApp(t);
  for (let i = 0; i < 10; i++) {
    const res = await join(app, 1, `nope${i}`, `203.0.113.${i + 1}`);
    assert.equal(res.status, 404, `failure ${i + 1}`);
  }
  const res = await join(app, 1, LEGACY_CODE, '203.0.113.99');
  assert.equal(res.status, 429);
  assert.ok(res.headers['retry-after']);
});

test('one IP is limited across several users', async (t) => {
  const app = makeApp(t);
  for (let user = 1; user <= 10; user++) {
    assert.equal((await join(app, user, 'nope')).status, 404, `user ${user}`);
  }
  assert.equal((await join(app, 11, 'nope')).status, 429);
});

test('successful joins do not count toward either limit', async (t) => {
  const app = makeApp(t);
  for (let i = 0; i < 15; i++) {
    assert.equal((await join(app, 1, LEGACY_CODE)).status, 201, `join ${i + 1}`);
  }
  // The counters are still at zero, so the full 10 failures are still allowed.
  for (let i = 0; i < 10; i++) {
    assert.equal((await join(app, 1, 'nope')).status, 404, `failure ${i + 1}`);
  }
  assert.equal((await join(app, 1, 'nope')).status, 429);
});

test('a new League gets a 16-hex-character invite code, and an 8-character code still joins', async (t) => {
  const app = makeApp(t);
  const created = await request(app).post('/api/league').set('Authorization', authed(2)).send({ name: 'Code Length League' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.invite_code, /^[0-9a-f]{16}$/);
  assert.equal((await join(app, 3, LEGACY_CODE)).status, 201);
});
