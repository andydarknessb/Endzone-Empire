/**
 * Envelope contract for the thirteen emitters converged by #973 (spec #942,
 * ADR 0032).
 *
 * The defect this pins: those routes put the machine code in `error` and the
 * sentence written for a commissioner in `message`. Any client showing `error`
 * as prose therefore showed an internal identifier (the spec's own example:
 * a commissioner shown the literal string PICKEM_SEASON_RESULT_MISSING). They
 * now emit `{ code, message }`: the code in a field of its own, the sentence in
 * the message field.
 *
 * Thirteen routes, three routers:
 *   commissioner.router.js  9 routes, all through one handle() helper
 *   scoring.router.js       POST correct-week, two coded refusals
 *   team.router.js          PUT /lineup and POST /lineup, one shared handler
 *
 * Each route is driven for real over supertest and asserted on the same three
 * things: the code arrives under `code`, the sentence arrives under `message`,
 * and `error` is ABSENT. The third assertion is the one that matters. Without
 * it a route could keep emitting the old key alongside the new one and this
 * file would stay green while nothing had converged.
 *
 * Why the routes are driven with the service layer stubbed rather than through
 * a fakePool world: the envelope is a property of the router's catch arm, not
 * of any service's business rule. Each service's own refusal conditions are
 * already covered where they belong (commissioner.rollover.test.js,
 * correctionWindowGate.router.test.js, lineup.service.test.js); repeating those
 * worlds here would test the fixtures, not the envelope. The one thing this
 * file must not fake is the router code itself, and it does not.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'refusal-envelope-contract-secret';
test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const commissionerService = require('../services/commissioner.service');
const lineupService = require('../services/lineup.service');
const correction = require('../services/correction.service');

// team.router destructures `setLineup` at require time, so a later
// t.mock.method on the service module would never be seen by the route. The
// stub is installed on the shared module object BEFORE the router is required,
// which is the only ordering that reaches the destructured binding.
const REAL_SET_LINEUP = lineupService.setLineup;
let lineupRefusal = null;
lineupService.setLineup = async (...args) => {
  if (lineupRefusal) throw lineupRefusal;
  return REAL_SET_LINEUP(...args);
};

const commissionerRouter = require('../routes/commissioner.router');
const scoringRouter = require('../routes/scoring.router');
const teamRouter = require('../routes/team.router');

const app = express();
app.use(express.json());
app.use('/api/commissioner', commissionerRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/team', teamRouter);

const USER = 100;
const authed = `Bearer ${signToken({ id: USER, username: 'commish' })}`;

const CODE = 'PICKEM_SEASON_RESULT_MISSING';
const SENTENCE = "Pick'em season result is missing for league 5, season 2026";

/** A refusal shaped like the ones the services actually throw. */
function codedRefusal({ statusCode = 409, code = CODE, message = SENTENCE, extra = {} } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * The one shared assertion. `error` being absent is what proves the migration
 * happened rather than merely being additive.
 */
function assertEnvelope(res, { status = 409, code = CODE, message = SENTENCE } = {}) {
  assert.equal(res.status, status);
  assert.equal(res.body.code, code, 'the machine code must arrive in its own `code` field');
  assert.equal(res.body.message, message, 'the sentence must arrive in `message`');
  assert.equal(
    Object.prototype.hasOwnProperty.call(res.body, 'error'),
    false,
    'the old `error`-holds-the-code key must be gone, not merely duplicated'
  );
}

/**
 * The pick'em type read the fantasyOnly middleware performs before six of the
 * commissioner routes. Answering it as a fantasy league lets the route reach
 * its own catch arm, which is what this file is about.
 */
function fantasyPool(t) {
  return createFakePool([
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
  ]).install(t);
}

/* ------------------------------------------------------------------ *
 * commissioner.router.js - nine routes through one handle() helper    *
 * ------------------------------------------------------------------ */

const COMMISSIONER_ROUTES = [
  {
    name: 'DELETE /league/:id/teams/:teamId',
    method: 'delete',
    path: '/api/commissioner/league/5/teams/10',
    service: 'removeTeam',
  },
  {
    name: 'PUT /league/:id/teams/:teamId/lineup',
    method: 'put',
    path: '/api/commissioner/league/5/teams/10/lineup',
    body: { week: 3, moves: [{ playerId: 1, slot: 'BENCH' }] },
    service: 'forceSetLineup',
  },
  {
    name: 'PUT /league/:id/matchups/:matchupId',
    method: 'put',
    path: '/api/commissioner/league/5/matchups/9',
    body: { homeScore: 100, awayScore: 90 },
    service: 'adjustMatchupScore',
  },
  {
    name: 'PUT /league/:id/transactions-lock',
    method: 'put',
    path: '/api/commissioner/league/5/transactions-lock',
    body: { locked: true },
    service: 'setTransactionsLocked',
  },
  {
    name: 'POST /league/:id/rollover',
    method: 'post',
    path: '/api/commissioner/league/5/rollover',
    body: {},
    service: 'rolloverSeason',
  },
  {
    name: 'PUT /league/:id/teams/:teamId/lock',
    method: 'put',
    path: '/api/commissioner/league/5/teams/10/lock',
    body: { locked: true },
    service: 'setTeamLocked',
  },
  {
    name: 'PUT /league/:id/teams/:teamId/faab',
    method: 'put',
    path: '/api/commissioner/league/5/teams/10/faab',
    body: { faabRemaining: 50 },
    service: 'setTeamFaab',
  },
  {
    name: 'POST /league/:id/force-transaction',
    method: 'post',
    path: '/api/commissioner/league/5/force-transaction',
    body: { teamId: 10, action: 'add', playerId: 7 },
    service: 'forceTransaction',
  },
  {
    name: 'DELETE /league/:id/teams/:teamId/avatar',
    method: 'delete',
    path: '/api/commissioner/league/5/teams/10/avatar',
    service: 'removeTeamAvatar',
  },
];

for (const route of COMMISSIONER_ROUTES) {
  test(`commissioner ${route.name} emits { code, message } on a coded refusal`, async (t) => {
    const fake = fantasyPool(t);
    t.mock.method(commissionerService, route.service, async () => {
      throw codedRefusal({ extra: { leagueId: 5, season: 2026 } });
    });

    const res = await request(app)[route.method](route.path)
      .set('Authorization', authed)
      .send(route.body);

    assertEnvelope(res);
    // The two extra fields the helper spreads for the rollover integrity
    // refusal ride alongside and are unaffected by the convergence.
    assert.equal(res.body.leagueId, 5);
    assert.equal(res.body.season, 2026);
    fake.assertClean();
  });
}

test('commissioner handle() still emits a codeless refusal as { error: <sentence> }', async (t) => {
  // The other arm of the same helper. A refusal with no code carries no
  // machine identifier at all, so it is not part of this convergence and must
  // keep the shape every existing consumer reads.
  const fake = fantasyPool(t);
  t.mock.method(commissionerService, 'removeTeam', async () => {
    const error = new Error('that team has already been removed');
    error.statusCode = 409;
    throw error;
  });

  const res = await request(app)
    .delete('/api/commissioner/league/5/teams/10')
    .set('Authorization', authed);

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'that team has already been removed' });
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * scoring.router.js - POST correct-week, two coded refusals           *
 * ------------------------------------------------------------------ */

function correctWeekPool(t, { query } = {}) {
  return createFakePool([
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [
      /^SELECT "current_season", "current_week"/,
      query || (() => ({ rows: [{ current_season: 2026, current_week: 5, is_commissioner: true }] })),
    ],
  ]).install(t);
}

test('scoring POST correct-week emits { code, message } for the correction-window refusal', async (t) => {
  const fake = correctWeekPool(t);
  const { CORRECTION_WINDOW_ERROR } = correction;

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authed)
    .send({ season: 2026, week: 2 });

  assertEnvelope(res, {
    status: 403,
    code: CORRECTION_WINDOW_ERROR.code,
    message: CORRECTION_WINDOW_ERROR.message,
  });
  fake.assertClean();
});

