const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateFantasyPoints,
  normalizeApiStats,
  SCORING_RULES,
} = require('../services/scoring.service');

test('SCORING_RULES is defined', () => {
  assert(SCORING_RULES);
  assert.equal(SCORING_RULES.passingYards, 0.04);
  assert.equal(SCORING_RULES.passingTDs, 4);
  assert.equal(SCORING_RULES.interceptions, -2);
  assert.equal(SCORING_RULES.rushingYards, 0.1);
  assert.equal(SCORING_RULES.rushingTDs, 6);
  assert.equal(SCORING_RULES.receptions, 0.5);
  assert.equal(SCORING_RULES.receivingYards, 0.1);
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

test('normalizeApiStats with valid groups array', () => {
  const groups = [
    {
      name: 'Passing',
      statistics: [
        { name: 'Yards', value: '1,250' },
        { name: 'Passing Touch Downs', value: '9' },
      ],
    },
  ];
  const result = normalizeApiStats(groups);
  assert.equal(result.passingYards, 1250);
  assert.equal(result.passingTDs, 9);
  assert.equal(result.interceptions, 0);
  assert.equal(result.rushingYards, 0);
  assert.equal(result.rushingTDs, 0);
  assert.equal(result.receivingYards, 0);
  assert.equal(result.receivingTDs, 0);
  assert.equal(result.receptions, 0);
  assert.equal(result.fumbles, 0);
});

test('normalizeApiStats with undefined returns all zeros', () => {
  const result = normalizeApiStats(undefined);
  assert.equal(result.passingYards, 0);
  assert.equal(result.passingTDs, 0);
  assert.equal(result.interceptions, 0);
  assert.equal(result.rushingYards, 0);
  assert.equal(result.rushingTDs, 0);
  assert.equal(result.receivingYards, 0);
  assert.equal(result.receivingTDs, 0);
  assert.equal(result.receptions, 0);
  assert.equal(result.fumbles, 0);
});

test('normalizeApiStats with empty array returns all zeros', () => {
  const result = normalizeApiStats([]);
  assert.equal(result.passingYards, 0);
  assert.equal(result.passingTDs, 0);
  assert.equal(result.interceptions, 0);
  assert.equal(result.rushingYards, 0);
  assert.equal(result.rushingTDs, 0);
  assert.equal(result.receivingYards, 0);
  assert.equal(result.receivingTDs, 0);
  assert.equal(result.receptions, 0);
  assert.equal(result.fumbles, 0);
});

test('normalizeApiStats with mixed groups', () => {
  const groups = [
    {
      name: 'Passing',
      statistics: [
        { name: 'Yards', value: '300' },
        { name: 'Passing Touch Downs', value: '2' },
        { name: 'Interceptions', value: '1' },
      ],
    },
    {
      name: 'Rushing',
      statistics: [
        { name: 'Yards', value: '100' },
        { name: 'Rushing Touch Downs', value: '1' },
      ],
    },
    {
      name: 'Receiving',
      statistics: [
        { name: 'Yards', value: '50' },
        { name: 'Receptions', value: '5' },
        { name: 'Receiving Touch Downs', value: '0' },
      ],
    },
  ];
  const result = normalizeApiStats(groups);
  assert.equal(result.passingYards, 300);
  assert.equal(result.passingTDs, 2);
  assert.equal(result.interceptions, 1);
  assert.equal(result.rushingYards, 100);
  assert.equal(result.rushingTDs, 1);
  assert.equal(result.receivingYards, 50);
  assert.equal(result.receivingTDs, 0);
  assert.equal(result.receptions, 5);
});

test('normalizeApiStats is case-insensitive for category names', () => {
  const groups = [
    {
      name: 'PASSING',
      statistics: [
        { name: 'Yards', value: '200' },
        { name: 'Passing Touch Downs', value: '1' },
      ],
    },
  ];
  const result = normalizeApiStats(groups);
  assert.equal(result.passingYards, 200);
  assert.equal(result.passingTDs, 1);
});

test('normalizeApiStats handles comma-separated values', () => {
  const groups = [
    {
      name: 'Passing',
      statistics: [
        { name: 'Yards', value: '1,234,567' },
        { name: 'Passing Touch Downs', value: '12' },
      ],
    },
  ];
  const result = normalizeApiStats(groups);
  assert.equal(result.passingYards, 1234567);
  assert.equal(result.passingTDs, 12);
});
