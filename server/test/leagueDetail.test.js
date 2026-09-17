/**
 * GET /api/league/:id, thin route test (#1499): the query, authorization and
 * shaping logic moved to leagueDetail.service.js and is covered there
 * (leagueDetail.service.test.js, the shared fake-pool helper). This file
 * covers only what changed by staying in the route: the id param guard, a
 * successful call passing its payload through untouched, and the coded
 * refusal -> HTTP status mapping (LeagueDetailError and the generic 500
 * fallback for anything else).
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const leagueDetailService = require('../services/leagueDetail.service');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-detail-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

test('GET /api/league/:id refuses a non-integer id before calling the module', async (t) => {
  t.mock.method(leagueDetailService, 'leagueDetail', async () => {
    throw new Error('leagueDetail must not be called for a malformed id');
  });
  const token = signToken({ id: 7, username: 'commissioner' });

  const response = await request(app).get('/api/league/not-a-number').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'league id must be a positive integer' });
});

test('GET /api/league/:id calls leagueDetail with the parsed id and the caller as viewer, and returns its payload untouched', async (t) => {
  let seenArgs = null;
  t.mock.method(leagueDetailService, 'leagueDetail', async (args) => {
    seenArgs = args;
    return { viewerTeamId: 11, league: { id: 42, name: 'Stub League' }, teams: [{ id: 11 }] };
  });
  const token = signToken({ id: 7, username: 'commissioner' });

  const response = await request(app).get('/api/league/42').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { viewerTeamId: 11, league: { id: 42, name: 'Stub League' }, teams: [{ id: 11 }] });
  assert.equal(seenArgs.leagueId, 42);
  assert.equal(seenArgs.viewer, 7);
});

test('GET /api/league/:id maps a LeagueDetailError to its own statusCode and message, dropping the code (byte-equal to before #1499)', async (t) => {
  t.mock.method(leagueDetailService, 'leagueDetail', async () => {
    throw new leagueDetailService.LeagueDetailError(403, 'NOT_A_MEMBER', 'not a member of this league');
  });
  const token = signToken({ id: 55, username: 'member' });

  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'not a member of this league' });
});

test('GET /api/league/:id maps a 404 LeagueDetailError the same way', async (t) => {
  t.mock.method(leagueDetailService, 'leagueDetail', async () => {
    throw new leagueDetailService.LeagueDetailError(404, 'LEAGUE_NOT_FOUND', 'league not found');
  });
  const token = signToken({ id: 7, username: 'commissioner' });

  const response = await request(app).get('/api/league/404404').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'league not found' });
});

test('GET /api/league/:id falls back to a generic 500 for an error the module does not throw as a LeagueDetailError', async (t) => {
  t.mock.method(leagueDetailService, 'leagueDetail', async () => {
    throw new Error('unexpected failure');
  });
  const token = signToken({ id: 7, username: 'commissioner' });

  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'failed to fetch league details' });
});
