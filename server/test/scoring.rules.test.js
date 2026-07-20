const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCORING_RULES,
  SCORING_PRESETS,
  rulesForLeague,
  calculateFantasyPoints,
} = require('../services/scoring.service');

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

test('calculateFantasyPoints: fieldGoal count prices per-unit at the tier array\'s base rate', () => {
  assert.equal(calculateFantasyPoints({ fieldGoal: 2 }), 6); // 2 makes * base 3pt tier
});

test('calculateFantasyPoints defaults to the standard rule set when rules omitted', () => {
  const stats = { rushingYards: 50 };
  assert.equal(calculateFantasyPoints(stats), 5);
});
