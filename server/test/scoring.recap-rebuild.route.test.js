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

// A named owner, a named co-commissioner (a DIFFERENT id, not the owner) and
// a plain member, per formal-001 f1: a probe answered by a single
// `isCommissioner: true/false` literal cannot show a co-commissioner (as
// distinct from the owner) is actually accepted, because it never exercises
// two different caller ids against a world that tells them apart.
const OWNER = 7;
const CO_COMMISSIONER = 11;
const MEMBER = 42;

function authFor(userId, username) {
  return `Bearer ${signToken({ id: userId, username })}`;
}

const ownerAuth = authFor(OWNER, 'owner');
const coCommissionerAuth = authFor(CO_COMMISSIONER, 'deputy');
const memberAuth = authFor(MEMBER, 'member');

// `authFor` signs a fresh token each call. Tests that mock the clock must
// call it AFTER enabling the mock: jsonwebtoken checks `iat`/`exp` against
// `Date.now()` at verify time, so a token signed under the real clock reads
// as expired once the mocked "now" no longer agrees with it
// (correctionWindowGate.router.test.js's own `authedNow` convention).

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
 * probe (requireLeagueCommissioner -> isLeagueCommissioner). The probe's
 * `isCommissioner` answer is computed from a world (an owner id plus a
 * `league_commissioners` grant list, matching commissioner.removeTeam.test.js's
 * shape) — but critically, the grant only counts when the SQL ITSELF carries
 * commissionerPredicate's EXISTS over "league_commissioners" (formal-002 f1):
 * a fixture that grants co-commissioner access from the caller id alone,
 * with no regard to what the route actually asked, cannot tell the route's
 * real check (owner OR co-commissioner) apart from a narrower one (owner
 * alone) that happens to share the same `SELECT 1 FROM "leagues"` prefix —
 * `isLeagueOwner` (leagueRole.service.js) is exactly that narrower query,
 * over the identical table and prefix.
 *
 * (Manually verified while writing this fix, not committed as a permanent
 * mutation test: temporarily swapping the ROUTE's own
 * `requireLeagueCommissioner` call for `isLeagueOwner` turns the
 * co-commissioner test below red — 403 instead of 200 — while every other
 * test in this file stays exactly as it was; reverted after confirming it.)
 */
function recapWorld({ ownerId = OWNER, grants = [] } = {}, extra = []) {
  return createFakePool([
    ...extra,
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/^SELECT 1 FROM "leagues"/, (text, params) => {
      const userId = params[1];
      // Only a query whose own text asks about co-commissioner grants can be
      // answered by one: this is what makes a narrower, owner-only query
      // (isLeagueOwner's shape) fail for a co-commissioner caller even
      // though `grants` still lists them.
      const honorsGrants = /"league_commissioners"/.test(text);
      const isCommissioner = userId === ownerId || (honorsGrants && grants.includes(userId));
      return { rows: isCommissioner ? [{ '?column?': 1 }] : [] };
    }],
  ]);
}

