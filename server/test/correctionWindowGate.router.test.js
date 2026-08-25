/**
 * #329: route-level refusal coverage for the manual-correction window guard
 * (`assertManualCorrectionWindow`, correction.service.js). Before this file
 * the only test exercising the guard called the pure function directly
 * (correction.service.test.js); nothing proved that either of its two real
 * callers actually stops the writes it exists to stop.
 *
 * Two call sites, two seams:
 *
 *  - `POST /league/:id/correct-week` (scoring.router.js) calls the guard once,
 *    BEFORE it reads whether the request is a manual score override or a
 *    re-sync. A rejection there must stop both branches: the re-sync branch
 *    (scoring.syncWeekStats + correction.correctLeagueWeek) and the manual
 *    branch (commissioner.adjustMatchupScore).
 *  - `commissioner.service.js`'s `adjustMatchupScore` calls the guard AGAIN,
 *    against the actual matchup row it fetched (`FOR UPDATE`) rather than the
 *    season/week the client claimed in the request body. That is real
 *    defense in depth, not a duplicate: a request whose body satisfies the
 *    outer check can still name a matchup that belongs to a different,
 *    out-of-window week, and only the inner guard sees that mismatch.
 *
 * Per docs/agents/refusal-tests.md, each refusal is paired with a write-count
 * assertion at the closest seam, and each seam has a baseline (a passing
 * request that proves the same counter can go non-zero).
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, insert, update } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const scoring = require('../services/scoring.service');
const correction = require('../services/correction.service');
const commissioner = require('../services/commissioner.service');
const activity = require('../services/activity.service');
const { CORRECTION_WINDOW_ERROR } = correction;

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'correction-window-gate-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const scoringRouter = require('../routes/scoring.router');

const app = express();
app.use(express.json());
app.use('/api/scoring', scoringRouter);

const COMMISSIONER = 7;
const authed = `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

/**
 * A freshly-signed token. Tests that mock the clock must call this AFTER
 * enabling the mock: jsonwebtoken checks `iat`/`exp` against `Date.now()` at
 * verify time, so a token signed under the real clock reads as expired (or
 * not-yet-valid) once the mocked "now" no longer agrees with it.
 */
