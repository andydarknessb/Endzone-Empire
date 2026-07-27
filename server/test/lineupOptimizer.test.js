const test = require('node:test');
const assert = require('node:assert/strict');
const {
  expandSlotInstances,
  minCostAssignment,
  optimalAssignment,
  buildSwapSuggestions,
} = require('../services/lineupOptimizer');
const { DEFAULT_ROSTER_SLOTS, slotEligible } = require('../services/lineup.service');

const SLOTS_RB_FLEX = [
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
];

/**
 * The recommender this optimizer replaces, reproduced faithfully so the
 * counterexample below is a claim about the OLD code rather than a strawman:
 * walk each starting slot in lineup order and offer it the best eligible bench
 * player not already spoken for.
 */
function legacyGreedySuggestions(entries, points, rosterSlots) {
  const starters = entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR');
  const bench = entries.filter((e) => e.slot === 'BENCH');
  const used = new Set();
  let total = starters.reduce((sum, s) => sum + (points.get(s.playerId) || 0), 0);
  for (const starter of starters) {
    let best = null;
    for (const candidate of bench) {
      if (used.has(candidate.playerId)) continue;
      if (!slotEligible(starter.slot, candidate.position, rosterSlots)) continue;
      if (!best || (points.get(candidate.playerId) || 0) > (points.get(best.playerId) || 0)) {
        best = candidate;
      }
    }
    if (best && (points.get(best.playerId) || 0) > (points.get(starter.playerId) || 0)) {
      used.add(best.playerId);
      total += (points.get(best.playerId) || 0) - (points.get(starter.playerId) || 0);
    }
  }
  return total;
}

test('expandSlotInstances expands repeated slots in order', () => {
  const instances = expandSlotInstances(DEFAULT_ROSTER_SLOTS);
  assert.deepEqual(
    instances.map((s) => `${s.key}${s.index}`),
    ['QB0', 'RB0', 'RB1', 'WR0', 'WR1', 'TE0', 'FLEX0', 'K0', 'DEF0']
  );
});

test('minCostAssignment finds the true minimum, not a greedy one', () => {
  // Greedy on row 0 picks column 0 (cost 1) and forces row 1 into cost 100.
  const cost = [
    [1, 2],
    [100, 3],
  ];
  assert.deepEqual(minCostAssignment(cost), [0, 1]); // 1 + 3 = 4, the optimum
});

// ---------------------------------------------------------------------------
// The counterexample the greedy scan gets wrong
// ---------------------------------------------------------------------------

test('exact optimizer beats the greedy FLEX scan on the classic counterexample', () => {
  // FLEX is eligible for the best bench RB, so a per-slot greedy walk can
  // consume him there and leave the RB-only slot stuck with its incumbent.
  const entries = [
    { playerId: 1, name: 'FLEX incumbent', position: 'WR', slot: 'FLEX' },
    { playerId: 2, name: 'RB incumbent', position: 'RB', slot: 'RB' },
    { playerId: 3, name: 'Bench RB', position: 'RB', slot: 'BENCH' },
    { playerId: 4, name: 'Bench WR', position: 'WR', slot: 'BENCH' },
  ];
  const points = new Map([[1, 3], [2, 5], [3, 20], [4, 18]]);

  const greedyTotal = legacyGreedySuggestions(entries, points, SLOTS_RB_FLEX);
  assert.equal(greedyTotal, 25, 'greedy: bench RB into FLEX, RB slot keeps its 5-point incumbent');

  const optimal = optimalAssignment({
    rosterSlots: SLOTS_RB_FLEX,
    candidates: entries.map((e) => ({ playerId: e.playerId, position: e.position })),
    pointsFor: points,
  });
  assert.equal(optimal.total, 38, 'exact: RB 20 at RB, WR 18 at FLEX');
  assert.ok(optimal.total > greedyTotal);
  assert.equal(optimal.byPlayer.get(3), 'RB');
  assert.equal(optimal.byPlayer.get(4), 'FLEX');
});

