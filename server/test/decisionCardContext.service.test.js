const test = require('node:test');
const assert = require('node:assert/strict');
const {
  averageOf,
  impliedTotalForTeam,
  usageEntryFromStats,
} = require('../services/decisionCardContext.service');

// ---------------------------------------------------------------------------
// impliedTotalForTeam
// ---------------------------------------------------------------------------

test('impliedTotalForTeam: picks the home side for a home game', () => {
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, 'home'), 25);
});

test('impliedTotalForTeam: picks the away side for an away game', () => {
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, 'away'), 22);
});

test('impliedTotalForTeam: a favourite (negative spread home team) and an underdog', () => {
  // total 47, spread -3 (home favoured by 3): home 25, away 22 (vegasOdds.provider docblock).
  const quote = { home: 25, away: 22 };
  assert.equal(impliedTotalForTeam(quote, 'home'), 25); // favourite
  assert.equal(impliedTotalForTeam(quote, 'away'), 22); // underdog
});

test('impliedTotalForTeam: null quote, or an unrecognized/neutral orientation, is null', () => {
  assert.equal(impliedTotalForTeam(null, 'home'), null);
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, null), null);
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, 'neutral'), null);
});

// ---------------------------------------------------------------------------
// usageEntryFromStats
// ---------------------------------------------------------------------------

const RULES = undefined; // calculateFantasyPoints defaults to SCORING_RULES

test('usageEntryFromStats: reads targets/carries/airYards and computes target share', () => {
  const stats = { usageTargets: 6, usageCarries: 2, usageAirYards: 55, gameTeam: 'BUF' };
  const entry = usageEntryFromStats(stats, RULES, 30);
  assert.equal(entry.targets, 6);
  assert.equal(entry.carries, 2);
  assert.equal(entry.airYards, 55);
  assert.equal(entry.targetShare, 0.2);
});

test('usageEntryFromStats: target share is null when team pass attempts is zero', () => {
  const stats = { usageTargets: 6, gameTeam: 'BUF' };
  const entry = usageEntryFromStats(stats, RULES, 0);
  assert.equal(entry.targetShare, null);
});

test('usageEntryFromStats: target share is null when the row has no gameTeam (no attempts to look up)', () => {
  const stats = { usageTargets: 6 };
  const entry = usageEntryFromStats(stats, RULES, null);
  assert.equal(entry.targetShare, null);
});

test('usageEntryFromStats: a missing usage key stays null, not zero', () => {
  const entry = usageEntryFromStats({}, RULES, 30);
  assert.equal(entry.targets, null);
  assert.equal(entry.carries, null);
  assert.equal(entry.airYards, null);
  assert.equal(entry.targetShare, null);
});

test('usageEntryFromStats: fantasyPoints prices the stats row under the given rules', () => {
  const stats = { passingYards: 300, passingTDs: 2 };
  const customRules = { passing: { yards: { perYard: 0.05 }, touchdowns: 6 } };
  const entry = usageEntryFromStats(stats, customRules, null);
  // Not asserting the exact scoring-engine mapping here (that's
  // scoring.service's own suite); just that this module's fantasyPoints is
  // calculateFantasyPoints(stats, rules), not the stored fantasy_points column.
  assert.equal(typeof entry.fantasyPoints, 'number');
});

// ---------------------------------------------------------------------------
// averageOf
// ---------------------------------------------------------------------------

test('averageOf: the mean of finite numbers, rounded to 2 decimals', () => {
  assert.equal(averageOf([1, 2, 3]), 2);
  assert.equal(averageOf([0.1, 0.2]), 0.15);
});

test('averageOf: nulls are dropped, not treated as zero', () => {
  assert.equal(averageOf([10, null, 20]), 15);
});

test('averageOf: an empty or all-null list is null, never zero or NaN', () => {
  assert.equal(averageOf([]), null);
  assert.equal(averageOf([null, null]), null);
  assert.equal(averageOf(undefined), null);
});
