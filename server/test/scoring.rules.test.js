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