test('scoring POST correct-week emits { code, message } for the transient-database refusal', async (t) => {
  // The league probe itself fails with a transient connection error, so the
  // route's retry exhausts and it takes the DATABASE_TEMPORARILY_UNAVAILABLE
  // arm. `code` on the thrown error is what isTransientDatabaseError reads.
  const fake = correctWeekPool(t, {
    query: () => {
      const error = new Error('connection terminated unexpectedly');
      error.code = 'ECONNRESET';
      throw error;
    },
  });

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authed)
    .send({ season: 2026, week: 4 });

  assert.equal(res.status, 500);
  assert.equal(res.body.code, 'DATABASE_TEMPORARILY_UNAVAILABLE');
  assert.match(res.body.message, /database attempt/);
  assert.equal(
    Object.prototype.hasOwnProperty.call(res.body, 'error'),
    false,
    'the old `error`-holds-the-code key must be gone'
  );
  assert.equal(res.headers['retry-after'], '1');
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * team.router.js - PUT /lineup and POST /lineup                       *
 * ------------------------------------------------------------------ */

const LINEUP_SENTENCE = 'that player is locked; his game has started';

async function assertLineupEnvelope(method) {
  lineupRefusal = codedRefusal({ code: 'LINEUP_LOCKED', message: LINEUP_SENTENCE });
  try {
    const res = await request(app)[method]('/api/team/lineup')
      .set('Authorization', authed)
      .send({ leagueId: 5, week: 3, moves: [{ playerId: 1, slot: 'BENCH' }] });

    assertEnvelope(res, { code: 'LINEUP_LOCKED', message: LINEUP_SENTENCE });
  } finally {
    lineupRefusal = null;
  }
}

test('team PUT /lineup emits { code, message } on a coded refusal', () => assertLineupEnvelope('put'));
test('team POST /lineup emits { code, message } on a coded refusal', () => assertLineupEnvelope('post'));

test('team PUT /lineup still emits a codeless refusal as { error: <sentence> }', async () => {
  lineupRefusal = Object.assign(new Error('cannot edit a past week'), { statusCode: 409 });
  try {
    const res = await request(app)
      .put('/api/team/lineup')
      .set('Authorization', authed)
      .send({ leagueId: 5, week: 3, moves: [{ playerId: 1, slot: 'BENCH' }] });

    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'cannot edit a past week' });
  } finally {
    lineupRefusal = null;
  }
});
