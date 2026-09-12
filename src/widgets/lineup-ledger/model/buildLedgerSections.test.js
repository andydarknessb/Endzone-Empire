import { buildLedgerSections } from './buildLedgerSections';

const entry = (overrides = {}) => ({
  playerId: 1,
  name: 'Player',
  slot: 'QB',
  projection: 10,
  availability: { available: true, reason: null },
  ...overrides,
});

const rosterSlots = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
];

test('builds one starter row per configured slot instance, filled in order, empty after', () => {
  const entries = [
    entry({ playerId: 1, slot: 'QB' }),
    entry({ playerId: 2, slot: 'RB' }),
  ];
  const { starters } = buildLedgerSections({ entries, rosterSlots, benchSlots: 0, irSlots: 0 });
  expect(starters).toHaveLength(3);
  expect(starters[0]).toMatchObject({ slotType: 'QB', slotLabel: 'QB', entry: entries[0] });
  expect(starters[1]).toMatchObject({ slotType: 'RB', slotLabel: 'RB 1', entry: entries[1] });
  expect(starters[2]).toMatchObject({ slotType: 'RB', slotLabel: 'RB 2', entry: null });
});

test('BENCH and IR never appear among starter rows even if named in rosterSlots', () => {
  const slots = [...rosterSlots, { key: 'BENCH', count: 5 }, { key: 'IR', count: 1 }];
  const { starters } = buildLedgerSections({ entries: [], rosterSlots: slots, benchSlots: 5, irSlots: 1 });
  expect(starters.every((r) => r.slotType !== 'BENCH' && r.slotType !== 'IR')).toBe(true);
});

test('builds one IR row per irSlots, filled from IR entries', () => {
  const entries = [entry({ playerId: 9, slot: 'IR' })];
  const { ir } = buildLedgerSections({ entries, rosterSlots, benchSlots: 0, irSlots: 2 });
  expect(ir).toHaveLength(2);
  expect(ir[0].entry).toBe(entries[0]);
  expect(ir[1].entry).toBeNull();
});

test('bench sorts available players by projection descending', () => {
  const entries = [
    entry({ playerId: 1, slot: 'BENCH', projection: 5 }),
    entry({ playerId: 2, slot: 'BENCH', projection: 15 }),
    entry({ playerId: 3, slot: 'BENCH', projection: 10 }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 3, irSlots: 0 });
  expect(bench.map((r) => r.entry.playerId)).toEqual([2, 3, 1]);
});

test('Unavailable bench players sort after every available one, regardless of projection', () => {
  const entries = [
    entry({ playerId: 1, slot: 'BENCH', projection: 20, availability: { available: false, reason: 'out' } }),
    entry({ playerId: 2, slot: 'BENCH', projection: 1 }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 2, irSlots: 0 });
  expect(bench.map((r) => r.entry.playerId)).toEqual([2, 1]);
});

test('an unknown (null) projection sorts last among available bench players, never throwing', () => {
  const entries = [
    entry({ playerId: 1, slot: 'BENCH', projection: null }),
    entry({ playerId: 2, slot: 'BENCH', projection: 5 }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 2, irSlots: 0 });
  expect(bench.map((r) => r.entry.playerId)).toEqual([2, 1]);
});

test('bench rows pad up to benchSlots, and never fewer than the occupied bench count (overflow)', () => {
  const entries = [entry({ playerId: 1, slot: 'BENCH' }), entry({ playerId: 2, slot: 'BENCH' })];
  const padded = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 4, irSlots: 0 });
  expect(padded.bench).toHaveLength(4);
  const overflow = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 1, irSlots: 0 });
  expect(overflow.bench).toHaveLength(2);
});
