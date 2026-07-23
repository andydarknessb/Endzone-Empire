const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSuggestions,
  fitAdjustedValue,
  tradeVerdict,
  tradeFairnessSummary,
  rankWaiverCandidates,
} = require('../services/decision.service');
const { DEFAULT_ROSTER_SLOTS } = require('../services/lineup.service');

// ---------------------------------------------------------------------------
// buildSuggestions
// ---------------------------------------------------------------------------

const entry = (playerId, position, slot, name = `p${playerId}`) => ({ playerId, name, position, slot });

test('buildSuggestions: suggests a swap when a bench player projects strictly higher', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = new Map([[1, { points: 10 }], [2, { points: 15 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].slot, 'RB');
  assert.equal(result.suggestions[0].current.playerId, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
  assert.equal(result.suggestions[0].gain, 5);
  assert.equal(result.projectedTotal, 10);
  assert.equal(result.optimalTotal, 15);
});

test('buildSuggestions: locked starters and locked bench players are never suggested', () => {
  const lineup = [
    { ...entry(1, 'RB', 'RB'), locked: true }, // game started — can't be benched
    entry(2, 'RB', 'RB'),
    { ...entry(3, 'RB', 'BENCH'), locked: true }, // can't be started either
    entry(4, 'RB', 'BENCH'),
  ];
  const projections = new Map([
    [1, { points: 5 }], [2, { points: 8 }], [3, { points: 30 }], [4, { points: 12 }],
  ]);
  const result = buildSuggestions(lineup, projections);
  // Only the unlocked pair (2 out, 4 in) is suggestible
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].current.playerId, 2);
  assert.equal(result.suggestions[0].suggested.playerId, 4);
  // Projected total still counts the locked starter's points
  assert.equal(result.projectedTotal, 13);
});

