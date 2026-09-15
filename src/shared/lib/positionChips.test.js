import { DEFAULT_ROSTER_SLOTS, expandEligibility } from '../../lib/draftSim/templates';
import { CANONICAL_CHIP_ORDER, FULL_CANONICAL_SLOTS, isFlexSlot, chipsForRosterSlots } from './positionChips';

// Roster templates a league's `roster_slots` can carry (#1419), mirroring the
// shapes CommissionerTools.jsx's own LINEUP_TEMPLATES stamp into a real
// league and templates.js's own IDP_LINEUP/SUPERFLEX_LINEUP.
const IDP_SLOTS = [
  ...DEFAULT_ROSTER_SLOTS,
  { key: 'DL', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', count: 1, eligiblePositions: ['DB'] },
];

test('a non-IDP (standard) template offers no defender chips', () => {
  const chips = chipsForRosterSlots(DEFAULT_ROSTER_SLOTS);

  expect(chips.map((chip) => chip.key)).toEqual(['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
  expect(chips.some((chip) => ['DL', 'LB', 'DB'].includes(chip.key))).toBe(false);
});

test('an IDP template offers the DL/LB/DB group chips, not granular defender codes', () => {
  const chips = chipsForRosterSlots(IDP_SLOTS);

  expect(chips.map((chip) => chip.key)).toEqual(['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'DL', 'LB', 'DB']);
  for (const code of ['DE', 'DT', 'CB', 'S']) {
    expect(chips.some((chip) => chip.key === code)).toBe(false);
  }
});

test('chips render in CANONICAL_CHIP_ORDER regardless of the template slots order', () => {
  const shuffled = [...IDP_SLOTS].reverse();
  const chips = chipsForRosterSlots(shuffled);

  // IDP_SLOTS carries no SFLX slot, so the expected order is
  // CANONICAL_CHIP_ORDER with that one key dropped, same as any absent key.
  expect(chips.map((chip) => chip.key)).toEqual(
    ['All', ...CANONICAL_CHIP_ORDER.filter((key) => key !== 'SFLX')]
  );
});

test('a flex-type chip (FLEX) carries its slot\'s expanded eligible positions', () => {
  const chips = chipsForRosterSlots(DEFAULT_ROSTER_SLOTS);
  const flex = chips.find((chip) => chip.key === 'FLEX');

  expect(flex.positions).toEqual(['RB', 'WR', 'TE']);
});

test('a plain (non-flex) chip carries no positions field', () => {
  const chips = chipsForRosterSlots(DEFAULT_ROSTER_SLOTS);
  const qb = chips.find((chip) => chip.key === 'QB');

  expect(qb.positions).toBeUndefined();
});

test('a group chip (LB) expands to its whole eligibility group', () => {
  const chips = chipsForRosterSlots(IDP_SLOTS);
  const lb = chips.find((chip) => chip.key === 'LB');

  expect(lb.positions).toEqual(expect.arrayContaining(['LB', 'ILB', 'OLB']));
  expect(lb.positions).toHaveLength(3);
});

test('an empty or absent rosterSlots falls back to FULL_CANONICAL_SLOTS (every possible chip)', () => {
  expect(chipsForRosterSlots([]).map((chip) => chip.key)).toEqual(['All', ...CANONICAL_CHIP_ORDER]);
  expect(chipsForRosterSlots(undefined).map((chip) => chip.key)).toEqual(['All', ...CANONICAL_CHIP_ORDER]);
});

test('isFlexSlot is true only for a slot whose expanded eligibility differs from its own single key', () => {
  expect(isFlexSlot({ key: 'QB', eligiblePositions: ['QB'] })).toBe(false);
  expect(isFlexSlot({ key: 'FLEX', eligiblePositions: ['RB', 'WR', 'TE'] })).toBe(true);
  expect(isFlexSlot({ key: 'DL', eligiblePositions: ['DL'] })).toBe(true);
});

test('FULL_CANONICAL_SLOTS carries exactly one slot per CANONICAL_CHIP_ORDER key', () => {
  expect(FULL_CANONICAL_SLOTS.map((slot) => slot.key).sort()).toEqual([...CANONICAL_CHIP_ORDER].sort());
});

// #1462: a commissioner-defined slot key (src/entities/roster/model/lineupModel.js:172,
// "any commissioner-defined slot key ('D LINE', 'IDP FLEX')") is not in
// CANONICAL_CHIP_ORDER, so it used to be silently dropped instead of getting a chip.
test('a non-canonical slot key gets its own chip, after the canonical chips, keyed and labelled as stored', () => {
  const chips = chipsForRosterSlots([
    ...DEFAULT_ROSTER_SLOTS,
    { key: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] },
  ]);

  expect(chips.map((chip) => chip.key)).toEqual(['All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'IDP FLEX']);
  const custom = chips[chips.length - 1];
  expect(custom).toEqual({ key: 'IDP FLEX', positions: Array.from(expandEligibility(['DL', 'LB', 'DB'])) });
});

test('two non-canonical slot keys keep template order after the canonical chips', () => {
  const chips = chipsForRosterSlots([
    ...DEFAULT_ROSTER_SLOTS,
    { key: 'D LINE', count: 1, eligiblePositions: ['DL'] },
    { key: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] },
  ]);

  expect(chips.map((chip) => chip.key)).toEqual([
    'All', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'D LINE', 'IDP FLEX',
  ]);
});
