const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCORING_RULES,
  SCORING_PRESETS,
  rulesForLeague,
  calculateFantasyPoints,
} = require('../services/scoringRules');

test('presets: standard has 0 pt receptions, half_ppr 0.5, ppr 1', () => {
  assert.equal(SCORING_PRESETS.standard.receiving.reception, 0);
  assert.equal(SCORING_PRESETS.half_ppr.receiving.reception, 0.5);
  assert.equal(SCORING_PRESETS.ppr.receiving.reception, 1);
  // presets are complete rule sets, not deltas
  for (const preset of Object.values(SCORING_PRESETS)) {
    assert.deepEqual(Object.keys(preset).sort(), Object.keys(SCORING_RULES).sort());
  }
});

test('rulesForLeague: null/missing column returns the defaults', () => {
  assert.equal(rulesForLeague({ scoring_rules: null }), SCORING_RULES);
  assert.equal(rulesForLeague({}), SCORING_RULES);
  assert.equal(rulesForLeague(null), SCORING_RULES);
});

test('rulesForLeague: custom values merge over defaults, category by category', () => {
  const rules = rulesForLeague({ scoring_rules: { passing: { touchdowns: 6 }, receiving: { reception: 1 } } });
  assert.equal(rules.passing.touchdowns, 6);
  assert.equal(rules.receiving.reception, 1);
  assert.equal(rules.rushing.yards, SCORING_RULES.rushing.yards); // untouched default
  assert.equal(rules.passing.interceptions, SCORING_RULES.passing.interceptions); // untouched sibling leaf
});

test('rulesForLeague: unknown categories/keys and non-numeric values are dropped', () => {
  const rules = rulesForLeague({
    scoring_rules: { madeUpCategory: { x: 99 }, passing: { madeUpStat: 99, touchdowns: 'abc' } },
  });
  assert.equal(rules.madeUpCategory, undefined);
  assert.equal(rules.passing.madeUpStat, undefined);
  assert.equal(rules.passing.touchdowns, SCORING_RULES.passing.touchdowns);
});

test('rulesForLeague: accepts a JSON string column value', () => {
  const rules = rulesForLeague({ scoring_rules: '{"receiving":{"reception":1}}' });
  assert.equal(rules.receiving.reception, 1);
});

test('rulesForLeague: a well-formed custom tier array overrides the default tiers', () => {
  const customTiers = [{ min: 0, max: 44, points: 3 }, { min: 45, max: null, points: 5 }];
  const rules = rulesForLeague({ scoring_rules: { kicking: { fieldGoal: customTiers } } });
  assert.deepEqual(rules.kicking.fieldGoal, customTiers);
});

test('rulesForLeague: a malformed tier array (overlapping/out of order) is dropped', () => {
  const overlapping = [{ min: 0, max: 40, points: 3 }, { min: 30, max: 50, points: 4 }];
  const rules = rulesForLeague({ scoring_rules: { kicking: { fieldGoal: overlapping } } });
  assert.deepEqual(rules.kicking.fieldGoal, SCORING_RULES.kicking.fieldGoal);
});

test('calculateFantasyPoints respects custom rules', () => {
  const stats = { receivingYards: 100, receptions: 10, receivingTDs: 1 };
  assert.equal(calculateFantasyPoints(stats, SCORING_PRESETS.standard), 16); // 10 + 0 + 6
  assert.equal(calculateFantasyPoints(stats, SCORING_PRESETS.half_ppr), 21); // 10 + 5 + 6
  assert.equal(calculateFantasyPoints(stats, SCORING_PRESETS.ppr), 26); // 10 + 10 + 6
});

test('calculateFantasyPoints: fieldGoalDistances tier-prices each made kick by its own distance', () => {
  // 35yd -> 3pt tier, 44yd -> 4pt tier, 51yd -> 5pt tier = 12
  assert.equal(calculateFantasyPoints({ fieldGoalDistances: [35, 44, 51] }), 12);
});

test('calculateFantasyPoints: a plain fieldGoal count (no distance data) is not scored', () => {
  // fieldGoal (a make-count with no distance breakdown) is display/event-only
  // once real per-kick distances are available via fieldGoalDistances.
  assert.equal(calculateFantasyPoints({ fieldGoal: 2 }), 0);
});

test('calculateFantasyPoints: TD-length bonus tiers price each scoring play\'s own yardage', () => {
  const rules = rulesForLeague({
    scoring_rules: { rushing: { tdLengthBonus: [{ min: 0, max: 39, points: 0 }, { min: 40, max: 49, points: 2 }, { min: 50, max: null, points: 5 }] } },
  });
  // base rushing TD rate (6) applies per TD via rushingTDs, tdLengthBonus is additive
  const stats = { rushingTDs: 2, rushingTDLengths: [45, 60] };
  assert.equal(calculateFantasyPoints(stats, rules), 2 * 6 + 2 + 5);
});

test('calculateFantasyPoints defaults to the standard rule set when rules omitted', () => {
  const stats = { rushingYards: 50 };
  assert.equal(calculateFantasyPoints(stats), 5);
});

