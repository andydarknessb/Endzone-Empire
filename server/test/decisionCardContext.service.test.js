const test = require('node:test');
const assert = require('node:assert/strict');
const {
  averageOf,
  impliedTotalForTeam,
  usageEntryFromStats,
  opponentEntries,
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

// ---------------------------------------------------------------------------
// opponentEntries (#1609)
// ---------------------------------------------------------------------------

test('opponentEntries: rank 1 allows the most points; a game with no row (bye) adds no entry', () => {
  const defenses = new Map([['DAL', { allowedPerGame: 30, games: 4 }], ['NYG', { allowedPerGame: 10, games: 4 }], ['PHI', { allowedPerGame: 20, games: 4 }]]);
  const out = opponentEntries([{ week: 5, opponent: 'DAL' }, { week: 6, opponent: 'NYG' }], defenses);
  assert.deepEqual(out, [
    { week: 5, opponent: 'DAL', rankVsPosition: 1, allowedPerGame: 30, games: 4 },
    { week: 6, opponent: 'NYG', rankVsPosition: 3, allowedPerGame: 10, games: 4 },
  ]);
});

test('opponentEntries: ties share the lower rank number', () => {
  const defenses = new Map([['A', { allowedPerGame: 9, games: 1 }], ['B', { allowedPerGame: 9, games: 1 }], ['C', { allowedPerGame: 5, games: 1 }]]);
  const out = opponentEntries([{ week: 1, opponent: 'B' }, { week: 2, opponent: 'C' }], defenses);
  assert.deepEqual(out.map((e) => e.rankVsPosition), [1, 3]);
});

test('opponentEntries: no allowance data is []', () => {
  assert.deepEqual(opponentEntries([{ week: 1, opponent: 'DAL' }], new Map()), []);
  assert.deepEqual(opponentEntries([{ week: 1, opponent: 'DAL' }], null), []);
});

test('usageEntryFromStats: offense side reads the offense snap keys', () => {
  const stats = { usageTargets: 6, usageOffenseSnaps: 58, usageOffenseSnapPct: 0.87, gameTeam: 'BUF' };
  const entry = usageEntryFromStats(stats, RULES, 30, 'offense');
  assert.equal(entry.snaps, 58);
  assert.equal(entry.snapShare, 0.87);
});

test('usageEntryFromStats: defense side reads the defense snap keys', () => {
  const stats = {
    usageOffenseSnaps: 3, usageOffenseSnapPct: 0.05, usageDefenseSnaps: 41, usageDefenseSnapPct: 0.62,
  };
  const entry = usageEntryFromStats(stats, RULES, null, 'defense');
  assert.equal(entry.snaps, 41);
  assert.equal(entry.snapShare, 0.62);
});

test('usageEntryFromStats: missing snap keys stay null, not zero', () => {
  const entry = usageEntryFromStats({ usageTargets: 6 }, RULES, 30, 'offense');
  assert.equal(entry.snaps, null);
  assert.equal(entry.snapShare, null);
});
