const test = require('node:test');
const assert = require('node:assert/strict');
const seasonSummary = require('../services/seasonSummary.service');
const { rulesForLeague } = require('../services/scoringRules');

// A Sleeper-written kicker rollup: a made-field-goal COUNT and no distances.
// Its stored fantasy_points (numeric, so pg hands it back as a string) is the
// season total that is the truth: re-scoring this stats blob drops every FG.
const COUNT_ROLLUP = { fieldGoal: 41, extraPoint: 48 };
const STORED_TOTAL = '171.00';

// A League whose kicking rules would price a 2-FG season at 20, not the stored total.
const CUSTOM_FG_RULES = rulesForLeague({
  scoring_rules: { kicking: { fieldGoal: [{ min: 0, max: null, points: 10 }] } },
});

test('projectSeasonPoints: a kicker count rollup projects from its stored total, not a re-score', () => {
  const projected = seasonSummary.projectSeasonPoints({
    seasonRows: [{ season: 2025, games_played: 17, stats: COUNT_ROLLUP, fantasy_points: STORED_TOTAL }],
    currentSeasonYear: 2026,
  });
  assert.equal(projected, 171);
});

test('projectSeasonPoints: a rollup carrying fieldGoalDistances is still priced under League rules', () => {
  const projected = seasonSummary.projectSeasonPoints({
    seasonRows: [{
      season: 2025,
      games_played: 17,
      stats: { fieldGoalDistances: [45, 30], fieldGoal: 2, extraPoint: 2 },
      fantasy_points: '999.00',
    }],
    rules: CUSTOM_FG_RULES,
    currentSeasonYear: 2026,
  });
  // 2 FG at 10 under League rules + 2 XP at 1 = 22 per 17 games, the stored 999 ignored.
  assert.equal(projected, 22);
});

test('usesStoredSeasonTotal: DEF tiers and kicker count rollups read the stored total; distance rows do not', () => {
  assert.equal(seasonSummary.usesStoredSeasonTotal({ pointsAllowed: 120 }), true);
  assert.equal(seasonSummary.usesStoredSeasonTotal(COUNT_ROLLUP), true);
  // aggregateSeasonStats leaks a single-week distance array as a bare number.
  assert.equal(seasonSummary.usesStoredSeasonTotal({ fieldGoal: 2, fieldGoalDistances: 45 }), true);
  assert.equal(seasonSummary.usesStoredSeasonTotal({ fieldGoal: 2, fieldGoalDistances: [45, 30] }), false);
  assert.equal(seasonSummary.usesStoredSeasonTotal({ passingYards: 4000 }), false);
});

test('buildPlayerSummary: a kicker count rollup reads its stored total in the previous-season row and total', () => {
  const summary = seasonSummary.buildPlayerSummary({
    player: { id: 9, name: 'Jason Myers', position: 'K', adp: null },
    seasonRows: [{ season: 2025, games_played: 17, stats: COUNT_ROLLUP, fantasy_points: STORED_TOTAL }],
    rules: CUSTOM_FG_RULES,
    currentSeasonYear: 2026,
  });
  const [prev] = summary.previousSeasons;
  assert.equal(prev.points, 171);
  assert.equal(prev.perGame, 10.1);
  assert.equal(summary.fantasy.previousSeasonTotal, 171);
});
