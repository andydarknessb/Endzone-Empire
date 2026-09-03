import { earlyKickerOrDefense } from './earlyKickerOrDefense';

// A minimal roster shape holding exactly one K slot and one DEF slot, and no
// picks made at either position yet — the "one K one DEF template" the
// acceptance criteria names.
const ONE_K_ONE_DEF_SLOTS = [
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

// A template with dedicated slots for other positions only — K and DEF never
// appear, so there is nothing for "early" to be relative to.
const NO_K_NO_DEF_SLOTS = [
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
];

const EMPTY_ROSTER = [];

describe('earlyKickerOrDefense', () => {
  it('is false in the final round for a one-K one-DEF template', () => {
    expect(earlyKickerOrDefense({
      rosterSlots: ONE_K_ONE_DEF_SLOTS,
      roster: EMPTY_ROSTER,
      round: 12,
      draftRounds: 12,
    })).toBe(false);
  });

  it('is true two rounds earlier for the same one-K one-DEF template', () => {
    expect(earlyKickerOrDefense({
      rosterSlots: ONE_K_ONE_DEF_SLOTS,
      roster: EMPTY_ROSTER,
      round: 10,
      draftRounds: 12,
    })).toBe(true);
  });

  it('is false in every round for a no-K-no-DEF template', () => {
    for (const round of [1, 6, 10, 12]) {
      expect(earlyKickerOrDefense({
        rosterSlots: NO_K_NO_DEF_SLOTS,
        roster: EMPTY_ROSTER,
        round,
        draftRounds: 12,
      })).toBe(false);
    }
  });

  it('drops to zero unfilled once the roster already carries a K and a DEF', () => {
    const roster = [
      { pickNumber: 1, position: 'K' },
      { pickNumber: 2, position: 'DEF' },
    ];
    // Even ten rounds out, with both slots already filled there is nothing
    // left to be early about.
    expect(earlyKickerOrDefense({
      rosterSlots: ONE_K_ONE_DEF_SLOTS,
      roster,
      round: 2,
      draftRounds: 12,
    })).toBe(false);
  });

  it('counts only the still-unfilled slot when one of the two is already drafted', () => {
    const roster = [{ pickNumber: 1, position: 'DEF' }];
    // One K slot unfilled: true while at least 1 round remains after this one.
    expect(earlyKickerOrDefense({
      rosterSlots: ONE_K_ONE_DEF_SLOTS,
      roster,
      round: 11,
      draftRounds: 12,
    })).toBe(true);
    expect(earlyKickerOrDefense({
      rosterSlots: ONE_K_ONE_DEF_SLOTS,
      roster,
      round: 12,
      draftRounds: 12,
    })).toBe(false);
  });
});
