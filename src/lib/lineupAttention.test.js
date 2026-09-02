import { lineupAttention, DEFAULT_STARTER_SLOT_ORDER } from './lineupAttention';

// A standard 9-starter roster shape (matches lineup.service DEFAULT_ROSTER_SLOTS
// keys/counts), used as the required-slots config in most cases below.
const STANDARD_SLOTS = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
  { key: 'TE', count: 1 },
  { key: 'FLEX', count: 1 },
  { key: 'K', count: 1 },
  { key: 'DEF', count: 1 },
];

// One entry per starting slot instance of STANDARD_SLOTS, none on bye.
const fullStarterEntries = () => [
  { slot: 'QB', onBye: false },
  { slot: 'RB', onBye: false },
  { slot: 'RB', onBye: false },
  { slot: 'WR', onBye: false },
  { slot: 'WR', onBye: false },
  { slot: 'TE', onBye: false },
  { slot: 'FLEX', onBye: false },
  { slot: 'K', onBye: false },
  { slot: 'DEF', onBye: false },
];

describe('lineupAttention', () => {
  test('a full, bye-free starting lineup has no empty slots and nobody on bye', () => {
    const result = lineupAttention({ rosterSlots: STANDARD_SLOTS, entries: fullStarterEntries() });
    expect(result.emptyStarterSlots).toBe(0);
    expect(result.startersOnBye).toEqual([]);
  });

  test('counts every unfilled starting-slot instance, summed across slots', () => {
    // Drop one RB (a 2-count slot leaves 1 empty) and the DEF (1 empty): 2 total.
    const entries = fullStarterEntries().filter(
      (e, i) => !(e.slot === 'RB' && i === 2) && e.slot !== 'DEF'
    );
    const result = lineupAttention({ rosterSlots: STANDARD_SLOTS, entries });
    expect(result.emptyStarterSlots).toBe(2);
  });

  test('returns each starter flagged on bye, and only starters', () => {
    const entries = [
      ...fullStarterEntries().map((e, i) => (i === 0 ? { ...e, name: 'QB1', onBye: true } : e)),
      // A benched player on bye must NOT count: BENCH is not a starting slot.
      { slot: 'BENCH', onBye: true, name: 'Benchwarmer' },
    ];
    const result = lineupAttention({ rosterSlots: STANDARD_SLOTS, entries });
    expect(result.startersOnBye).toHaveLength(1);
    expect(result.startersOnBye[0].name).toBe('QB1');
  });

  test('a slot the roster does not fill at all counts as its full required width', () => {
    // No RB entries at all: the 2-count RB slot is 2 empty.
    const entries = fullStarterEntries().filter((e) => e.slot !== 'RB');
    const result = lineupAttention({ rosterSlots: STANDARD_SLOTS, entries });
    expect(result.emptyStarterSlots).toBe(2);
  });

  test('empty inputs are safe: no slots, no entries', () => {
    expect(lineupAttention({ rosterSlots: [], entries: [] })).toEqual({
      emptyStarterSlots: 0,
      startersOnBye: [],
    });
    expect(lineupAttention()).toEqual({ emptyStarterSlots: 0, startersOnBye: [] });
  });

  test('with no roster_slots config, empty-slot count is 0 but byes are still read via the default starter order', () => {
    // No required-slots config (a loading or legacy league): nothing to compare a
    // fill against, so emptyStarterSlots is 0; a starter on bye is still found by
    // the default starter slot keys.
    const entries = [
      { slot: 'QB', onBye: true, name: 'Bye QB' },
      { slot: 'BENCH', onBye: true, name: 'Bench' },
    ];
    const result = lineupAttention({ rosterSlots: [], entries });
    expect(result.emptyStarterSlots).toBe(0);
    expect(result.startersOnBye.map((e) => e.name)).toEqual(['Bye QB']);
  });

  test('a custom roster shape (non-default keys) is honored for both signals', () => {
    // A league with a keyed 'SFLX' slot and no K/DEF. Only the configured slots
    // define starters, so a DEF entry (not a slot here) is neither filled nor
    // on-bye-counted.
    const slots = [
      { key: 'QB', count: 1 },
      { key: 'SFLX', count: 2 },
    ];
    const entries = [
      { slot: 'QB', onBye: true, name: 'QB1' },
      { slot: 'SFLX', onBye: false },
      // second SFLX missing -> 1 empty
      { slot: 'DEF', onBye: true, name: 'not a starter here' },
    ];
    const result = lineupAttention({ rosterSlots: slots, entries });
    expect(result.emptyStarterSlots).toBe(1);
    expect(result.startersOnBye.map((e) => e.name)).toEqual(['QB1']);
  });

  test('exposes the standard starter order it falls back to', () => {
    expect(DEFAULT_STARTER_SLOT_ORDER).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
  });
});
