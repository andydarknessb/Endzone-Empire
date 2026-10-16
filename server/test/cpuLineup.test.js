const test = require('node:test');
const assert = require('node:assert/strict');
const { planCpuLineup, openSlots } = require('../services/cpuLineup.service');
const { notify } = require('../services/activity.service');

// The CPU manager's planner is pure: entries plus projections in, slot moves
// out. Held players (kicked off) never move, unavailable players never start,
// IR is never touched, and a lineup already optimal yields no moves.

const SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR'] },
];

const points = (table) => (playerId) => table[playerId] || {};

test('starts the best legal lineup and benches the rest', () => {
  const entries = [
    { playerId: 1, position: 'QB', slot: 'QB', locked: false },
    { playerId: 2, position: 'RB', slot: 'RB', locked: false }, // 5 pts
    { playerId: 3, position: 'RB', slot: 'BENCH', locked: false }, // 20 pts
    { playerId: 4, position: 'WR', slot: 'BENCH', locked: false }, // 18 pts
  ];
  const moves = planCpuLineup({
    entries,
    rosterSlots: SLOTS,
    pointsOf: points({ 1: { points: 15 }, 2: { points: 5 }, 3: { points: 20 }, 4: { points: 18 } }),
  });
  const after = new Map(entries.map((e) => [e.playerId, e.slot]));
  for (const move of moves) after.set(move.playerId, move.slot);
  assert.equal(after.get(1), 'QB');
  assert.equal(after.get(2), 'BENCH');
  assert.deepEqual(new Set([after.get(3), after.get(4)]), new Set(['RB', 'FLEX']));
});

test('an unavailable starter (out, bye) is benched; a locked one keeps his slot', () => {
  const entries = [
    { playerId: 1, position: 'QB', slot: 'QB', locked: true }, // kicked off: stays
    { playerId: 2, position: 'RB', slot: 'RB', locked: false }, // out
    { playerId: 3, position: 'RB', slot: 'BENCH', locked: false },
  ];
  const moves = planCpuLineup({
    entries,
    rosterSlots: SLOTS,
    pointsOf: points({ 1: { points: 1 }, 2: { unavailable: true }, 3: { points: 9 } }),
  });
  assert.ok(!moves.some((m) => m.playerId === 1), 'a locked player never moves');
  assert.deepEqual(moves.find((m) => m.playerId === 2), { playerId: 2, slot: 'BENCH' });
  assert.ok(['RB', 'FLEX'].includes(moves.find((m) => m.playerId === 3).slot));
});

test('IR is never touched, and an optimal lineup yields no moves', () => {
  const entries = [
    { playerId: 1, position: 'QB', slot: 'QB', locked: false },
    { playerId: 2, position: 'RB', slot: 'RB', locked: false },
    { playerId: 3, position: 'WR', slot: 'FLEX', locked: false },
    { playerId: 4, position: 'RB', slot: 'IR', locked: false },
  ];
  const moves = planCpuLineup({
    entries,
    rosterSlots: SLOTS,
    pointsOf: points({ 1: { points: 10 }, 2: { points: 10 }, 3: { points: 10 }, 4: { points: 99 } }),
  });
  assert.deepEqual(moves, []);
});

test('a seat a departed player already played in is not offered again', () => {
  const slots = openSlots(SLOTS, [{ slot: 'RB' }, { slot: 'GONE' }]);
  assert.deepEqual(slots.map((s) => [s.key, s.count]), [['QB', 1], ['RB', 0], ['FLEX', 1]]);
  const moves = planCpuLineup({
    entries: [
      { playerId: 3, position: 'RB', slot: 'BENCH', locked: false },
      { playerId: 4, position: 'RB', slot: 'BENCH', locked: false },
    ],
    rosterSlots: slots,
    pointsOf: points({ 3: { points: 20 }, 4: { points: 10 } }),
  });
  assert.deepEqual(moves, [{ playerId: 3, slot: 'FLEX' }], 'only FLEX is open; the spent RB seat stays empty');
});

test('notify to a CPU team (null user) is a no-op, not a NOT NULL violation', async () => {
  const calls = [];
  await notify({ query: async (...args) => calls.push(args) }, { userId: null, type: 'league', message: 'x' });
  assert.equal(calls.length, 0);
});