test('POST recap: refuses a non-commissioner member and never touches the recap', async (t) => {
  const fake = recapWorld({ ownerId: OWNER, grants: [CO_COMMISSIONER] }).install(t);
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

test('POST recap: a co-commissioner (not the owner) rebuilds a finalized week just as the owner would', async (t) => {
  const fake = recapWorld({ ownerId: OWNER, grants: [CO_COMMISSIONER] }, [
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
    [/^SELECT "matchups"\.\*/, () => ({
      rows: [{
        id: 1, final: true, home_team_id: 1, away_team_id: 2,
        home_team_name: 'Team A', away_team_name: 'Team B',
        home_score: 100, away_score: 80,
      }],
    })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 1, scoring_rules: null }] })],
    [insert('league_analytics'), () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', coCommissionerAuth)
    .send({ week: 9 });

  assert.equal(res.status, 200);
  assert.equal(fake.matching(insert('league_analytics')).length, 1, 'the co-commissioner rebuilt the recap');
  fake.assertClean();
});

test('POST recap: a week with no finalized matchup is refused 409 and nothing is stored', async (t) => {
  const fake = recapWorld({ ownerId: OWNER }, [
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
    [/^SELECT "matchups"\.\*/, () => ({ rows: [{ id: 1, final: false }] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', ownerAuth)
    .send({ week: 9 });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'week is not finalized' });
  assert.equal(fake.matching(insert('league_analytics')).length, 0, 'no recap row was written');
  fake.assertClean();
});

test('POST recap: a malformed week is refused 400 before any commissioner check', async (t) => {
  const fake = recapWorld({ ownerId: OWNER }).install(t);
  const rebuilt = spy(t, recap, 'computeAndStoreWeeklyRecap');

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', ownerAuth)
    .send({ week: 0 });

  assert.equal(res.status, 400);
  assert.equal(rebuilt.length, 0);
  // The route's own week validation runs before its commissioner probe: only
  // the router-wide pick'em gate (requireFantasyLeague, ahead of every
  // handler) has queried anything.
  assert.equal(fake.matching(/^SELECT 1 FROM "leagues"/).length, 0, 'the commissioner probe never ran');
});

test("POST recap: a season that is not the league's current season is refused 409 and nothing is touched", async (t) => {
  // formal-001 f3: the client sends the season of the recap it has on
  // screen. A league between rollover and its first recap of the new season
  // can be showing an OLDER season's recap; silently substituting the
  // current season would rebuild a different week than the one on screen,
  // so the route refuses instead.
  const fake = recapWorld({ ownerId: OWNER }, [
    [/^SELECT "current_season" FROM "leagues"/, () => ({ rows: [{ current_season: 2026 }] })],
  ]).install(t);
  const rebuilt = spy(t, recap, 'computeAndStoreWeeklyRecap');

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', ownerAuth)
    .send({ week: 17, season: 2025 });

  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'that recap is not from the current season' });
  assert.equal(rebuilt.length, 0, 'the recap was never touched');
  fake.assertClean();
});

test('POST recap: a malformed season is refused 400 before any commissioner check', async (t) => {
  const fake = recapWorld({ ownerId: OWNER }).install(t);
  const rebuilt = spy(t, recap, 'computeAndStoreWeeklyRecap');

  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', ownerAuth)
    .send({ week: 9, season: 'not-a-year' });

  assert.equal(res.status, 400);
  // formal-002 f2: season is OPTIONAL (omitting it resolves to the current
  // season), so a malformed value is worded as a bad value, not as a missing
  // required field.
  assert.deepEqual(res.body, { error: 'season must be an integer year' });
  assert.equal(rebuilt.length, 0);
  assert.equal(fake.matching(/^SELECT 1 FROM "leagues"/).length, 0, 'the commissioner probe never ran');
});

test('POST recap: the owner rebuilds a finalized week — the STORED row (not just the response) reflects the current scores, its stamp moves past a stale one, and nothing is announced', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T00:00:00.000Z') });
  const fake = recapWorld({ ownerId: OWNER }, [
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

  // The client also sends the season of the recap it had on screen; it
  // agrees with the league's current season, so this is the ordinary path.
  const res = await request(app)
    .post('/api/scoring/league/1/recap')
    .set('Authorization', authFor(OWNER, 'owner'))
    .send({ week: 9, season: 2026 });

  assert.equal(res.status, 200);
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.week, 9);
  assert.deepEqual(res.body.data.facts.highestScorer, { team: 'Team A', points: 130 });
  assert.equal(res.body.data.generatedAt, '2026-11-02T00:00:00.000Z');

  // formal-001 f2: read the row actually written to league_analytics, not
  // only what the route echoed back in its response — the two are separate
  // writes/reads and a divergence between them (a route that decorates or
  // mis-stores) would pass if only the response were checked.
  const stored = fake.matching(insert('league_analytics'));
  assert.equal(stored.length, 1, 'the recap row was stored');
  const storedData = JSON.parse(stored[0].params[3]);
  assert.deepEqual(storedData.facts.highestScorer, { team: 'Team A', points: 130 });
  assert.equal(storedData.generatedAt, '2026-11-02T00:00:00.000Z');
  // A stale recap generated before this correction would carry an earlier
  // stamp (the fixture RecapCard.test.jsx uses for its "before" recap); the
  // stored stamp has actually moved past it, not just repeated the mock time
  // that happens to equal a hardcoded expectation.
  assert.notEqual(storedData.generatedAt, '2026-07-10T12:00:00.000Z');

  // Silent: no feed entry and no member notification.
  assert.equal(fake.matching(insert('transactions')).length, 0, 'no new recap feed entry');
  assert.equal(fake.matching(insert('notifications')).length, 0, 'no new member notification');
  fake.assertClean();
});
