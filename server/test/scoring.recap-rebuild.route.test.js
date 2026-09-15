/**
 * #1412: POST /api/scoring/league/:id/recap — a commissioner rebuilds the
 * stored recap for a finalized week of the current season on demand, from
 * the silent compute-and-store path (#1409). Route-level coverage only; the
 * pure recap math (buildRecapFacts, pickWaiverSteal, templateNarrative) and
 * the compute/announce split are covered in recap.service.test.js.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, insert } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const recap = require('../services/recap.service');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'recap-rebuild-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const scoringRouter = require('../routes/scoring.router');

const app = express();
app.use(express.json());
app.use('/api/scoring', scoringRouter);

const MEMBER = 42;
const COMMISSIONER = 7;
const memberAuth = `Bearer ${signToken({ id: MEMBER, username: 'member' })}`;
const commissionerAuth = `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

/**
 * A freshly-signed token. Tests that mock the clock must call this AFTER
 * enabling the mock: jsonwebtoken checks `iat`/`exp` against `Date.now()` at
 * verify time, so a token signed under the real clock reads as expired once
 * the mocked "now" no longer agrees with it (correctionWindowGate.router.test.js).
 */
function commissionerAuthNow() {
  return `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;
}

/** Records every call so "it was never reached" is provable, not inferred. */
function spy(t, mod, name, impl) {
  const calls = [];
  t.mock.method(mod, name, async (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  });
  return calls;
}

/**
 * The router's own reads before the handler runs: the pick'em gate
 * (requireFantasyLeague, a write so it always fires) and the commissioner
 * probe (requireLeagueCommissioner -> isLeagueCommissioner).
 */
function routerPool({ isCommissioner }, extra = []) {
  return createFakePool([
    ...extra,
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] })],
  ]);
}

test('POST recap: refuses a non-commissioner member and never touches the recap', async (t) => {
  const fake = routerPool({ isCommissioner: false }).install(t);
  const rebuilt = spy(t, recap, 'computeAndStoreWeeklyRecap');

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', memberAuth)
    .send({ week: 4 });

  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'only the commissioner can do this' });
  assert.equal(rebuilt.length, 0, 'the recap was never rebuilt');
  fake.assertClean();
});

test('POST recap: a week with no finalized matchup is refused 409 and nothing is stored', async (t) => {
  // isLeagueCommissioner passes (owner or co-commissioner — the SQL layer
  // doesn't distinguish the two, and that predicate is covered on its own
  // elsewhere), but the requested week's matchups query comes back with no
  // finalized row, so computeAndStoreWeeklyRecap itself no-ops.
  const fake = routerPool({ isCommissioner: true }, [
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
    [/^SELECT "matchups"\.\*/, () => ({ rows: [{ id: 1, final: false }] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', commissionerAuth)
    .send({ week: 9 });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'week is not finalized' });
  assert.equal(fake.matching(insert('league_analytics')).length, 0, 'no recap row was written');
  fake.assertClean();
});

test('POST recap: a malformed week is refused 400 before any commissioner check', async (t) => {
  const fake = routerPool({ isCommissioner: true }).install(t);
  const rebuilt = spy(t, recap, 'computeAndStoreWeeklyRecap');

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', commissionerAuth)
    .send({ week: 0 });

  assert.equal(res.status, 400);
  assert.equal(rebuilt.length, 0);
  // The route's own week validation runs before its commissioner probe: only
  // the router-wide pick'em gate (requireFantasyLeague, ahead of every
  // handler) has queried anything.
  assert.equal(fake.matching(/^SELECT 1 FROM "leagues"/).length, 0, 'the commissioner probe never ran');
});

test('POST recap: a commissioner (or co-commissioner) rebuilds a finalized week — facts reflect the current scores, the stamp moves, and nothing is announced', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T00:00:00.000Z') });
  const fake = routerPool({ isCommissioner: true }, [
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
    // The week's matchups AFTER a correction moved the score: Team A now
    // leads 130-60, where a stale recap (built before the correction) would
    // have named a different leader/margin.
    [/^SELECT "matchups"\.\*/, () => ({
      rows: [{
        id: 1, final: true, home_team_id: 1, away_team_id: 2,
        home_team_name: 'Team A', away_team_name: 'Team B',
        home_score: 130, away_score: 60,
      }],
    })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 1, scoring_rules: null }] })],
    [insert('league_analytics'), () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', commissionerAuthNow())
    .send({ week: 9 });

  assert.equal(res.status, 200);
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.week, 9);
  // The rebuilt facts reflect the current (post-correction) matchup scores.
  assert.deepEqual(res.body.data.facts.highestScorer, { team: 'Team A', points: 130 });
  // The generated-at stamp moved to the moment of the rebuild, not some
  // earlier, stale generation time.
  assert.equal(res.body.data.generatedAt, '2026-11-02T00:00:00.000Z');
  assert.equal(fake.matching(insert('league_analytics')).length, 1, 'the recap row was stored');
  // Silent: no feed entry and no member notification.
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no new recap feed entry');
  assert.equal(fake.matching(insert('notifications')).length, 0, 'no new member notification');
  fake.assertClean();
});
