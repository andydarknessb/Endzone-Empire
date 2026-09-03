const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  fillsStartingNeed,
  openStartingNeeds,
  startersFilled,
  KICKER_DEFENSE_WINDOW_ROUNDS,
} = require('../services/startingNeed');

/**
 * Starting need (CONTEXT.md) is computed as maximum bipartite matching between
 * a team's drafted players and its starting-slot INSTANCES, the unweighted twin
 * of src/lib/rosterAssignment.js's matchStarters. These tests pin the two things
 * a greedy scan gets wrong (overlapping, non-nested slot eligibility) and the
 * FLEX behaviour the autopick need phase leans on.
 *
 * The overlap cases are the two counterexamples quoted in rosterAssignment.js's
 * docblock. They each seat TWO starters; a greedy first-fit (claim the first
 * eligible free slot, never re-home an incumbent) strands one of the two and
 * reports ONE. So replacing maxStartersMatched's augmenting search with a
 * first-fit is a red test here, which is the whole reason the matching exists.
 */

// [IDP FLEX(DL/LB/DB), LB] + picks LB, DL. Free-first greedy: LB takes IDP FLEX,
// DL is stranded -> 1. Exact: LB -> LB, DL -> IDP FLEX -> 2.
const IDP_FLEX_THEN_LB = [
  { key: 'IDP FLEX', label: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] },
  { key: 'LB', label: 'LB', count: 1, eligiblePositions: ['LB'] },
];

// [DL/LB, LB/DB] + picks LB, DL. Most-restrictive-first greedy also fails: the
// eligibility sets overlap without nesting, so LB takes DL/LB and DL is stranded.
const OVERLAPPING_NON_NESTED = [
  { key: 'S1', label: 'DL/LB', count: 1, eligiblePositions: ['DL', 'LB'] },
  { key: 'S2', label: 'LB/DB', count: 1, eligiblePositions: ['LB', 'DB'] },
];

// A MinneApple-shaped starting shape (QB, RBx2, WRx2, TE, FLEX, K, DEF).
const MINNEAPPLE_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

test('overlap counterexample [IDP FLEX(DL/LB/DB), LB] + LB, DL seats two starters', () => {
  assert.equal(startersFilled({ rosterSlots: IDP_FLEX_THEN_LB, roster: ['LB', 'DL'] }), 2);
  assert.equal(openStartingNeeds({ rosterSlots: IDP_FLEX_THEN_LB, roster: ['LB', 'DL'] }), 0);
});

test('overlap counterexample [DL/LB, LB/DB] + LB, DL seats two starters', () => {
  assert.equal(startersFilled({ rosterSlots: OVERLAPPING_NON_NESTED, roster: ['LB', 'DL'] }), 2);
});

test('a third RB fills a need only while FLEX is open', () => {
  const rosterSlots = [
    { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
    { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ];
  // Two RBs fill RB1, RB2; the third takes the still-open FLEX.
  assert.equal(fillsStartingNeed({ rosterSlots, roster: ['RB', 'RB'], candidatePosition: 'RB' }), true);
  // With a WR already in FLEX, the third RB has nowhere to go.
  assert.equal(fillsStartingNeed({ rosterSlots, roster: ['RB', 'RB', 'WR'], candidatePosition: 'RB' }), false);
});

test('the MinneApple wedge: a TE fills a need over a fourth QB', () => {
  const roster = ['QB', 'QB', 'QB'];
  // Only one QB seats (one QB slot, no QB-eligible flex), so two QBs sit idle
  // and the TE slot is open.
  assert.equal(startersFilled({ rosterSlots: MINNEAPPLE_SLOTS, roster }), 1);
  assert.equal(fillsStartingNeed({ rosterSlots: MINNEAPPLE_SLOTS, roster, candidatePosition: 'TE' }), true);
  assert.equal(fillsStartingNeed({ rosterSlots: MINNEAPPLE_SLOTS, roster, candidatePosition: 'QB' }), false);
});

test('an empty roster_slots list means nothing can fill a need', () => {
  assert.equal(startersFilled({ rosterSlots: [], roster: [] }), 0);
  assert.equal(openStartingNeeds({ rosterSlots: [], roster: [] }), 0);
  assert.equal(fillsStartingNeed({ rosterSlots: [], roster: [], candidatePosition: 'RB' }), false);
});

test('IDP group keys behave as lineup validation does (a CB fills a DB slot)', () => {
  const rosterSlots = [{ key: 'DB', label: 'DB', count: 1, eligiblePositions: ['DB'] }];
  assert.equal(fillsStartingNeed({ rosterSlots, roster: [], candidatePosition: 'CB' }), true);
  // Once the lone DB slot is taken, another CB fills nothing.
  assert.equal(fillsStartingNeed({ rosterSlots, roster: ['CB'], candidatePosition: 'CB' }), false);
});

test('roster entries may be position strings or objects carrying a position', () => {
  const rosterSlots = [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }];
  assert.equal(startersFilled({ rosterSlots, roster: [{ position: 'QB' }] }), 1);
  assert.equal(fillsStartingNeed({ rosterSlots, roster: [{ position: 'QB' }], candidatePosition: 'QB' }), false);
});

test('a candidate with no position fills nothing', () => {
  const rosterSlots = [{ key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] }];
  assert.equal(fillsStartingNeed({ rosterSlots, roster: [], candidatePosition: null }), false);
  assert.equal(fillsStartingNeed({ rosterSlots, roster: [], candidatePosition: undefined }), false);
});

test('the kicker/defense window constant is three rounds', () => {
  assert.equal(KICKER_DEFENSE_WINDOW_ROUNDS, 3);
});
