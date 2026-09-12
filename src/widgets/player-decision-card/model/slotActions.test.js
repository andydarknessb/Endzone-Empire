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

  test('swapEligible defaults true with no opened entry given (a pure listing read)', () => {
    const candidate = entry({ playerId: 2, eligibleSlots: ['BENCH', 'RB'] });
    const [result] = benchOptionsForSlot([candidate], 'RB');
    expect(result.swapEligible).toBe(true);
  });

  // Formal review round 2 (r1/r3): swapEligible routes through the SAME
  // isEligibleMove rule the row path uses, so it reflects the OPENED
  // player's own state too, not just the candidate's.
  test('swapEligible is false for every candidate when the opened player is locked, spent, or the league is unsettled', () => {
    const opened = entry({ playerId: 9, slot: 'RB', eligibleSlots: ['BENCH', 'RB'] });
    const candidate = entry({ playerId: 2, eligibleSlots: ['BENCH', 'RB'] });

    const lockedOpened = { ...opened, locked: true };
    expect(benchOptionsForSlot([lockedOpened, candidate], 'RB', { entry: lockedOpened })[0].swapEligible).toBe(false);

    const spentOpened = { ...opened, spent: true };
    expect(benchOptionsForSlot([spentOpened, candidate], 'RB', { entry: spentOpened })[0].swapEligible).toBe(false);

    expect(
      benchOptionsForSlot([opened, candidate], 'RB', { entry: opened, leagueUnsettled: true })[0].swapEligible
    ).toBe(false);
  });

  test('swapEligible is true for an ordinary eligible pairing', () => {
    const opened = entry({ playerId: 9, slot: 'RB', eligibleSlots: ['BENCH', 'RB'] });
    const candidate = entry({ playerId: 2, eligibleSlots: ['BENCH', 'RB'] });
    expect(benchOptionsForSlot([opened, candidate], 'RB', { entry: opened })[0].swapEligible).toBe(true);
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

  // Formal review finding f1(b)/r2: isEligibleMove (useSwapPlayers.js)
  // refuses a locked OR spent target outright, so Start must never offer a
  // slot whose only occupant is locked or spent.
  test('excludes a slot whose only occupant is locked', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB', 'FLEX'] });
    const lockedStarter = entry({ playerId: 9, slot: 'RB', locked: true });
    const openFlex = entry({ playerId: 10, slot: 'FLEX', locked: false });
    expect(startTargetSlots(bench, [bench, lockedStarter, openFlex])).toEqual(['FLEX']);
  });

  test('excludes a slot whose only occupant is spent', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB'] });
    const spentStarter = entry({ playerId: 9, slot: 'RB', spent: true });
    expect(startTargetSlots(bench, [bench, spentStarter])).toEqual([]);
  });

  test('an empty starting slot (no occupant row at all) is still offered', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB'] });
    expect(startTargetSlots(bench, [bench])).toEqual(['RB']);
  });

  test('refuses everything while the league is unsettled', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB'] });
    expect(startTargetSlots(bench, [bench], { leagueUnsettled: true })).toEqual([]);
  });

  test('refuses a starting-slot target in best ball', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB'] });
    expect(startTargetSlots(bench, [bench], { bestBall: true })).toEqual([]);
  });

  // r4: an IR source cannot displace a healthy starter, because the
  // starter's own eligibleSlots does not include IR - isEligibleMove's
  // reciprocal check refuses it the same way the row path would.
  test('an IR source cannot displace an occupant not itself IR-eligible', () => {
    const irEntry = entry({ playerId: 1, slot: 'IR', eligibleSlots: ['BENCH', 'IR', 'RB'] });
    const healthyStarter = entry({ playerId: 9, slot: 'RB', eligibleSlots: ['BENCH', 'RB'] });
    expect(startTargetSlots(irEntry, [irEntry, healthyStarter])).toEqual([]);
  });

  // r5: a slot type with TWO occupied instances, one locked and one not,
  // must still be offered - the round-1 single find() disabled the whole
  // slot type whenever the locked instance was found first.
  test('a slot type with one locked and one open instance is still offered', () => {
    const bench = entry({ playerId: 1, eligibleSlots: ['BENCH', 'RB'] });
    const lockedRb = entry({ playerId: 8, slot: 'RB', locked: true, eligibleSlots: ['BENCH', 'RB'] });
    const openRb = entry({ playerId: 9, slot: 'RB', locked: false, eligibleSlots: ['BENCH', 'RB'] });
    expect(startTargetSlots(bench, [bench, lockedRb, openRb])).toEqual(['RB']);
  });
});

describe('movesToStart', () => {
  test('swaps with the current occupant of the target slot', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'RB'] });
    const starter = entry({ playerId: 9, slot: 'RB', eligibleSlots: ['BENCH', 'RB'] });
    expect(movesToStart(bench, 'RB', [bench, starter])).toEqual([
      { playerId: 2, slot: 'RB' },
      { playerId: 9, slot: 'BENCH' },
    ]);
  });

  test('a bare one-way move when nothing occupies the target slot', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'RB'] });
    expect(movesToStart(bench, 'RB', [bench])).toEqual([{ playerId: 2, slot: 'RB' }]);
  });

  // r5: picks the eligible instance among several occupants, not just the
  // first one found.
  test('picks the eligible occupant when a slot type has more than one instance', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'RB'] });
    const lockedRb = entry({ playerId: 8, slot: 'RB', locked: true, eligibleSlots: ['BENCH', 'RB'] });
    const openRb = entry({ playerId: 9, slot: 'RB', locked: false, eligibleSlots: ['BENCH', 'RB'] });
    expect(movesToStart(bench, 'RB', [bench, lockedRb, openRb])).toEqual([
      { playerId: 2, slot: 'RB' },
      { playerId: 9, slot: 'BENCH' },
    ]);
  });

  test('an empty move list when no occupant is actually eligible (defensive - callers filter via startTargetSlots first)', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'RB'] });
    const lockedRb = entry({ playerId: 8, slot: 'RB', locked: true, eligibleSlots: ['BENCH', 'RB'] });
    expect(movesToStart(bench, 'RB', [bench, lockedRb])).toEqual([]);
  });
});
