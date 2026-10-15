const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const matchupDetailService = require('../services/matchupDetail.service');
const { createFakePool, select } = require('./helpers/fakePool');

// GET /api/league/:id/matchups/:matchupId maps its own failure answers: 400 for
// a non-integer id, 403 for a non-member, 404 for a null detail, and 500 with a
// backstop ROLLBACK when the read throws. The route's happy path is pinned by
// the matchupDetail.expectedFinal and related suites; this file pins the rest.

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-detail-errors-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const authed = () => `Bearer ${signToken({ id: 9, username: 'member' })}`;
const MEMBER_ROW = { rows: [{ 1: 1 }] };
const NON_MEMBER_ROW = { rows: [] };

test('GET matchup detail answers 400 for a non-integer matchup id without taking a client', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fake = createFakePool([]).install(t);

  const res = await request(app)
    .get('/api/league/5/matchups/abc')
    .set('Authorization', authed());

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'league id and matchup id must be positive integers' });
  assert.deepEqual(fake.calls, [], 'no statement ran');
  assert.deepEqual(fake.releaseArgs(), [], 'no pool client was checked out');
});

test('GET matchup detail answers 403 to a non-member and releases the client', async (t) => {
  const read = t.mock.method(matchupDetailService, 'getMatchupDetail', async () => null);
  const fake = createFakePool([
    [select('teams'), () => NON_MEMBER_ROW],
  ]).install(t);

  const res = await request(app)
    .get('/api/league/5/matchups/7')
    .set('Authorization', authed());

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'not a member of this league' });
  assert.deepEqual(fake.matching(select('teams'))[0].params, [5, 9], 'membership asked about this league and this user');
  assert.equal(read.mock.callCount(), 0, 'the detail read never ran for a non-member');
  fake.assertClean();
});

test('GET matchup detail answers 404 when the read finds no such matchup and releases the client', async (t) => {
  t.mock.method(matchupDetailService, 'getMatchupDetail', async () => null);
  const fake = createFakePool([
    [select('teams'), () => MEMBER_ROW],
  ]).install(t);

  const res = await request(app)
    .get('/api/league/5/matchups/7')
    .set('Authorization', authed());

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'matchup not found in this league' });
  fake.assertClean();
});

test('GET matchup detail answers 500 and rolls back when the read throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(matchupDetailService, 'getMatchupDetail', async ({ client }) => {
    // Leave a transaction open on the checked-out client, as a real read would
    // mid-flight. Only the route's backstop ROLLBACK can close it.
    await client.query('BEGIN');
    throw new Error('boom');
  });
  const fake = createFakePool([
    [select('teams'), () => MEMBER_ROW],
  ]).install(t);

  const res = await request(app)
    .get('/api/league/5/matchups/7')
    .set('Authorization', authed());

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to fetch matchup detail' });
  const backstop = fake.calls.filter((c) => c.via === 'client' && c.text === 'ROLLBACK');
  assert.equal(backstop.length, 1, 'the route issued its backstop ROLLBACK on the client');
  fake.assertClean();
});
