import { draftRosterSize, draftRounds } from './rosterShape';

describe('draftRosterSize', () => {
  test('subtracts IR slots from the stored roster limit', () => {
    expect(draftRosterSize({ roster_limit: 20, ir_slots: 1 })).toBe(19);
  });

  test('null/missing columns degrade to 0 rather than NaN', () => {
    expect(draftRosterSize({})).toBe(0);
    expect(draftRosterSize(null)).toBe(0);
  });

  test('never goes negative', () => {
    expect(draftRosterSize({ roster_limit: 2, ir_slots: 5 })).toBe(0);
  });
});

// draftRounds (ADR 0005: fix Draft rounds at draft start) -------------------

describe('draftRounds', () => {
  test('a pending draft derives Draft roster size live', () => {
    expect(draftRounds({ draft_status: 'pending', roster_limit: 20, ir_slots: 2, draft_rounds: null })).toBe(18);
    // Even a stray fixed value on a pending row is ignored: pending always
    // derives live until the pending -> active transition fixes it.
    expect(draftRounds({ draft_status: 'pending', roster_limit: 20, ir_slots: 2, draft_rounds: 99 })).toBe(18);
  });

  test('an active draft reads the fixed value, not a live recomputation', () => {
    expect(draftRounds({ draft_status: 'active', roster_limit: 999, ir_slots: 999, draft_rounds: 16 })).toBe(16);
  });

  test('a completed draft reads the fixed value', () => {
    expect(draftRounds({ draft_status: 'complete', roster_limit: 999, ir_slots: 999, draft_rounds: 14 })).toBe(14);
  });

  test('an active/completed row missing its fixed value (pre-backfill) falls back to the live derivation defensively', () => {
    expect(draftRounds({ draft_status: 'active', roster_limit: 20, ir_slots: 1, draft_rounds: null })).toBe(19);
  });

  test('null league degrades to 0', () => {
    expect(draftRounds(null)).toBe(0);
  });
});