test('the counterexample produces two applicable one-for-one swaps', () => {
  const entries = [
    { playerId: 1, name: 'FLEX incumbent', position: 'WR', slot: 'FLEX' },
    { playerId: 2, name: 'RB incumbent', position: 'RB', slot: 'RB' },
    { playerId: 3, name: 'Bench RB', position: 'RB', slot: 'BENCH' },
    { playerId: 4, name: 'Bench WR', position: 'WR', slot: 'BENCH' },
  ];
  const points = new Map([[1, 3], [2, 5], [3, 20], [4, 18]]);
  const optimal = optimalAssignment({
    rosterSlots: SLOTS_RB_FLEX,
    candidates: entries.map((e) => ({ playerId: e.playerId, position: e.position })),
    pointsFor: points,
  });
  const { swaps } = buildSwapSuggestions({
    entries,
    optimalAssignments: optimal.assignments,
    optimalByPlayer: optimal.byPlayer,
    projectionOf: (id) => ({ points: points.get(id) ?? null }),
    startingSlots: new Set(['RB', 'FLEX']),
  });
  assert.deepEqual(
    swaps.map((s) => [s.slot, s.out.playerId, s.in.playerId]),
    [['RB', 2, 3], ['FLEX', 1, 4]]
  );
  // Applying both reproduces the optimizer's own answer exactly.
  const applied = swaps.reduce((sum, s) => sum + points.get(s.in.playerId), 0);
  assert.equal(applied, 38);
});

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

test('no player is assigned to two slots and no player appears twice in the plan', () => {
  const entries = [
    { playerId: 1, name: 'A', position: 'RB', slot: 'RB' },
    { playerId: 2, name: 'B', position: 'RB', slot: 'RB' },
    { playerId: 3, name: 'C', position: 'RB', slot: 'BENCH' },
    { playerId: 4, name: 'D', position: 'WR', slot: 'BENCH' },
  ];
  const points = new Map([[1, 4], [2, 6], [3, 30], [4, 25]]);
  const optimal = optimalAssignment({
    rosterSlots: DEFAULT_ROSTER_SLOTS,
    candidates: entries.map((e) => ({ playerId: e.playerId, position: e.position })),
    pointsFor: points,
  });
  const assigned = optimal.assignments.filter((a) => a.playerId != null).map((a) => a.playerId);
  assert.equal(new Set(assigned).size, assigned.length);

  const { swaps, fills } = buildSwapSuggestions({
    entries,
    optimalAssignments: optimal.assignments,
    optimalByPlayer: optimal.byPlayer,
    projectionOf: (id) => ({ points: points.get(id) ?? null }),
    startingSlots: new Set(['RB']),
  });
  const recommended = [...swaps.map((s) => s.in.playerId), ...fills.map((f) => f.in.playerId)];
  assert.equal(new Set(recommended).size, recommended.length);
});

test('locked starters keep their exact slot and never enter the assignment', () => {
  const points = new Map([[1, 2], [2, 30]]);
  const optimal = optimalAssignment({
    rosterSlots: SLOTS_RB_FLEX,
    candidates: [{ playerId: 2, position: 'RB' }],
    pointsFor: points,
    pinned: new Map([[1, 'RB']]),
  });
  const rbSlot = optimal.assignments.find((a) => a.slotKey === 'RB');
  assert.equal(rbSlot.playerId, 1, 'a locked starter cannot be moved by advice');
  assert.equal(rbSlot.locked, true);
  assert.equal(optimal.byPlayer.get(2), 'FLEX', 'the better RB takes the only slot still open');
  assert.equal(optimal.total, 32);
});

test('a locked starter is never swapped out even when someone projects far higher', () => {
  const entries = [
    { playerId: 1, name: 'Locked', position: 'RB', slot: 'RB', locked: true },
    { playerId: 2, name: 'Bench star', position: 'RB', slot: 'BENCH' },
  ];
  const points = new Map([[1, 2], [2, 30]]);
  const optimal = optimalAssignment({
    rosterSlots: [{ key: 'RB', count: 1, eligiblePositions: ['RB'] }],
    candidates: [{ playerId: 2, position: 'RB' }],
    pointsFor: points,
    pinned: new Map([[1, 'RB']]),
  });
  const { swaps } = buildSwapSuggestions({
    entries,
    optimalAssignments: optimal.assignments,
    optimalByPlayer: optimal.byPlayer,
    projectionOf: (id) => ({ points: points.get(id) ?? null }),
    startingSlots: new Set(['RB']),
  });
  assert.deepEqual(swaps, []);
});

