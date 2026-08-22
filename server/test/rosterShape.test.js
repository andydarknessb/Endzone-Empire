const test = require('node:test');
const assert = require('node:assert/strict');
const { draftRosterSize, irSlotCount } = require('../services/rosterShape');

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

test('irSlotCount: reads the column with the same null/legacy tolerance', () => {
  assert.equal(irSlotCount({ ir_slots: 3 }), 3);
  assert.equal(irSlotCount({ irSlots: 2 }), 2);
  assert.equal(irSlotCount({ ir_slots: null }), 0);
  assert.equal(irSlotCount({}), 0);
  assert.equal(irSlotCount(null), 0);
  assert.equal(irSlotCount({ ir_slots: -1 }), 0);
});