test('buildSuggestions: no suggestion when the bench player projects lower', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = new Map([[1, { points: 15 }], [2, { points: 10 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.projectedTotal, 15);
  assert.equal(result.optimalTotal, 15);
});

test('buildSuggestions: no suggestion when equal (must be strictly higher)', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = new Map([[1, { points: 12 }], [2, { points: 12 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 0);
});

test('buildSuggestions: no suggestion when the bench is empty', () => {
  const lineup = [entry(1, 'RB', 'RB')];
  const projections = new Map([[1, { points: 10 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.optimalTotal, result.projectedTotal);
});

test('buildSuggestions: respects slot eligibility (a bench QB cannot fill FLEX)', () => {
  const lineup = [
    entry(1, 'WR', 'FLEX'),
    entry(2, 'QB', 'BENCH'), // higher projection, but ineligible for FLEX
    entry(3, 'RB', 'BENCH'), // eligible, but lower projection than starter
  ];
  const projections = new Map([[1, { points: 8 }], [2, { points: 30 }], [3, { points: 5 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 0);
});

test('buildSuggestions: FLEX-eligible bench player is a valid suggestion for FLEX', () => {
  const lineup = [
    entry(1, 'WR', 'FLEX'),
    entry(2, 'TE', 'BENCH'),
  ];
  const projections = new Map([[1, { points: 8 }], [2, { points: 14 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].suggested.playerId, 2);
});

test('buildSuggestions: ignores IR players entirely (not a bench candidate)', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'IR'),
  ];
  const projections = new Map([[1, { points: 5 }], [2, { points: 20 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 0);
});

test('buildSuggestions: a bench player is only recommended once across slots', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'RB'),
    entry(3, 'RB', 'BENCH'), // best bench RB, can only fill one starting slot
  ];
  const projections = new Map([[1, { points: 5 }], [2, { points: 6 }], [3, { points: 20 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].current.playerId, 1); // the weaker starter is swapped
});

test('buildSuggestions: carries opponent context through when supplied', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = new Map([[1, { points: 5 }], [2, { points: 12 }]]);
  const defenseByPlayer = new Map([
    [1, { opponent: 'NYG', opponentPointsAllowed: 10 }],
    [2, { opponent: 'DAL', opponentPointsAllowed: 22 }],
  ]);
  const result = buildSuggestions(lineup, projections, defenseByPlayer);
  assert.deepEqual(result.suggestions[0].current, {
    playerId: 1, name: 'p1', projection: 5, opponent: 'NYG', opponentPointsAllowed: 10,
  });
  assert.deepEqual(result.suggestions[0].suggested, {
    playerId: 2, name: 'p2', projection: 12, opponent: 'DAL', opponentPointsAllowed: 22,
  });
});

test('buildSuggestions: missing opponent context defaults to nulls', () => {
  const lineup = [
    entry(1, 'RB', 'RB'),
    entry(2, 'RB', 'BENCH'),
  ];
  const projections = new Map([[1, { points: 5 }], [2, { points: 12 }]]);
  const result = buildSuggestions(lineup, projections);
  assert.equal(result.suggestions[0].current.opponent, null);
  assert.equal(result.suggestions[0].current.opponentPointsAllowed, null);
});

// ---------------------------------------------------------------------------
// fitAdjustedValue
// ---------------------------------------------------------------------------

test('fitAdjustedValue: surplus discount when the position (incl. FLEX capacity) is already full', () => {
  // RB capacity = RB slot count (2) + FLEX slot count (1) = 3
  const rosterPositions = ['RB', 'RB', 'RB'];
  const value = fitAdjustedValue(100, 'RB', rosterPositions, DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 85);
});

test('fitAdjustedValue: empty-slot premium when none of the position is rostered', () => {
  const rosterPositions = ['QB', 'WR', 'WR'];
  const value = fitAdjustedValue(100, 'RB', rosterPositions, DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 115);
});

test('fitAdjustedValue: neutral when the position is partially filled', () => {
  // RB capacity = 3 (2 dedicated + 1 FLEX); one RB already rostered
  const rosterPositions = ['RB'];
  const value = fitAdjustedValue(100, 'RB', rosterPositions, DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 100);
});

test('fitAdjustedValue: a position with zero starting capacity (no FLEX eligibility) is treated as surplus', () => {
  // K is not FLEX-eligible, so zero dedicated K slots means zero capacity outright.
  const noK = DEFAULT_ROSTER_SLOTS.map((s) => (s.key === 'K' ? { ...s, count: 0 } : s));
  const value = fitAdjustedValue(100, 'K', [], noK);
  assert.equal(value, 85);
});

test('fitAdjustedValue: FLEX capacity counts toward WR and TE too', () => {
  // WR capacity = 2 dedicated + 1 FLEX = 3; two WRs rostered -> still below capacity, neutral
  const value = fitAdjustedValue(50, 'WR', ['WR', 'WR'], DEFAULT_ROSTER_SLOTS);
  assert.equal(value, 50);
  // three WRs rostered -> at capacity, surplus
  const surplus = fitAdjustedValue(50, 'WR', ['WR', 'WR', 'WR'], DEFAULT_ROSTER_SLOTS);
  assert.equal(surplus, 42.5);
});

// ---------------------------------------------------------------------------
// tradeVerdict
// ---------------------------------------------------------------------------

test('tradeVerdict: identical values are fair', () => {
  assert.equal(tradeVerdict(100, 100), 'fair');
});

test('tradeVerdict: exactly 10% apart is still fair (band edge, inclusive)', () => {
  assert.equal(tradeVerdict(100, 90), 'fair');
  assert.equal(tradeVerdict(90, 100), 'fair');
});

test('tradeVerdict: just over 10% apart favors the side that received more', () => {
  assert.equal(tradeVerdict(100, 89.9), 'favors_proposer');
  assert.equal(tradeVerdict(89.9, 100), 'favors_receiver');
});

test('tradeVerdict: both sides zero is fair', () => {
  assert.equal(tradeVerdict(0, 0), 'fair');
});

test('tradeFairnessSummary: applies exact badge and commissioner-review boundaries', () => {
  assert.deepEqual(tradeFairnessSummary(100, 85), {
    fairnessMarginPct: 15,
    statusBadge: 'Even / Fair',
    isBlocked: false,
    collusion_risk: 'LOW',
  });
  assert.equal(tradeFairnessSummary(100, 84.99).statusBadge, 'Imbalanced');
  assert.equal(tradeFairnessSummary(100, 64.99).statusBadge, 'Highly Imbalanced');
  assert.equal(tradeFairnessSummary(100, 50).isBlocked, false);
  assert.deepEqual(tradeFairnessSummary(100, 49.99), {
    fairnessMarginPct: 50.01,
    statusBadge: 'Highly Imbalanced',
    isBlocked: true,
    collusion_risk: 'HIGH',
  });
});

test('tradeFairnessSummary: safely defaults missing and non-finite totals to zero', () => {
  assert.deepEqual(tradeFairnessSummary(undefined, Number.POSITIVE_INFINITY), {
    fairnessMarginPct: 0,
    statusBadge: 'Even / Fair',
    isBlocked: false,
    collusion_risk: 'LOW',
  });
});

// ---------------------------------------------------------------------------
// rankWaiverCandidates
// ---------------------------------------------------------------------------

test('rankWaiverCandidates: sorted by upgradeDelta descending', () => {
  const candidates = [
    { playerId: 1, name: 'A', position: 'RB', nflTeam: 'DAL', projection: 12 },
    { playerId: 2, name: 'B', position: 'RB', nflTeam: 'NYG', projection: 20 },
    { playerId: 3, name: 'C', position: 'RB', nflTeam: 'PHI', projection: 8 },
  ];
  const currentStarters = [{ playerId: 99, slot: 'RB', projection: 10 }];
  const ranked = rankWaiverCandidates(candidates, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.deepEqual(ranked.map((r) => r.playerId), [2, 1, 3]);
  assert.equal(ranked[0].upgradeDelta, 10);
  assert.equal(ranked[1].upgradeDelta, 2);
  assert.equal(ranked[2].upgradeDelta, -2);
});

test('rankWaiverCandidates: compares against the weakest starter in ELIGIBLE slots only', () => {
  const candidates = [{ playerId: 1, name: 'A', position: 'TE', nflTeam: 'DAL', projection: 10 }];
  const currentStarters = [
    { playerId: 10, slot: 'RB', projection: 1 }, // not TE-eligible, ignored
    { playerId: 11, slot: 'TE', projection: 6 },
    { playerId: 12, slot: 'FLEX', projection: 4 }, // TE-eligible via FLEX, weaker
  ];
  const ranked = rankWaiverCandidates(candidates, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(ranked[0].weakestStarterProjection, 4);
  assert.equal(ranked[0].upgradeDelta, 6);
});

test('rankWaiverCandidates: a position with no current starter in an eligible slot compares against 0', () => {
  const candidates = [{ playerId: 1, name: 'A', position: 'QB', nflTeam: 'DAL', projection: 18 }];
  const currentStarters = [{ playerId: 10, slot: 'RB', projection: 25 }];
  const ranked = rankWaiverCandidates(candidates, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(ranked[0].weakestStarterProjection, 0);
  assert.equal(ranked[0].upgradeDelta, 18);
});

test('rankWaiverCandidates: caps results at 25', () => {
  const candidates = Array.from({ length: 40 }, (_, i) => ({
    playerId: i + 1, name: `p${i + 1}`, position: 'WR', nflTeam: 'DAL', projection: i,
  }));
  const currentStarters = [{ playerId: 99, slot: 'WR', projection: 0 }];
  const ranked = rankWaiverCandidates(candidates, currentStarters, DEFAULT_ROSTER_SLOTS);
  assert.equal(ranked.length, 25);
  assert.equal(ranked[0].playerId, 40); // highest projection first
});
