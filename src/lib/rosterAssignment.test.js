import { assignRosterSlots, expandSlotInstances } from './rosterAssignment';
import { DEFAULT_ROSTER_SLOTS } from './draftSim/templates';

const STANDARD = DEFAULT_ROSTER_SLOTS; // QB, RB x2, WR x2, TE, FLEX, K, DEF = 9

const SUPERFLEX = [
  ...STANDARD,
  { key: 'SFLX', label: 'SFLX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
];

const IDP = [
  ...STANDARD,
  { key: 'DL', label: 'DL', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', label: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', label: 'DB', count: 1, eligiblePositions: ['DB'] },
];

/** Picks numbered in the order given, so pick order is the array order. */
const picksOf = (...positions) =>
  positions.map((position, i) => ({
    pickNumber: i + 1,
    playerId: 1000 + i,
    name: `${position} ${i + 1}`,
    position,
    nflTeam: 'BUF',
    auto: false,
  }));

const assign = (positions, overrides = {}) =>
  assignRosterSlots({
    picks: picksOf(...positions),
    rosterSlots: STANDARD,
    benchCount: 6,
    irCount: 0,
    ...overrides,
  });

/** slotLabel -> player name, for the rows that have a player. */
const placements = (result) =>
  Object.fromEntries(
    result.rows.filter((r) => r.player).map((r) => [r.slotLabel, r.player.name])
  );

describe('expandSlotInstances', () => {
  test('numbers repeated slots and leaves single slots bare', () => {
    expect(expandSlotInstances(STANDARD).map((i) => i.slotLabel)).toEqual([
      'QB', 'RB 1', 'RB 2', 'WR 1', 'WR 2', 'TE', 'FLEX', 'K', 'DEF',
    ]);
  });

  test('gives duplicate slot keys independent instances (I14)', () => {
    const slots = [
      { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR'] },
      { key: 'FLEX', count: 1, eligiblePositions: ['TE'] },
    ];
    const instances = expandSlotInstances(slots);
    expect(instances).toHaveLength(2);
    expect(new Set(instances.map((i) => i.id)).size).toBe(2);
    // Eligibility is per index, so the second FLEX is TE-only, not RB/WR.
    expect(instances[1].eligible.has('TE')).toBe(true);
    expect(instances[1].eligible.has('RB')).toBe(false);
  });

  test.each([
    ['no slots', []],
    ['a zero count', [{ key: 'QB', count: 0, eligiblePositions: ['QB'] }]],
    ['a negative count', [{ key: 'QB', count: -1, eligiblePositions: ['QB'] }]],
    ['a null entry', [null]],
    ['a keyless entry', [{ count: 2, eligiblePositions: ['QB'] }]],
  ])('yields nothing for %s (I13)', (_label, slots) => {
    expect(expandSlotInstances(slots)).toEqual([]);
  });

  test('coerces a stringy count and survives missing eligiblePositions (I13)', () => {
    const instances = expandSlotInstances([{ key: 'RB', count: '2' }]);
    expect(instances.map((i) => i.slotLabel)).toEqual(['RB 1', 'RB 2']);
    expect(instances[0].eligiblePositions).toEqual([]);
  });

  test('falls back to the key when a league has stripped slot labels', () => {
    // CommissionerTools' save path drops `label`, so real leagues have none.
    expect(expandSlotInstances([{ key: 'W/R/T', count: 1, eligiblePositions: ['RB'] }])[0].slotLabel)
      .toBe('W/R/T');
  });
});

describe('the empty roster', () => {
  const result = assign([]);

  test('renders the whole template before a single pick is made', () => {
    expect(result.rows.filter((r) => r.section === 'starter').map((r) => r.slotLabel)).toEqual([
      'QB', 'RB 1', 'RB 2', 'WR 1', 'WR 2', 'TE', 'FLEX', 'K', 'DEF',
    ]);
    expect(result.rows.filter((r) => r.section === 'bench').map((r) => r.slotLabel)).toEqual([
      'BN 1', 'BN 2', 'BN 3', 'BN 4', 'BN 5', 'BN 6',
    ]);
    expect(result.rows.some((r) => r.section === 'ir')).toBe(false);
    expect(result.rows.every((r) => r.player === null)).toBe(true);
  });

  test('reports every starter as needed and the whole bench as open', () => {
    expect(result.summary).toMatchObject({
      starterInstances: 9, startersFilled: 0, startersOpen: 9,
      benchInstances: 6, benchFilled: 0, benchOpen: 6,
      configuredSlotCount: 15, draftable: 15, assignedCount: 0,
      overflowCount: 0, rosterFull: false,
    });
    expect(result.summary.unfilledStarters).toEqual([
      { slotKey: 'QB', slotLabel: 'QB', eligiblePositions: ['QB'], count: 1 },
      { slotKey: 'RB', slotLabel: 'RB', eligiblePositions: ['RB'], count: 2 },
      { slotKey: 'WR', slotLabel: 'WR', eligiblePositions: ['WR'], count: 2 },
      { slotKey: 'TE', slotLabel: 'TE', eligiblePositions: ['TE'], count: 1 },
      { slotKey: 'FLEX', slotLabel: 'FLEX', eligiblePositions: ['RB', 'WR', 'TE'], count: 1 },
      { slotKey: 'K', slotLabel: 'K', eligiblePositions: ['K'], count: 1 },
      { slotKey: 'DEF', slotLabel: 'DEF', eligiblePositions: ['DEF'], count: 1 },
    ]);
  });
});

describe('slot filling', () => {
  test('an RB run fills RB 1, RB 2, FLEX, then the bench (acceptance criterion 3)', () => {
    expect(placements(assign(['RB', 'RB', 'RB', 'RB']))).toEqual({
      'RB 1': 'RB 1', 'RB 2': 'RB 2', FLEX: 'RB 3', 'BN 1': 'RB 4',
    });
  });

  test('a WR taken before a TE never blocks the TE out of its own slot', () => {
    expect(placements(assign(['WR', 'WR', 'WR', 'TE']))).toEqual({
      'WR 1': 'WR 1', 'WR 2': 'WR 2', FLEX: 'WR 3', TE: 'TE 4',
    });
  });

  test('places each position in its dedicated slot regardless of draft order', () => {
    expect(placements(assign(['DEF', 'K', 'TE', 'QB']))).toEqual({
      DEF: 'DEF 1', K: 'K 2', TE: 'TE 3', QB: 'QB 4',
    });
  });

  test('an earlier pick wins the only slot, the later one benches (I5)', () => {
    const result = assignRosterSlots({
      picks: picksOf('TE', 'TE'),
      rosterSlots: [{ key: 'TE', count: 1, eligiblePositions: ['TE'] }],
      benchCount: 6,
    });
    expect(placements(result)).toEqual({ TE: 'TE 1', 'BN 1': 'TE 2' });
  });

  test('a later pick does not displace an already-placed player when a slot is free (I4)', () => {
    const before = placements(assign(['RB', 'RB', 'RB']));
    const after = placements(assign(['RB', 'RB', 'RB', 'WR']));
    expect(after['RB 1']).toBe(before['RB 1']);
    expect(after['RB 2']).toBe(before['RB 2']);
    expect(after.FLEX).toBe(before.FLEX);
    expect(after['WR 1']).toBe('WR 4');
  });

  test('fills the bench in pick order (I7)', () => {
    const result = assign(['RB', 'RB', 'RB', 'RB', 'RB', 'RB']);
    expect(placements(result)).toMatchObject({
      'BN 1': 'RB 4', 'BN 2': 'RB 5', 'BN 3': 'RB 6',
    });
  });

  test('a superflex slot starts a second QB', () => {
    const result = assignRosterSlots({
      picks: picksOf('QB', 'QB'), rosterSlots: SUPERFLEX, benchCount: 6,
    });
    expect(placements(result)).toEqual({ QB: 'QB 1', SFLX: 'QB 2' });
  });

  test('expands DL/LB/DB group keys to real position codes (I12)', () => {
    // A DE is a DL, an OLB is an LB, a CB is a DB - per lineup.service.js groups.
    const result = assignRosterSlots({
      picks: picksOf('DE', 'OLB', 'CB'), rosterSlots: IDP, benchCount: 6,
    });
    expect(placements(result)).toEqual({ DL: 'DE 1', LB: 'OLB 2', DB: 'CB 3' });
  });

  test('benches a defender when the format has no IDP starters', () => {
    const result = assignRosterSlots({
      picks: picksOf('LB'), rosterSlots: STANDARD, benchCount: 6,
    });
    expect(placements(result)).toEqual({ 'BN 1': 'LB 1' });
    expect(result.summary.startersFilled).toBe(0);
  });

  test.each([[null], [undefined], ['P']])(
    'benches a player with an unusable position (%s) rather than throwing (I11)',
    (position) => {
      const result = assignRosterSlots({
        picks: [{ pickNumber: 1, playerId: 1, name: 'Mystery', position }],
        rosterSlots: STANDARD,
        benchCount: 6,
      });
      expect(placements(result)).toEqual({ 'BN 1': 'Mystery' });
    }
  );
});

// These are the cases a greedy scan gets wrong. See the header of
// rosterAssignment.js - both slot shapes are reachable from the real editor.
describe('maximum matching, not greedy', () => {
  test('re-homes an incumbent so a DL can use the IDP FLEX (I6)', () => {
    const result = assignRosterSlots({
      picks: picksOf('LB', 'DL'),
      rosterSlots: [
        { key: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] },
        { key: 'LB', count: 1, eligiblePositions: ['LB'] },
      ],
      benchCount: 6,
    });
    expect(placements(result)).toEqual({ LB: 'LB 1', 'IDP FLEX': 'DL 2' });
    expect(result.summary.startersFilled).toBe(2);
  });

  test('solves overlapping-but-not-nested eligibility that restrictiveness-first loses', () => {
    const result = assignRosterSlots({
      picks: picksOf('LB', 'DL'),
      rosterSlots: [
        { key: 'DL/LB', count: 1, eligiblePositions: ['DL', 'LB'] },
        { key: 'LB/DB', count: 1, eligiblePositions: ['LB', 'DB'] },
      ],
      benchCount: 6,
    });
    expect(placements(result)).toEqual({ 'DL/LB': 'DL 2', 'LB/DB': 'LB 1' });
    expect(result.summary.startersFilled).toBe(2);
  });

  test('re-homes through a chain of two incumbents', () => {
    const result = assignRosterSlots({
      picks: picksOf('WR', 'TE', 'RB'),
      rosterSlots: [
        { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
        { key: 'W/T', count: 1, eligiblePositions: ['WR', 'TE'] },
        { key: 'TE', count: 1, eligiblePositions: ['TE'] },
      ],
      benchCount: 6,
    });
    expect(result.summary.startersFilled).toBe(3);
    expect(placements(result)).toEqual({ FLEX: 'RB 3', 'W/T': 'WR 1', TE: 'TE 2' });
  });

  test('matches a brute-force oracle across randomised slot shapes (I2)', () => {
    const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
    // Deterministic LCG: a failure reproduces exactly instead of haunting CI.
    let seed = 20260805;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pickFrom = (arr) => arr[Math.floor(rand() * arr.length)];

    const bruteForce = (players, instances) => {
      let best = 0;
      const used = new Array(instances.length).fill(false);
      const walk = (p, count) => {
        if (count + (players.length - p) <= best) return; // prune
        if (p === players.length) { best = Math.max(best, count); return; }
        walk(p + 1, count);
        for (let j = 0; j < instances.length; j++) {
          if (used[j] || !instances[j].eligible.has(players[p].position)) continue;
          used[j] = true;
          walk(p + 1, count + 1);
          used[j] = false;
        }
      };
      walk(0, 0);
      return best;
    };

    for (let trial = 0; trial < 200; trial++) {
      const slotCount = 1 + Math.floor(rand() * 4);
      const rosterSlots = Array.from({ length: slotCount }, (_, s) => {
        const size = 1 + Math.floor(rand() * 3);
        const eligiblePositions = [...new Set(
          Array.from({ length: size }, () => pickFrom(POSITIONS))
        )];
        return { key: `S${s}`, count: 1 + Math.floor(rand() * 2), eligiblePositions };
      });
      const positions = Array.from(
        { length: 1 + Math.floor(rand() * 6) },
        () => pickFrom(POSITIONS)
      );

      const result = assignRosterSlots({ picks: picksOf(...positions), rosterSlots, benchCount: 10 });
      const optimal = bruteForce(picksOf(...positions), expandSlotInstances(rosterSlots));
      expect(result.summary.startersFilled).toBe(optimal);
    }
  });
});

describe('bench, IR and overflow', () => {
  test('spills past a full bench into overflow rather than dropping the pick', () => {
    const result = assign(Array(16).fill('RB')); // 9 starters cannot take 16 RBs
    expect(result.summary).toMatchObject({
      startersFilled: 3, benchFilled: 6, overflowCount: 7, rosterFull: true,
    });
    const overflow = result.rows.filter((r) => r.section === 'overflow');
    expect(overflow.map((r) => r.player.name)).toEqual([
      'RB 10', 'RB 11', 'RB 12', 'RB 13', 'RB 14', 'RB 15', 'RB 16',
    ]);
    expect(overflow.every((r) => r.slotLabel === 'No slot' && r.draftable === false)).toBe(true);
  });

  test('flags a roster as full exactly at the configured slot count, not before', () => {
    expect(assign(Array(14).fill('RB')).summary.rosterFull).toBe(false);
    expect(assign(Array(15).fill('RB')).summary.rosterFull).toBe(true);
  });

  // A real 12-starter / 7-bench / 1-IR league. The server derives
  // roster_limit = 12 + 7 + 1 = 20 and drafts exactly that many rounds, so a
  // complete draft must land 20 picks in 20 spots with nothing left over.
  const LEAGUE_12 = [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'RB', count: 2, eligiblePositions: ['RB'] },
    { key: 'WR', count: 2, eligiblePositions: ['WR'] },
    { key: 'TE', count: 1, eligiblePositions: ['TE'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
    { key: 'K', count: 1, eligiblePositions: ['K'] },
    { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
    { key: 'D LINE', count: 1, eligiblePositions: ['DL'] },
    { key: 'LB', count: 1, eligiblePositions: ['LB'] },
    { key: 'DB', count: 1, eligiblePositions: ['DB'] },
  ];
  const FULL_DRAFT = [
    'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB', 'K', 'DEF', 'DL', 'LB', 'DB',
    ...Array(8).fill('WR'),
  ];

  test('lands a complete 12/7/1 draft in exactly 20 spots with no overflow', () => {
    const result = assignRosterSlots({
      picks: picksOf(...FULL_DRAFT), rosterSlots: LEAGUE_12, benchCount: 7, irCount: 1,
    });
    expect(result.summary).toMatchObject({
      starterInstances: 12, startersFilled: 12,
      benchInstances: 7, benchFilled: 7,
      irInstances: 1, irFilled: 1,
      configuredSlotCount: 20, assignedCount: 20, overflowCount: 0, rosterFull: true,
    });
    // The IR slot is a spot this draft fills, so it counts as draftable.
    expect(result.summary).toMatchObject({ configuredSlotCount: 20, draftable: 20 });
    // The tail of the draft is what reaches IR.
    expect(result.rows.find((r) => r.section === 'ir').player.pickNumber).toBe(20);
  });

  test('leaves IR empty and de-emphasised when irDraftable is off (I8)', () => {
    const result = assignRosterSlots({
      picks: picksOf(...FULL_DRAFT),
      rosterSlots: LEAGUE_12, benchCount: 7, irCount: 1, irDraftable: false,
    });
    const ir = result.rows.find((r) => r.section === 'ir');
    expect(ir.player).toBeNull();
    expect(ir.draftable).toBe(false);
    // Configured slots include IR even though the draft does not fill it.
    expect(result.summary.configuredSlotCount).toBe(20);
    expect(result.summary).not.toHaveProperty('capacity');
    expect(result.summary.draftable).toBe(19);
    // The pick IR would have taken is surfaced as overflow, never dropped.
    expect(result.summary).toMatchObject({ irFilled: 0, overflowCount: 1 });
  });

  test('spills into overflow when a position run cannot reach the starting slots', () => {
    // 20 RBs: only RB 1, RB 2 and FLEX are RB-eligible, so 3 start, 7 bench,
    // 1 IR, and the remaining 9 have nowhere to go.
    const result = assignRosterSlots({
      picks: picksOf(...Array(20).fill('RB')),
      rosterSlots: LEAGUE_12, benchCount: 7, irCount: 1,
    });
    expect(result.summary).toMatchObject({
      startersFilled: 3, benchFilled: 7, irFilled: 1, overflowCount: 9,
    });
  });
});

describe('purity', () => {
  test('is deterministic across repeated calls (I1)', () => {
    const args = { picks: picksOf('RB', 'WR', 'TE', 'RB'), rosterSlots: STANDARD, benchCount: 6 };
    expect(assignRosterSlots(args)).toEqual(assignRosterSlots(args));
  });

  test('depends on pick numbers, not array order (I1)', () => {
    const ordered = picksOf('RB', 'WR', 'TE');
    const shuffled = [ordered[2], ordered[0], ordered[1]];
    expect(assignRosterSlots({ picks: shuffled, rosterSlots: STANDARD, benchCount: 6 }))
      .toEqual(assignRosterSlots({ picks: ordered, rosterSlots: STANDARD, benchCount: 6 }));
  });

  test('never mutates the picks it is given (I10)', () => {
    const picks = picksOf('RB', 'RB', 'RB', 'RB').map((p) => Object.freeze(p));
    Object.freeze(picks);
    const snapshot = JSON.parse(JSON.stringify(picks));
    expect(() => assignRosterSlots({ picks, rosterSlots: STANDARD, benchCount: 6 })).not.toThrow();
    expect(picks).toEqual(snapshot);
  });

  test('survives being called with nothing at all (I13)', () => {
    const result = assignRosterSlots();
    expect(result.rows).toEqual([]);
    expect(result.summary).toMatchObject({ configuredSlotCount: 0, rosterFull: false, assignedCount: 0 });
  });
});

describe('byPickNumber', () => {
  test('tags every placed pick with the slot it landed in', () => {
    const result = assign(['RB', 'RB', 'RB', 'RB']);
    expect([...result.byPickNumber.entries()].map(([n, tag]) => [n, tag.slotLabel])).toEqual([
      [1, 'RB 1'], [2, 'RB 2'], [3, 'FLEX'], [4, 'BN 1'],
    ]);
  });

  test('tags overflow picks too, so none goes unexplained', () => {
    const result = assign(Array(16).fill('RB'));
    expect(result.byPickNumber.size).toBe(16);
    expect(result.byPickNumber.get(16)).toMatchObject({ section: 'overflow', slotLabel: 'No slot' });
  });
});
