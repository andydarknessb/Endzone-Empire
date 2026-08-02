const test = require('node:test');
const assert = require('node:assert/strict');

const outcomes = require('../../scripts/backtest/lib/outcomes');

/** A minimal cohort member, matching `cohort.buildCohort`'s member shape. */
function member(overrides = {}) {
  return {
    season: 2025,
    week: 5,
    gsisId: '00-0012345',
    playerId: 1,
    position: 'WR',
    team: 'KC',
    teamKey: 'KC',
    injuryStatus: null,
    onBye: false,
    isDefense: false,
    contradiction: null,
    ...overrides,
  };
}

function baseArgs(overrides = {}) {
  return {
    season: 2025,
    week: 5,
    members: [member()],
    pointsByPlayerId: new Map([[1, 12.4]]),
    presentInPrimaryByPlayerId: new Set([1]),
    presentInSecondaryByPlayerId: new Set([1]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Required-signal discipline
// ---------------------------------------------------------------------------

test('presentInPrimaryByPlayerId/presentInSecondaryByPlayerId are required, no default', () => {
  const args = baseArgs();
  assert.throws(
    () => outcomes.resolveCohortOutcomes({ ...args, presentInPrimaryByPlayerId: undefined }),
    /presentInPrimaryByPlayerId must be a Set/
  );
  assert.throws(
    () => outcomes.resolveCohortOutcomes({ ...args, presentInSecondaryByPlayerId: [1] }),
    /presentInSecondaryByPlayerId must be a Set/
  );
});

test('members must be an array', () => {
  assert.throws(
    () => outcomes.resolveCohortOutcomes({ ...baseArgs(), members: null }),
    /members must be an array/
  );
});

test('a duplicate playerId in members is refused', () => {
  const args = baseArgs({ members: [member({ playerId: 1 }), member({ playerId: 1, gsisId: '00-0099999' })] });
  assert.throws(() => outcomes.resolveCohortOutcomes(args), /appears twice/);
});

test('the 2026 quarantine applies here too', () => {
  assert.throws(
    () => outcomes.resolveCohortOutcomes({ ...baseArgs(), season: 2026 }),
    /quarantine boundary 2026/
  );
});

// ---------------------------------------------------------------------------
// The reconciliation, end to end
// ---------------------------------------------------------------------------

test('a human present in the pinned source is scored, and actualPoints carries the external value', () => {
  const result = outcomes.resolveCohortOutcomes(baseArgs());
  assert.equal(result.season, 2025);
  assert.equal(result.week, 5);
  assert.equal(result.members.length, 1);
  const m = result.members[0];
  assert.equal(m.outcomeStatus, 'scored');
  assert.equal(m.outcomeReason, null);
  assert.equal(m.actualPoints, 12.4);
  assert.equal(m.sensitivityPoints, 12.4);
  // The original cohort fields (injuryStatus, onBye, position, ...) survive
  // the spread untouched - controlCellEvaluator.rosterEntries needs them.
  assert.equal(m.injuryStatus, null);
  assert.equal(m.position, 'WR');
  assert.equal(m.onBye, false);
  assert.equal(result.actualPointsByPlayerId.get(1), 12.4);
});

test('absent from both pinned signals is a measured zero, not a gap', () => {
  const result = outcomes.resolveCohortOutcomes(baseArgs({
    pointsByPlayerId: new Map(),
    presentInPrimaryByPlayerId: new Set(),
    presentInSecondaryByPlayerId: new Set(),
  }));
  const m = result.members[0];
  assert.equal(m.outcomeStatus, 'zero-recorded');
  assert.equal(m.actualPoints, 0);
  assert.equal(m.sensitivityPoints, 0);
  assert.equal(result.actualPointsByPlayerId.get(1), 0);
});

test('a bye player (both signals absent) reads as a zero and stays flagged onBye', () => {
  const result = outcomes.resolveCohortOutcomes(baseArgs({
    members: [member({ onBye: true })],
    pointsByPlayerId: new Map(),
    presentInPrimaryByPlayerId: new Set(),
    presentInSecondaryByPlayerId: new Set(),
  }));
  const m = result.members[0];
  assert.equal(m.onBye, true);
  assert.equal(m.outcomeStatus, 'zero-recorded');
  assert.equal(m.actualPoints, 0);
});

test('team-attribution contradiction excludes the row and it is NOT in actualPointsByPlayerId', () => {
  const result = outcomes.resolveCohortOutcomes(baseArgs({
    teamContradictionByPlayerId: new Set([1]),
  }));
  const m = result.members[0];
  assert.equal(m.outcomeStatus, 'excluded');
  assert.equal(m.outcomeReason, 'ambiguous-team-contradiction');
  assert.equal(m.actualPoints, null);
  assert.equal(result.actualPointsByPlayerId.has(1), false);
  // But the sensitivity keeps the number that WAS available, for the labelled
  // re-inclusion analysis (prereg 4.3) - it is never guessed.
  assert.equal(m.sensitivityPoints, 12.4);
});

test('present in one signal only is ambiguous and excluded, with the sensitivity value preserved', () => {
  // This is the shape DEF is meant to exercise for real (two independent
  // pinned sources) - exercised here directly against the generic module.
  const result = outcomes.resolveCohortOutcomes(baseArgs({
    presentInSecondaryByPlayerId: new Set(), // only primary reports the row
  }));
  const m = result.members[0];
  assert.equal(m.outcomeStatus, 'excluded');
  assert.equal(m.outcomeReason, 'ambiguous-one-source-only');
  assert.equal(m.actualPoints, null);
  assert.equal(m.sensitivityPoints, 12.4);
  assert.equal(result.actualPointsByPlayerId.has(1), false);
});

test('an ambiguous row with genuinely no recoverable number has a null sensitivity too', () => {
  // presentInSecondary alone, with no points ever reported for this member -
  // nothing to put back even in the sensitivity.
  const result = outcomes.resolveCohortOutcomes(baseArgs({
    pointsByPlayerId: new Map(),
    presentInPrimaryByPlayerId: new Set(),
    presentInSecondaryByPlayerId: new Set([1]),
  }));
  const m = result.members[0];
  assert.equal(m.outcomeStatus, 'excluded');
  assert.equal(m.actualPoints, null);
  assert.equal(m.sensitivityPoints, null);
});

// ---------------------------------------------------------------------------
// DB agreement: QA only, never overturns the external value
// ---------------------------------------------------------------------------

test('DB agreement is QA-only: agree, disagree, and unchecked are all distinguished', () => {
  const agree = outcomes.resolveCohortOutcomes(baseArgs({ dbPointsByPlayerId: new Map([[1, 12.4]]) }));
  assert.equal(agree.members[0].dbAgrees, true);
  assert.equal(agree.members[0].actualPoints, 12.4, 'the pinned source is primary, unaffected by agreement');

  const disagree = outcomes.resolveCohortOutcomes(baseArgs({ dbPointsByPlayerId: new Map([[1, 3]]) }));
  assert.equal(disagree.members[0].dbAgrees, false);
  assert.equal(disagree.members[0].actualPoints, 12.4, 'a DB disagreement is a finding, not a correction');

  const unchecked = outcomes.resolveCohortOutcomes(baseArgs());
  assert.equal(unchecked.members[0].dbAgrees, null);
});

test('a DEF playerId with no dbPointsByPlayerId entry is "unchecked", never a false disagreement', () => {
  const def = member({
    playerId: 99, gsisId: null, position: 'DEF', teamKey: 'KC', isDefense: true,
  });
  const result = outcomes.resolveCohortOutcomes({
    season: 2025,
    week: 5,
    members: [def],
    pointsByPlayerId: new Map([[99, 8]]),
    presentInPrimaryByPlayerId: new Set([99]),
    presentInSecondaryByPlayerId: new Set([99]),
    // dbPointsByPlayerId omitted entirely, as the real wiring does for DEF.
  });
  const m = result.members[0];
  assert.equal(m.isDefense, true);
  assert.equal(m.outcomeStatus, 'scored');
  assert.equal(m.actualPoints, 8);
  assert.equal(m.dbAgrees, null);
});

// ---------------------------------------------------------------------------
// A whole cohort, and the tally
// ---------------------------------------------------------------------------

test('a mixed cohort resolves each member independently and the tally adds up', () => {
  const members = [
    member({ playerId: 1 }), // scored
    member({ playerId: 2, gsisId: '00-0022222' }), // zero-recorded
    member({ playerId: 3, gsisId: '00-0033333' }), // ambiguous
    member({
      playerId: 4, gsisId: null, position: 'DEF', teamKey: 'BUF', isDefense: true,
    }), // scored, DEF
  ];
  const result = outcomes.resolveCohortOutcomes({
    season: 2025,
    week: 5,
    members,
    pointsByPlayerId: new Map([[1, 10], [3, 5], [4, 7]]),
    presentInPrimaryByPlayerId: new Set([1, 3, 4]),
    presentInSecondaryByPlayerId: new Set([1, 4]), // 3 is one-source-only
    dbPointsByPlayerId: new Map([[1, 10], [2, 0]]),
  });
  assert.equal(result.members.length, 4);
  assert.equal(result.actualPointsByPlayerId.size, 3, 'player 3 is excluded, not scored');
  assert.deepEqual([...result.actualPointsByPlayerId.entries()].sort(), [[1, 10], [2, 0], [4, 7]]);
  assert.equal(result.counts.members, 4);
  assert.equal(result.counts.outcomeTally.scored, 2);
  assert.equal(result.counts.outcomeTally.zeroRecorded, 1);
  assert.equal(result.counts.outcomeTally.excluded['ambiguous-one-source-only'], 1);
  assert.equal(result.counts.outcomeTally.excluded['ambiguous-team-contradiction'], 0);
  assert.equal(result.counts.outcomeTally.dbUnchecked, 2, 'players 3 and 4 have no dbPoints entry at all');
});