function authedNow() {
  return `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;
}

/**
 * Records every call so "it was never reached" is provable, not inferred.
 */
function spy(t, mod, name, impl = async () => ({})) {
  const calls = [];
  t.mock.method(mod, name, async (...args) => {
    calls.push(args);
    return impl(...args);
  });
  return calls;
}

/**
 * The router's own reads for `correct-week`: the pick'em type check
 * (router-level middleware) and the league/commissioner probe.
 */
function routerPool({ currentSeason, currentWeek, isCommissioner = true }, extra = []) {
  return createFakePool([
    ...extra,
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [
      /^SELECT "current_season", "current_week"/,
      () => ({ rows: [{ current_season: currentSeason, current_week: currentWeek, is_commissioner: isCommissioner }] }),
    ],
  ]);
}

/* ------------------------------------------------------------------ *
 * POST /league/:id/correct-week — the router's own guard call         *
 * (correction.assertManualCorrectionWindow, scoring.router.js)        *
 * ------------------------------------------------------------------ */

test('correct-week: refuses a re-sync outside the window and never re-syncs or re-scores', async (t) => {
  // current_week 5 => the only correctable week is 4. Requesting week 2 fails
  // the window check regardless of what day it is, so this needs no clock
  // control.
  const fake = routerPool({ currentSeason: 2026, currentWeek: 5 }).install(t);
  const synced = spy(t, scoring, 'syncWeekStats');
  const corrected = spy(t, correction, 'correctLeagueWeek');

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authed)
    .send({ season: 2026, week: 2 });

  assert.equal(res.status, 403);
  assert.equal(res.body.error, CORRECTION_WINDOW_ERROR.code);
  assert.equal(res.body.message, CORRECTION_WINDOW_ERROR.message);
  assert.equal(synced.length, 0, 'stats were never re-synced');
  assert.equal(corrected.length, 0, 'the league week was never re-scored');
  fake.assertClean();
});

test('correct-week: refuses a manual score override outside the window and never adjusts it', async (t) => {
  // Same out-of-window request shape, but this one carries a manual score
  // override. The router calls the guard BEFORE branching on that, so this
  // must fail before commissioner.adjustMatchupScore is ever invoked.
  const fake = routerPool({ currentSeason: 2026, currentWeek: 5 }).install(t);
  const adjusted = spy(t, commissioner, 'adjustMatchupScore');

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authed)
    .send({ season: 2026, week: 2, matchupId: 55, homeScore: 100, awayScore: 90 });

  assert.equal(res.status, 403);
  assert.equal(res.body.error, CORRECTION_WINDOW_ERROR.code);
  assert.equal(adjusted.length, 0, 'the manual score override never ran');
  fake.assertClean();
});

test('correct-week: baseline — inside the window, a re-sync request actually re-syncs and re-scores', async (t) => {
  // Baseline for the two refusal tests above: the same counters this suite
  // relies on for "zero" can also report a real call. 2026-10-06 is a
  // Tuesday (see correction.service.test.js), and current_week 9 makes week
  // 8 the only correctable week.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-06T12:00:00.000Z') });
  const fake = routerPool({ currentSeason: 2026, currentWeek: 9 }).install(t);
  const synced = spy(t, scoring, 'syncWeekStats', async () => ({ plays: [] }));
  const corrected = spy(t, correction, 'correctLeagueWeek', async () => ({ leagueId: 1, changes: [] }));

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authedNow())
    .send({ season: 2026, week: 8 });

  assert.equal(res.status, 200);
  assert.equal(synced.length, 1, 'the counter can see a real call, not just zero');
  assert.equal(corrected.length, 1);
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * commissioner.service.js's OWN guard call, inside adjustMatchupScore *
 * (defense in depth: checks the fetched matchup row, not the request  *
 * body). Reached only when the router's own guard above lets the      *
 * request through.                                                    *
 * ------------------------------------------------------------------ */

/**
 * Everything adjustMatchupScore itself needs, run for real (not mocked). The
 * UPDATE and INSERT handlers answer successfully even in the refusal test:
 * per docs/agents/refusal-tests.md, a write count of zero is only evidence of
 * the guard holding if the fixture could have answered that write. Left
 * unregistered, a misplaced guard would be "caught" by fakePool's own
 * "unexpected query" fault instead of by the assertion — a fixture-
 * completeness error wearing the shape of a passing safety test.
 */
function adjustMatchupPool({ currentSeason, currentWeek, matchupSeason, matchupWeek }, extra = []) {
  return createFakePool([
    ...extra,
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [
      /^SELECT "current_season", "current_week"/,
      () => ({ rows: [{ current_season: currentSeason, current_week: currentWeek, is_commissioner: true }] }),
    ],
    [
      /^SELECT \*, .* AS "is_commissioner" FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 1, current_season: currentSeason, current_week: currentWeek, is_commissioner: true }] }),
    ],
    [
      /^SELECT "season", "week" FROM "matchups"/,
      () => ({ rows: [{ season: matchupSeason, week: matchupWeek }] }),
    ],
    [update('matchups'), () => ({ rows: [{ id: 77, home_score: 50, away_score: 40 }] })],
    [insert('transactions'), () => ({ rows: [] })],
  ]);
}

test('correct-week: adjustMatchupScore refuses a matchup whose OWN week is out of the window, even though the request body is in-window', async (t) => {
  // The request claims week 8 (the correctable week for current_week 9), so
  // the router's guard passes. The matchup FOR UPDATE actually fetched
  // belongs to week 6, which is not the correctable week — a stale or
  // mismatched matchupId. Only the guard inside adjustMatchupScore, run
  // against the real row, catches that; the router never sees it.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-06T12:00:00.000Z') });
  const fake = adjustMatchupPool({
    currentSeason: 2026,
    currentWeek: 9,
    matchupSeason: 2026,
    matchupWeek: 6,
  }).install(t);
  const logged = spy(t, activity, 'logTransaction');

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authedNow())
    .send({ season: 2026, week: 8, matchupId: 77, homeScore: 50, awayScore: 40 });

  assert.equal(res.status, 403);
  assert.equal(res.body.error, CORRECTION_WINDOW_ERROR.code);
  assert.equal(res.body.message, CORRECTION_WINDOW_ERROR.message);
  assert.equal(fake.matching(update('matchups')).length, 0, 'the score was never updated');
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no transaction log entry was written');
  assert.equal(logged.length, 0);
  fake.assertClean();
});

test('correct-week: baseline — adjustMatchupScore updates the score when the fetched matchup IS in the window', async (t) => {
  // Same shape as the refusal above, except the fetched matchup's week (8)
  // now agrees with the request body, so the inner guard passes and the
  // update actually lands. Proves the update('matchups')/insert('transactions')
  // counters above can see a real write, not just report zero forever.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-06T12:00:00.000Z') });
  const fake = adjustMatchupPool({
    currentSeason: 2026,
    currentWeek: 9,
    matchupSeason: 2026,
    matchupWeek: 8,
  }).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/correct-week')
    .set('Authorization', authedNow())
    .send({ season: 2026, week: 8, matchupId: 77, homeScore: 50, awayScore: 40 });

  assert.equal(res.status, 200);
  assert.equal(fake.matching(update('matchups')).length, 1);
  assert.equal(fake.matching(insert('transactions')).length, 1);
  fake.assertClean();
});
