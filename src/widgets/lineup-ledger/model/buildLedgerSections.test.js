import { buildLedgerSections } from './buildLedgerSections';

const entry = (overrides = {}) => ({
  playerId: 1,
  name: 'Player',
  slot: 'QB',
  // `projectedPoints` (the Point estimate, CONTEXT.md's The projection
  // engine) is what the bench sorts by (#1482); `projection` (the
  // distribution's bare mean) rides alongside since real entries always
  // carry both, but nothing here reads it. Defaulted equal so a case that
  // only overrides one of them still behaves as every existing test expects.
  projectedPoints: 10,
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

// #1480: with the bench full there was no empty bench row to move a stale
// stash occupant to, and every other save is refused until he leaves IR.
test('an invalid IR stash on a full bench adds one empty bench row to move him to', () => {
  const entries = [
    entry({ playerId: 9, slot: 'IR', validStash: false }),
    entry({ playerId: 1, slot: 'BENCH' }),
    entry({ playerId: 2, slot: 'BENCH' }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 2, irSlots: 1 });
  expect(bench).toHaveLength(3);
  expect(bench[2].entry).toBeNull();
  expect(bench[2].testId).toBe('slot-row-BENCH-empty-2');
});

test('a valid IR stash, or a bench with room, adds no extra bench row', () => {
  const full = buildLedgerSections({
    entries: [entry({ playerId: 9, slot: 'IR', validStash: true }), entry({ playerId: 1, slot: 'BENCH' })],
    rosterSlots: [],
    benchSlots: 1,
    irSlots: 1,
  });
  expect(full.bench).toHaveLength(1);
  const room = buildLedgerSections({
    entries: [entry({ playerId: 9, slot: 'IR', validStash: false }), entry({ playerId: 1, slot: 'BENCH' })],
    rosterSlots: [],
    benchSlots: 2,
    irSlots: 1,
  });
  expect(room.bench).toHaveLength(2);
});

test('bench sorts available players by projectedPoints descending', () => {
  const entries = [
    entry({ playerId: 1, slot: 'BENCH', projectedPoints: 5, projection: 5 }),
    entry({ playerId: 2, slot: 'BENCH', projectedPoints: 15, projection: 15 }),
    entry({ playerId: 3, slot: 'BENCH', projectedPoints: 10, projection: 10 }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 3, irSlots: 0 });
  expect(bench.map((r) => r.entry.playerId)).toEqual([2, 3, 1]);
});

// #1482, formal review f2: the bench sorts by projectedPoints (the Point
// estimate the Ledger row headlines), never projection (the distribution's
// bare mean) - a bench that sorted by the mean while the row printed the
// Point estimate could print visibly out of order, the same statistic
// mismatch the issue's fix rules out everywhere else on the page.
test('bench sorts by projectedPoints, never projection, when the two disagree (#1482)', () => {
  const entries = [
    // Higher mean, lower Point estimate - sorts BELOW the other bench entry
    // once the bug is fixed, even though its mean is the larger number.
    entry({ playerId: 1, slot: 'BENCH', projectedPoints: 6, projection: 8 }),
    entry({ playerId: 2, slot: 'BENCH', projectedPoints: 10, projection: 7 }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 2, irSlots: 0 });
  expect(bench.map((r) => r.entry.playerId)).toEqual([2, 1]);
});

test('Unavailable bench players sort after every available one, regardless of projectedPoints', () => {
  const entries = [
    entry({ playerId: 1, slot: 'BENCH', projectedPoints: 20, projection: 20, availability: { available: false, reason: 'out' } }),
    entry({ playerId: 2, slot: 'BENCH', projectedPoints: 1, projection: 1 }),
  ];
  const { bench } = buildLedgerSections({ entries, rosterSlots: [], benchSlots: 2, irSlots: 0 });
  expect(bench.map((r) => r.entry.playerId)).toEqual([2, 1]);
});

test('an unknown (null) projectedPoints sorts last among available bench players, never throwing', () => {
  const entries = [
    entry({ playerId: 1, slot: 'BENCH', projectedPoints: null, projection: null }),
    entry({ playerId: 2, slot: 'BENCH', projectedPoints: 5, projection: 5 }),
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
