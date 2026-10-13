const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const draftgradeService = require('../services/draftgrade.service');
const { createFakePool, select } = require('./helpers/fakePool');

// GET /api/league/:id/draft-grades maps its own failure answers: 400 for a
// non-integer id, 403 for a non-member, 404 for a null grade set, and 500 when
// the grading read throws. The service's grading is pinned by
// draftgrade.service.test.js; this file pins the route's four answers.

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-grades-errors-route-test-secret';
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

test('GET draft grades answers 400 for a non-integer league id without running a statement', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fake = createFakePool([]).install(t);

  const res = await request(app)
    .get('/api/league/abc/draft-grades')
    .set('Authorization', authed());

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'league id must be a positive integer' });
  assert.deepEqual(fake.calls, [], 'no statement ran');
});

test('GET draft grades answers 403 to a non-member and never grades', async (t) => {
  const grade = t.mock.method(draftgradeService, 'getOrComputeDraftGrades', async () => ({}));
  const fake = createFakePool([
    [select('teams'), () => NON_MEMBER_ROW],
  ]).install(t);

  const res = await request(app)
    .get('/api/league/5/draft-grades')
    .set('Authorization', authed());

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'not a member of this league' });
  assert.deepEqual(fake.matching(select('teams'))[0].params, [5, 9], 'membership asked about this league and this user');
  assert.equal(grade.mock.callCount(), 0, 'the grading never ran for a non-member');
});

test('GET draft grades answers 404 when grading resolves null', async (t) => {
  const grade = t.mock.method(draftgradeService, 'getOrComputeDraftGrades', async () => null);
  createFakePool([
    [select('teams'), () => MEMBER_ROW],
  ]).install(t);

  const res = await request(app)
    .get('/api/league/5/draft-grades')
    .set('Authorization', authed());

  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'draft grades not available yet' });
  assert.deepEqual(grade.mock.calls[0].arguments[0], { leagueId: 5 }, 'grading was asked about this league');
});

test('GET draft grades answers 500 when grading throws', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(draftgradeService, 'getOrComputeDraftGrades', async () => {
    throw new Error('boom');
  });
  createFakePool([
    [select('teams'), () => MEMBER_ROW],
  ]).install(t);

  const res = await request(app)
    .get('/api/league/5/draft-grades')
    .set('Authorization', authed());

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to fetch draft grades' });
});