test('idp interceptionReturnYards: 0 by default, priced when a league opts in', () => {
  // The pick itself scores (6 default); the return yardage is a 0-rate bonus
  // until a commissioner sets it — same contract as sackYards/TFL yards.
  const stats = { idpInterception: 1, idpInterceptionReturnYards: 40 };
  assert.equal(calculateFantasyPoints(stats), 6);

  const rules = rulesForLeague({ scoring_rules: { idp: { interceptionReturnYards: 0.1 } } });
  assert.equal(calculateFantasyPoints(stats, rules), 6 + 4);
});

test('rulesForLeague accepts interceptionReturnYards as a known idp key', () => {
  const rules = rulesForLeague({ scoring_rules: { idp: { interceptionReturnYards: 0.05 } } });
  assert.equal(rules.idp.interceptionReturnYards, 0.05);
  // and the default tree carries it at 0 so the editor renders the field
  assert.equal(SCORING_RULES.idp.interceptionReturnYards, 0);
});

// The following moved from scoring.service.test.js (#1506, spec #1492): the
// tests exercise scoringRules.js exports, same as the rest of this file.

test('SCORING_RULES is defined', () => {
  assert(SCORING_RULES);
  assert.equal(SCORING_RULES.passing.yards, 0.04);
  assert.equal(SCORING_RULES.passing.touchdowns, 4);
  assert.equal(SCORING_RULES.passing.interceptions, -2);
  assert.equal(SCORING_RULES.rushing.yards, 0.1);
  assert.equal(SCORING_RULES.rushing.touchdowns, 6);
  assert.equal(SCORING_RULES.receiving.reception, 0.5);
  assert.equal(SCORING_RULES.receiving.yards, 0.1);
  // Tiered stats are sorted, non-overlapping tier arrays. FG uses the five
  // NFL.com distance buckets, priced identically to the old three (0-39 = 3).
  assert.deepEqual(SCORING_RULES.kicking.fieldGoal.map((t) => [t.min, t.max, t.points]), [
    [0, 19, 3], [20, 29, 3], [30, 39, 3], [40, 49, 4], [50, null, 5],
  ]);
  assert.equal(SCORING_RULES.teamDefense.pointsAllowed.at(-1).max, null);
  assert.equal(SCORING_RULES.idp.sack, 2);
  // NFL.com-parity leaves: return TD scores like a touchdown by default;
  // yardage rates and kick-miss penalties default to 0 (opt-in).
  assert.equal(SCORING_RULES.misc.returnTDs, 6);
  assert.equal(SCORING_RULES.misc.puntReturnYards, 0);
  assert.equal(SCORING_RULES.misc.kickReturnYards, 0);
  assert.equal(SCORING_RULES.kicking.fieldGoalMissed, 0);
  assert.equal(SCORING_RULES.kicking.extraPointMissed, 0);
});

test('calculateFantasyPoints returns 0 for empty object', () => {
  assert.equal(calculateFantasyPoints({}), 0);
});

test('calculateFantasyPoints returns 0 for null', () => {
  assert.equal(calculateFantasyPoints(null), 0);
});

test('calculateFantasyPoints returns 0 for undefined', () => {
  assert.equal(calculateFantasyPoints(undefined), 0);
});

test('calculateFantasyPoints: QB line {passingYards: 300, passingTDs: 2, interceptions: 1} = 18', () => {
  const stats = { passingYards: 300, passingTDs: 2, interceptions: 1 };
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 18);
});

test('calculateFantasyPoints: RB line {rushingYards: 100, rushingTDs: 1, receptions: 4, receivingYards: 25} = 20.5', () => {
  const stats = {
    rushingYards: 100,
    rushingTDs: 1,
    receptions: 4,
    receivingYards: 25,
  };
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 20.5);
});

test('calculateFantasyPoints: a return TD scores 6 by default; return yards and kick misses are 0 until configured', () => {
  assert.equal(calculateFantasyPoints({ returnTDs: 1, puntReturnYards: 40, kickReturnYards: 55 }), 6);
  assert.equal(calculateFantasyPoints({ fieldGoalMissed: 2, extraPointMissed: 1 }), 0);
  const missPenaltyRules = JSON.parse(JSON.stringify(SCORING_RULES));
  missPenaltyRules.kicking.fieldGoalMissed = -1;
  missPenaltyRules.misc.puntReturnYards = 0.04; // 1 pt / 25 yds
  assert.equal(calculateFantasyPoints({ fieldGoalMissed: 2, puntReturnYards: 50 }, missPenaltyRules), 0);
});

test('calculateFantasyPoints ignores unknown stat keys', () => {
  const stats = { bogusStat: 999 };
  assert.equal(calculateFantasyPoints(stats), 0);
});

test('calculateFantasyPoints ignores non-numeric values', () => {
  const stats = { passingYards: 'abc' };
  assert.equal(calculateFantasyPoints(stats), 0);
});

test('calculateFantasyPoints rounds result to 2 decimals', () => {
  const stats = { passingYards: 333 };
  // 333 * 0.04 = 13.32, should round correctly
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 13.32);
});

test('calculateFantasyPoints: mixed valid and invalid values', () => {
  const stats = { passingYards: 100, passingTDs: 'invalid', rushingYards: 50 };
  // 100 * 0.04 + 50 * 0.1 = 4 + 5 = 9
  assert.equal(calculateFantasyPoints(stats), 9);
});
