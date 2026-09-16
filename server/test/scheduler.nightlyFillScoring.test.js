const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const scheduler = require('../modules/scheduler');
const projection = require('../services/projection.service');
const { rulesForLeague, SCORING_RULES } = require('../services/scoringRules');

// Found while verifying release 17f8dd4e (#1447): the nightly fill generated
// 3,702 rows per week under the DEFAULT scoring hash for both live leagues,
// while every request from those leagues (both carry custom scoring_rules)
// looked up their own hash and missed. The fill's league read enumerated five
// columns and left scoring_rules out, so `rulesForLeague(league)` inside
// getWeeklyProjections saw no custom rules and hashed the defaults: the fill
// had never warmed a league with custom scoring, and reported every week
// "skipped, already cached" for the second league because the first league's
// default-hash run already covered it.

test('the nightly fill hands getWeeklyProjections the league row WITH its scoring_rules, so the run it fills is the one requests look up', async (t) => {
  const seen = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, playerIds }) => {
    seen.push(league);
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  // Full PPR: the default reception value is 0.5, so this hashes differently.
  const customRules = { receiving: { reception: 1 } };
  const fake = createFakePool([
    [/FROM "leagues"/, (text) => {
      // The row the fake returns is whatever the SELECT list asks for: a
      // column left out of the query never reaches getWeeklyProjections.
      const row = { id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 };
      if (/SELECT \*|"scoring_rules"/.test(text)) row.scoring_rules = customRules;
      return { rows: [row] };
    }],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    [/FROM "data_sync_runs"/, () => ({ rows: [{ latest: null, latestOk: null }] })],
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);

  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-19T09:00:00Z') });
  assert.ok(result && result.weeksGenerated > 0, `the fill ran: ${JSON.stringify(result)}`);
  assert.ok(seen.length > 0);
  for (const league of seen) {
    assert.deepEqual(league.scoring_rules, customRules, 'the league row reaching the generator must carry scoring_rules');
    assert.notDeepEqual(rulesForLeague(league), SCORING_RULES, 'a custom-scoring league must not hash to the default profile');
  }
  assert.ok(fake.calls.some((c) => /FROM "leagues"/.test(c.text)));
});
