/**
 * #2760 (spec #2736): four routes had no limiter, and each answers 429 past
 * its limit.
 *
 *   POST /api/scoring/league/:id/recap         5 an hour per League (a paid Claude call)
 *   POST /api/league                           10 an hour per user
 *   POST /api/notifications/push-test          5 a minute per user
 *   POST /api/scoring/league/:id/power-rankings 5 a minute per user
 *
 * The limiters' stores live as long as the routers this file loads, so every
 * test uses its own user and League ids.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const recap = require('../services/recap.service');
const montecarlo = require('../services/montecarlo.service');
const pushAlerts = require('../services/pushAlerts.service');
const membership = require('../services/leagueMembership.service');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'route-limits-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/scoring', require('../routes/scoring.router'));
app.use('/api/notifications', require('../routes/notifications.router'));

const OWNER = 7;
const MEMBER = 42;
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

/** The pick'em gate and the commissioner probe every League write runs first; only OWNER commissions. */
function leagueWorld(extra = []) {
  return createFakePool([
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/^SELECT 1 FROM "leagues"/, (text, params) => ({ rows: params[1] === OWNER ? [{ '?column?': 1 }] : [] })],
    ...extra,
  ]);
}

/** Records every call, so "the recap was never rebuilt" is observed, not inferred. */
function spy(t, mod, name) {
  const calls = [];
  t.mock.method(mod, name, async (...args) => { calls.push(args); });
  return calls;
}

const rebuild = (leagueId, userId) =>
  request(app).post(`/api/scoring/league/${leagueId}/recap`).set('Authorization', authed(userId)).send({ week: 4 });

test('POST recap: the sixth rebuild in an hour is a 429, and another League still passes', async (t) => {
  leagueWorld([
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
  ]).install(t);
  t.mock.method(recap, 'computeAndStoreWeeklyRecap', async () => ({ headline: 'rebuilt' }));

  for (let i = 0; i < 5; i += 1) assert.equal((await rebuild(301, OWNER)).status, 200, `rebuild ${i + 1}`);
  const refused = await rebuild(301, OWNER);
  assert.equal(refused.status, 429);
  assert.ok(refused.headers['retry-after']);
  assert.equal((await rebuild(302, OWNER)).status, 200, 'a different League has its own budget');
});

test('POST recap: a member\'s refused attempts do not spend the League\'s budget', async (t) => {
  leagueWorld([
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
  ]).install(t);
  t.mock.method(recap, 'computeAndStoreWeeklyRecap', async () => ({ headline: 'rebuilt' }));

  for (let i = 0; i < 8; i += 1) assert.equal((await rebuild(303, MEMBER)).status, 403, `member ${i + 1}`);
  assert.equal((await rebuild(303, OWNER)).status, 200, 'the commissioner still has the full budget');
});

test('POST recap: in production, a limiter that cannot reach Redis answers 500 and rebuilds nothing', async (t) => {
  t.mock.method(require('../modules/redis'), 'getRedisClient', async () => { throw new Error('redis down'); });
  leagueWorld([
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
  ]).install(t);
  const rebuilt = spy(t, recap, 'computeAndStoreWeeklyRecap');

  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await rebuild(304, OWNER);
    assert.equal(res.status, 500);
    assert.equal(rebuilt.length, 0, 'fail closed: no paid rebuild without the budget check');
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});

test('POST power-rankings: the sixth recompute in a minute is a 429 for that user', async (t) => {
  leagueWorld().install(t);
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({ rankings: [] }));
  const compute = () => request(app).post('/api/scoring/league/401/power-rankings').set('Authorization', authed(OWNER));

  for (let i = 0; i < 5; i += 1) assert.equal((await compute()).status, 200, `compute ${i + 1}`);
  assert.equal((await compute()).status, 429);
});

test('POST push-test: the sixth test alert in a minute is a 429 for that user', async (t) => {
  t.mock.method(pushAlerts, 'sendAlert', async () => ({ sent: 1 }));
  const send = () => request(app).post('/api/notifications/push-test').set('Authorization', authed(9));

  for (let i = 0; i < 5; i += 1) assert.equal((await send()).status, 200, `alert ${i + 1}`);
  assert.equal((await send()).status, 429);
});

test('POST league: the eleventh League a user creates in an hour is a 429', async (t) => {
  t.mock.method(membership, 'joinLeague', async (client, { leagueId, userId }) => ({
    team: { id: 900 + userId, league_id: leagueId, owner_id: userId },
  }));
  createFakePool([
    [/^INSERT INTO "leagues"/, (text, params) => ({ rows: [{ id: 501, invite_code: params[2] }] })],
  ]).install(t);
  // The router destructures joinLeague at load, so it loads after the mock above (as leagueJoinLimit.route.test.js does).
  delete require.cache[require.resolve('../routes/league.router')];
  const leagueApp = express();
  leagueApp.use(express.json());
  leagueApp.use('/api/league', require('../routes/league.router'));
  const create = () => request(leagueApp).post('/api/league').set('Authorization', authed(10)).send({ name: 'Limit League' });

  for (let i = 0; i < 10; i += 1) assert.equal((await create()).status, 201, `league ${i + 1}`);
  assert.equal((await create()).status, 429);
});
