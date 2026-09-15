const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const {
  finalizeWeekAndAdvance,
  waiverPrioritiesFromStandings,
  computeStandings,
} = require('../services/season.service');
const lineupService = require('../services/lineup.service');

/**
 * Waiver priority is reverse standings and must follow the standings: every
 * week finalize (the app's Tuesday morning) resets the whole order so the
 * team in last place claims first. Before this the post-draft seed was only
 * ever rotated by claim wins and never re-ranked, so the order drifted away
 * from the standings for the whole season.
 */

const LEAGUE = {
  id: 1,
  draft_status: 'complete',
  season_status: 'regular',
  current_season: 2026,
  current_week: 3,
  regular_season_weeks: 14,
  playoff_teams: 4,
  playoff_consolation: false,
  best_ball: false,
};
const TEAMS = [
  { id: 11, name: 'A', owner_id: 1 },
  { id: 12, name: 'B', owner_id: 2 },
  { id: 13, name: 'C', owner_id: 3 },
  { id: 14, name: 'D', owner_id: 4 },
];
// Through week 2: A 2-0, B 1-1, C 1-1, D 0-2 (B beat C head to head).
const PRIOR = [
  { id: 11, league_id: 1, season: 2026, week: 1, home_team_id: 11, away_team_id: 12, home_score: '100', away_score: '90', final: true, is_playoff: false },
  { id: 12, league_id: 1, season: 2026, week: 1, home_team_id: 13, away_team_id: 14, home_score: '80', away_score: '70', final: true, is_playoff: false },
  { id: 21, league_id: 1, season: 2026, week: 2, home_team_id: 11, away_team_id: 13, home_score: '95', away_score: '85', final: true, is_playoff: false },
  { id: 22, league_id: 1, season: 2026, week: 2, home_team_id: 12, away_team_id: 14, home_score: '88', away_score: '60', final: true, is_playoff: false },
];
// Week 3 as scored, not yet final: A beats D, B beats C.
// After finalize: A 3-0, B 2-1, C 1-2, D 0-3.
const WEEK_3 = [
  { id: 31, league_id: 1, season: 2026, week: 3, home_team_id: 11, away_team_id: 14, home_score: '90', away_score: '80', final: false, is_playoff: false },
  { id: 32, league_id: 1, season: 2026, week: 3, home_team_id: 12, away_team_id: 13, home_score: '75', away_score: '70', final: false, is_playoff: false },
];
const WEEK_4 = [
  { id: 41, league_id: 1, season: 2026, week: 4, home_team_id: 11, away_team_id: 12, final: false, is_playoff: false },
  { id: 42, league_id: 1, season: 2026, week: 4, home_team_id: 13, away_team_id: 14, final: false, is_playoff: false },
];

function advancePool() {
  // The fake is an observation harness: the `final` flip is applied to the
  // whole-season read by hand so the standings computed after it count week 3.
  let week3Final = false;
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...LEAGUE }] })],
    [select('teams'), () => ({ rows: TEAMS })],
    [select('matchups'), (text, params) => {
      const week = params.length >= 3 ? Number(params[2]) : null;
      if (week === 3) return { rows: WEEK_3 };
      if (week === 4) return { rows: WEEK_4 };
      return { rows: [...PRIOR, ...WEEK_3.map((m) => ({ ...m, final: week3Final })), ...WEEK_4] };
    }],
    [/^UPDATE "matchups" SET "final"/, () => { week3Final = true; return { rows: [], rowCount: 2 }; }],
    [update('teams'), () => ({ rows: [], rowCount: 4 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

test('waiverPrioritiesFromStandings: last place claims first, the leader claims last', () => {
  const standings = computeStandings(TEAMS, [...PRIOR, ...WEEK_3.map((m) => ({ ...m, final: true }))]);
  assert.deepEqual(standings.map((s) => s.teamId), [11, 12, 13, 14], 'ranked best first');
  assert.deepEqual(waiverPrioritiesFromStandings(standings), [
    { teamId: 11, priority: 4 },
    { teamId: 12, priority: 3 },
    { teamId: 13, priority: 2 },
    { teamId: 14, priority: 1 },
  ]);
});

test('waiverPrioritiesFromStandings: an empty table yields no order', () => {
  assert.deepEqual(waiverPrioritiesFromStandings([]), []);
});

test('finalizing a week resets waiver priority to reverse standings, inside the advance transaction', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const fake = advancePool().install(t);

  const outcome = await finalizeWeekAndAdvance({ leagueId: 1 });
  assert.equal(outcome.advancedTo, 4);

  const resets = fake.matching(update('teams'));
  assert.equal(resets.length, 1, 'one reset statement for the whole league');
  const [leagueId, teamIds, priorities] = resets[0].params;
  assert.equal(leagueId, 1);
  const byTeam = new Map(teamIds.map((id, i) => [id, priorities[i]]));
  // Week 3's results count: D (0-3) claims first, A (3-0) claims last.
  assert.deepEqual(Object.fromEntries(byTeam), { 11: 4, 12: 3, 13: 2, 14: 1 });
  assert.equal(resets[0].via, 'client', 'the reset rides the advance transaction');

  // Ordered after the matchups' final flip and before the advance commits.
  const texts = fake.calls.filter((c) => c.via === 'client').map((c) => c.text);
  const flipAt = texts.findIndex((x) => /^UPDATE "matchups" SET "final"/.test(x));
  const resetAt = texts.findIndex((x) => /^UPDATE "teams" SET "waiver_priority"/.test(x));
  const commitAt = texts.findIndex((x) => x === 'COMMIT');
  assert.ok(flipAt < resetAt && resetAt < commitAt, `flip ${flipAt} < reset ${resetAt} < commit ${commitAt}`);
  fake.assertClean();
});

test('a refused finalize writes no waiver priority', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ ...LEAGUE, season_status: 'complete' }] })],
    [update('teams'), () => ({ rows: [], rowCount: 4 })],
  ]).install(t);

  await assert.rejects(finalizeWeekAndAdvance({ leagueId: 1 }), { statusCode: 409 });
  assert.equal(fake.matching(update('teams')).length, 0);
  fake.assertClean();
});
