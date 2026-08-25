/**
 * #188: alerts about a commissioner-gated power reach every commissioner.
 *
 * leagueRole.service's header states the rule these two paths were breaking:
 * "A commissioner-only alert ... must not reach the creator alone once
 * co-commissioners exist: they hold the same powers and need the same nudge."
 * Both call sites resolved "the commissioner" by reading `leagues.owner_id`
 * and notifying that one account, which is the creator alone.
 *
 * Neither was an authorization bypass, which is exactly why they survived: a
 * co-commissioner could always action the thing, they were simply never told
 * it was waiting. Nothing throws when a notification goes to too few people.
 *
 * The distinguishing fixture in both tests is a co-commissioner. Against the
 * old code every assertion about the OWNER still passes; only the
 * co-commissioner's notification is missing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');

const OWNER_ID = 100;
const CO_COMMISSIONER_ID = 202;

/** The rows every notification INSERT was called with, oldest first. */
const notified = (fake) =>
  fake.matching(/INSERT INTO "notifications"/).map((call) => ({
    userId: call.params[0],
    message: call.params[3],
  }));

test('a join request alerts every commissioner, not the creator alone', async (t) => {
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      rows: [{
        id: 7, name: 'Curated League', owner_id: OWNER_ID, is_public: true,
        join_approval: true, max_teams: 10, pickem_only: false,
        draft_status: 'pending', season_status: 'regular',
      }],
    })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    [/INSERT INTO "join_requests"/, (_text, params) => ({
      rows: [{ id: 9, league_id: params[0], user_id: params[1], team_name: params[2], status: 'pending' }],
    })],
    [/FROM "league_commissioners"/, () => ({
      rows: [{ user_id: CO_COMMISSIONER_ID, username: 'deputy', teamId: 42, teamName: 'Deputy FC' }],
    })],
    [/INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  const { joinPublicLeague } = require('../services/discovery.service');
  const result = await joinPublicLeague({
    leagueId: 7, userId: 5, username: 'eve', teamName: 'Eve Picks',
  });

  assert.equal(result.pending, true);
  const alerts = notified(fake);
  // Approving or denying the request is commissioner-gated (listJoinRequests
  // and decideJoinRequest both authorize through commissionerPredicate), so
  // the queue filling up is news for whoever can action it.
  assert.deepEqual(
    alerts.map((a) => a.userId).sort((a, b) => a - b),
    [OWNER_ID, CO_COMMISSIONER_ID].sort((a, b) => a - b)
  );
  for (const alert of alerts) {
    assert.match(alert.message, /eve requested to join Curated League/);
  }
  fake.assertClean();
});

test('a playoff-flipping stat correction alerts every commissioner, not the creator alone', async (t) => {
  const fake = createFakePool([
    // The before/after snapshots: one settled playoff matchup whose winner flips.
    [/SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 15, final: true, is_playoff: true, home_score: 50, away_score: 60 }],
    })],
    [/SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: 70, away_score: 60 }],
    })],
    [/INSERT INTO "transactions"|INSERT INTO "activity"/, () => ({ rows: [] })],
    [/SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [] })],
    [/SELECT "owner_id" FROM "leagues"/, () => ({ rows: [{ owner_id: OWNER_ID }] })],
    [/FROM "league_commissioners"/, () => ({
      rows: [{ user_id: CO_COMMISSIONER_ID, username: 'deputy', teamId: 42, teamName: 'Deputy FC' }],
    })],
    [/INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  const scoring = require('../services/scoring.service');
  t.mock.method(scoring, 'scoreMatchups', async () => ({}));

  const { correctLeagueWeek } = require('../services/correction.service');
  await correctLeagueWeek({ leagueId: 7, season: 2025, week: 15 });

  // The bracket alert only; notifyLeague's own fan-out has no team rows here.
  const bracketAlerts = notified(fake).filter((a) => /commissioner tools/.test(a.message));
  assert.deepEqual(
    bracketAlerts.map((a) => a.userId).sort((a, b) => a - b),
    [OWNER_ID, CO_COMMISSIONER_ID].sort((a, b) => a - b)
  );
  fake.assertClean();
});
