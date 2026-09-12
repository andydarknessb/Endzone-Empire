import { benchOptionsForSlot, movesToStart, startTargetSlots } from './slotActions';

const entry = (over = {}) => ({
  playerId: 1,
  name: 'Player',
  position: 'RB',
  nflTeam: 'BUF',
  slot: 'BENCH',
  projection: 10,
  eligibleSlots: ['BENCH'],
  locked: false,
  spent: false,
  ...over,
});

describe('benchOptionsForSlot', () => {
  test('empty for a null, BENCH or IR slot - no starting slot to fill', () => {
    expect(benchOptionsForSlot([entry()], null)).toEqual([]);
    expect(benchOptionsForSlot([entry()], 'BENCH')).toEqual([]);
    expect(benchOptionsForSlot([entry()], 'IR')).toEqual([]);
  });

  test('only bench entries eligible for the slot, unspent, are candidates', () => {
    const eligible = entry({ playerId: 2, eligibleSlots: ['BENCH', 'RB'] });
    const ineligible = entry({ playerId: 3, eligibleSlots: ['BENCH', 'WR'] });
    const starter = entry({ playerId: 4, slot: 'RB', eligibleSlots: ['BENCH', 'RB'] });
    const spent = entry({ playerId: 5, eligibleSlots: ['BENCH', 'RB'], spent: true });
    const result = benchOptionsForSlot([eligible, ineligible, starter, spent], 'RB');
    expect(result.map((r) => r.entry.playerId)).toEqual([2]);
  });

  test('sorts by projection descending, a null projection sorting last', () => {
    const a = entry({ playerId: 2, eligibleSlots: ['BENCH', 'RB'], projection: 5 });
    const b = entry({ playerId: 3, eligibleSlots: ['BENCH', 'RB'], projection: 12 });
    const c = entry({ playerId: 4, eligibleSlots: ['BENCH', 'RB'], projection: null });
    const result = benchOptionsForSlot([a, b, c], 'RB');
    expect(result.map((r) => r.entry.playerId)).toEqual([3, 2, 4]);
  });

  test('marks a locked candidate', () => {
    const candidate = entry({ playerId: 2, eligibleSlots: ['BENCH', 'RB'], locked: true });
    const [result] = benchOptionsForSlot([candidate], 'RB');
    expect(result.locked).toBe(true);
  });
});

describe('startTargetSlots', () => {
  test('every eligible slot minus BENCH and IR', () => {
    expect(startTargetSlots(entry({ eligibleSlots: ['BENCH', 'IR', 'RB', 'FLEX'] }), [])).toEqual(['RB', 'FLEX']);
  });

  test('empty for a missing entry or eligibleSlots', () => {
    expect(startTargetSlots(null, [])).toEqual([]);
    expect(startTargetSlots({}, [])).toEqual([]);
  });

  // Formal review finding f1(b): isEligibleTarget (useSwapPlayers.js) refuses
  // a locked TARGET outright, so Start must never offer a slot whose current
  // occupant is locked - a red-tell for the bug the review found (an earlier
  // revision offered it regardless).
  test('excludes a slot whose current occupant is locked', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB', 'FLEX'] });
    const lockedStarter = entry({ playerId: 9, slot: 'RB', locked: true });
    const openFlex = entry({ playerId: 10, slot: 'FLEX', locked: false });
    expect(startTargetSlots(bench, [bench, lockedStarter, openFlex])).toEqual(['FLEX']);
  });

  test('an empty starting slot (no occupant row at all) is still offered', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB'] });
    expect(startTargetSlots(bench, [bench])).toEqual(['RB']);
  });
});

describe('movesToStart', () => {
  test('swaps with the current occupant of the target slot', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH' });
    const starter = entry({ playerId: 9, slot: 'RB' });
    expect(movesToStart(bench, 'RB', [bench, starter])).toEqual([
      { playerId: 2, slot: 'RB' },
      { playerId: 9, slot: 'BENCH' },
    ]);
  });

  test('a bare one-way move when nothing occupies the target slot', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH' });
    expect(movesToStart(bench, 'RB', [bench])).toEqual([{ playerId: 2, slot: 'RB' }]);
  });
});
