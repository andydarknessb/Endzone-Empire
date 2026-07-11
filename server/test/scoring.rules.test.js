const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCORING_RULES,
  SCORING_PRESETS,
  rulesForLeague,
  calculateFantasyPoints,
} = require('../services/scoring.service');

test('presets: standard has 0 pt receptions, half_ppr 0.5, ppr 1', () => {
  assert.equal(SCORING_PRESETS.standard.receptions, 0);
  assert.equal(SCORING_PRESETS.half_ppr.receptions, 0.5);
  assert.equal(SCORING_PRESETS.ppr.receptions, 1);
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

test('rulesForLeague: custom values merge over defaults', () => {
  const rules = rulesForLeague({ scoring_rules: { passingTDs: 6, receptions: 1 } });
  assert.equal(rules.passingTDs, 6);
  assert.equal(rules.receptions, 1);
  assert.equal(rules.rushingYards, SCORING_RULES.rushingYards); // untouched default
});

test('rulesForLeague: unknown keys and non-numeric values are dropped', () => {
  const rules = rulesForLeague({ scoring_rules: { madeUpStat: 99, passingTDs: 'abc' } });
  assert.equal(rules.madeUpStat, undefined);
  assert.equal(rules.passingTDs, SCORING_RULES.passingTDs);
});

test('rulesForLeague: accepts a JSON string column value', () => {
  const rules = rulesForLeague({ scoring_rules: '{"receptions":1}' });
  assert.equal(rules.receptions, 1);
});

test('calculateFantasyPoints respects custom rules', () => {
  const stats = { receivingYards: 100, receptions: 10, receivingTDs: 1 };
  assert.equal(calculateFantasyPoints(stats, SCORING_PRESETS.standard), 16); // 10 + 0 + 6
  assert.equal(calculateFantasyPoints(stats, SCORING_PRESETS.half_ppr), 21); // 10 + 5 + 6
  assert.equal(calculateFantasyPoints(stats, SCORING_PRESETS.ppr), 26); // 10 + 10 + 6
});

test('calculateFantasyPoints defaults to the standard rule set when rules omitted', () => {
  const stats = { rushingYards: 50 };
  assert.equal(calculateFantasyPoints(stats), 5);
});