test('an empty starting slot is filled, and reported as a fill rather than a swap', () => {
  const entries = [
    { playerId: 1, name: 'RB starter', position: 'RB', slot: 'RB' },
    { playerId: 2, name: 'Bench WR', position: 'WR', slot: 'BENCH' },
  ];
  const points = new Map([[1, 10], [2, 12]]);
  const optimal = optimalAssignment({
    rosterSlots: SLOTS_RB_FLEX,
    candidates: entries.map((e) => ({ playerId: e.playerId, position: e.position })),
    pointsFor: points,
  });
  const { swaps, fills } = buildSwapSuggestions({
    entries,
    optimalAssignments: optimal.assignments,
    optimalByPlayer: optimal.byPlayer,
    projectionOf: (id) => ({ points: points.get(id) ?? null }),
    startingSlots: new Set(['RB']),
  });
  assert.deepEqual(swaps, []);
  assert.deepEqual(fills.map((f) => [f.slot, f.in.playerId]), [['FLEX', 2]]);
});

test('SUPERFLEX takes a QB and a dedicated QB slot is not double-filled', () => {
  const slots = [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'SUPERFLEX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
  ];
  const points = new Map([[1, 22], [2, 19], [3, 14]]);
  const optimal = optimalAssignment({
    rosterSlots: slots,
    candidates: [
      { playerId: 1, position: 'QB' },
      { playerId: 2, position: 'QB' },
      { playerId: 3, position: 'RB' },
    ],
    pointsFor: points,
  });
  assert.equal(optimal.total, 41);
  assert.equal(optimal.byPlayer.get(1), 'QB');
  assert.equal(optimal.byPlayer.get(2), 'SUPERFLEX');
});

test('a DP slot accepts any member of its defensive groups', () => {
  const slots = [{ key: 'DP', count: 2, eligiblePositions: ['DL', 'LB', 'DB'] }];
  const points = new Map([[1, 12], [2, 9], [3, 15]]);
  const optimal = optimalAssignment({
    rosterSlots: slots,
    candidates: [
      { playerId: 1, position: 'ILB' },
      { playerId: 2, position: 'CB' },
      { playerId: 3, position: 'DE' },
    ],
    pointsFor: points,
  });
  assert.equal(optimal.total, 27, 'the two best individual defenders start');
  assert.equal(optimal.byPlayer.has(2), false);
});

test('an ineligible player is never assigned, even when a slot would go empty', () => {
  const optimal = optimalAssignment({
    rosterSlots: [{ key: 'K', count: 1, eligiblePositions: ['K'] }],
    candidates: [{ playerId: 1, position: 'WR' }],
    pointsFor: new Map([[1, 40]]),
  });
  assert.equal(optimal.assignments[0].playerId, null);
  assert.equal(optimal.total, 0);
});

test('a negative projection leaves the slot empty rather than scoring below zero', () => {
  // DST and IDP weeks are genuinely negative; an empty slot scores exactly 0.
  const optimal = optimalAssignment({
    rosterSlots: [{ key: 'DEF', count: 1, eligiblePositions: ['DEF'] }],
    candidates: [{ playerId: 1, position: 'DEF' }],
    pointsFor: new Map([[1, -4]]),
  });
  assert.equal(optimal.assignments[0].playerId, null);
  assert.equal(optimal.total, 0);
});

test('a player with no projection is never recommended', () => {
  const entries = [
    { playerId: 1, name: 'Starter', position: 'RB', slot: 'RB' },
    { playerId: 2, name: 'Unknown', position: 'RB', slot: 'BENCH' },
  ];
  const optimal = optimalAssignment({
    rosterSlots: [{ key: 'RB', count: 1, eligiblePositions: ['RB'] }],
    candidates: entries.map((e) => ({ playerId: e.playerId, position: e.position })),
    pointsFor: new Map([[1, 0]]),
  });
  const { swaps, fills } = buildSwapSuggestions({
    entries,
    optimalAssignments: optimal.assignments,
    optimalByPlayer: optimal.byPlayer,
    projectionOf: (id) => (id === 1 ? { points: 0 } : { points: null }),
    startingSlots: new Set(['RB']),
  });
  assert.deepEqual(swaps, []);
  assert.deepEqual(fills, []);
});

test('optimalAssignment is deterministic across repeated runs', () => {
  const candidates = Array.from({ length: 14 }, (_, i) => ({
    playerId: i + 1,
    position: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'][i % 6],
  }));
  const pointsFor = new Map(candidates.map((c, i) => [c.playerId, ((i * 7) % 23) + 1]));
  const first = optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor });
  const second = optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor });
  assert.deepEqual(first.assignments, second.assignments);
});
