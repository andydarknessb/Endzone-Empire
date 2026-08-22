const test = require('node:test');
const assert = require('node:assert/strict');
const { draftRosterSize, draftRounds } = require('../services/rosterShape');

test('draftRosterSize: subtracts IR slots from the stored roster limit', () => {
  assert.equal(draftRosterSize({ roster_limit: 20, ir_slots: 1 }), 19);
  assert.equal(draftRosterSize({ roster_limit: 20, ir_slots: 5 }), 15);
});

test('draftRosterSize: a zero-IR league is unchanged by the subtraction', () => {
  assert.equal(draftRosterSize({ roster_limit: 16, ir_slots: 0 }), 16);
});

test('draftRosterSize: null/missing columns degrade to 0 rather than NaN', () => {
  assert.equal(draftRosterSize({ roster_limit: null, ir_slots: 1 }), 0);
  assert.equal(draftRosterSize({ roster_limit: 18, ir_slots: null }), 18);
  assert.equal(draftRosterSize({}), 0);
  assert.equal(draftRosterSize(null), 0);
});

test('draftRosterSize: never goes negative', () => {
  assert.equal(draftRosterSize({ roster_limit: 2, ir_slots: 5 }), 0);
});

test('draftRosterSize: accepts camelCase fields for callers holding request-shaped values', () => {
  assert.equal(draftRosterSize({ rosterLimit: 20, irSlots: 2 }), 18);
});

// --- draftRounds (ADR 0005: fix Draft rounds at draft start) --------------

test('draftRounds: a pending draft derives Draft roster size live', () => {
  assert.equal(draftRounds({ draft_status: 'pending', roster_limit: 20, ir_slots: 2, draft_rounds: null }), 18);
  // Even if a fixed value were somehow present on a pending row, pending
  // still derives live rather than trusting it (ADR 0005: fixing happens
  // only at the pending -> active transition).
  assert.equal(draftRounds({ draft_status: 'pending', roster_limit: 20, ir_slots: 2, draft_rounds: 99 }), 18);
});

test('draftRounds: an active draft reads the fixed value, not a live recomputation', () => {
  assert.equal(
    draftRounds({ draft_status: 'active', roster_limit: 999, ir_slots: 999, draft_rounds: 16 }),
    16
  );
});

test('draftRounds: a completed draft reads the fixed value', () => {
  assert.equal(
    draftRounds({ draft_status: 'complete', roster_limit: 999, ir_slots: 999, draft_rounds: 14 }),
    14
  );
});

test('draftRounds: an active/completed row missing its fixed value (pre-backfill) falls back to the live derivation defensively', () => {
  assert.equal(draftRounds({ draft_status: 'active', roster_limit: 20, ir_slots: 1, draft_rounds: null }), 19);
});

test('draftRounds: null league degrades to 0', () => {
  assert.equal(draftRounds(null), 0);
});
