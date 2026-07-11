const test = require('node:test');
const assert = require('node:assert/strict');
const {
  slotEligible,
  validateLineup,
  parseLineupSettings,
  DEFAULT_LINEUP_SLOTS,
} = require('../services/lineup.service');

test('slotEligible: exact-position slots take only that position', () => {
  assert.equal(slotEligible('QB', 'QB'), true);
  assert.equal(slotEligible('QB', 'RB'), false);
  assert.equal(slotEligible('RB', 'RB'), true);
  assert.equal(slotEligible('WR', 'TE'), false);
  assert.equal(slotEligible('K', 'K'), true);
  assert.equal(slotEligible('DEF', 'DEF'), true);
  assert.equal(slotEligible('DEF', 'K'), false);
});

test('slotEligible: FLEX takes RB, WR, or TE but not QB/K/DEF', () => {
  assert.equal(slotEligible('FLEX', 'RB'), true);
  assert.equal(slotEligible('FLEX', 'WR'), true);
  assert.equal(slotEligible('FLEX', 'TE'), true);
  assert.equal(slotEligible('FLEX', 'QB'), false);
  assert.equal(slotEligible('FLEX', 'K'), false);
  assert.equal(slotEligible('FLEX', 'DEF'), false);
});

test('slotEligible: BENCH and IR take any position', () => {
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    assert.equal(slotEligible('BENCH', position), true);
    assert.equal(slotEligible('IR', position), true);
  }
});

const entry = (position, slot, playerId = 1) => ({ playerId, position, slot });

test('validateLineup: a legal default lineup passes', () => {
  const entries = [
    entry('QB', 'QB'),
    entry('RB', 'RB'), entry('RB', 'RB'),
    entry('WR', 'WR'), entry('WR', 'WR'),
    entry('TE', 'TE'),
    entry('WR', 'FLEX'),
    entry('K', 'K'),
    entry('DEF', 'DEF'),
    entry('RB', 'BENCH'), entry('WR', 'BENCH'), entry('QB', 'BENCH'),
  ];
  assert.deepEqual(validateLineup(entries, { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 1 }), []);
});

test('validateLineup: overfilling a slot is rejected', () => {
  const entries = [entry('QB', 'QB', 1), entry('QB', 'QB', 2)];
  const errors = validateLineup(entries, { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at QB \(2\/1\)/);
});

test('validateLineup: wrong position in a slot is rejected', () => {
  const errors = validateLineup([entry('QB', 'FLEX')], { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /a QB cannot start at FLEX/);
});

test('validateLineup: unknown slot names are rejected', () => {
  const errors = validateLineup([entry('RB', 'SUPERFLEX')], { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown slot "SUPERFLEX"/);
});

test('validateLineup: BENCH is unbounded', () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry('RB', 'BENCH', i + 1));
  assert.deepEqual(validateLineup(entries, { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 1 }), []);
});

test('validateLineup: IR is capped at irSlots', () => {
  const entries = [entry('RB', 'IR', 1), entry('WR', 'IR', 2)];
  assert.deepEqual(validateLineup(entries, { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 2 }), []);
  const errors = validateLineup(entries, { lineupSlots: DEFAULT_LINEUP_SLOTS, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at IR \(2\/1\)/);
});

test('validateLineup: custom slot counts are honored', () => {
  const twoQb = { ...DEFAULT_LINEUP_SLOTS, QB: 2 };
  const entries = [entry('QB', 'QB', 1), entry('QB', 'QB', 2)];
  assert.deepEqual(validateLineup(entries, { lineupSlots: twoQb, irSlots: 1 }), []);
});

test('validateLineup: a slot configured to 0 rejects any starter there', () => {
  const noTe = { ...DEFAULT_LINEUP_SLOTS, TE: 0 };
  const errors = validateLineup([entry('TE', 'TE')], { lineupSlots: noTe, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at TE \(1\/0\)/);
});

test('parseLineupSettings: defaults when columns are null', () => {
  const settings = parseLineupSettings({ lineup_slots: null, position_caps: null, ir_slots: null });
  assert.deepEqual(settings.lineupSlots, DEFAULT_LINEUP_SLOTS);
  assert.deepEqual(settings.positionCaps, {});
  assert.equal(settings.irSlots, 1);
});

test('parseLineupSettings: accepts jsonb objects and JSON strings', () => {
  const asObject = parseLineupSettings({ lineup_slots: { QB: 2 }, position_caps: { RB: 4 }, ir_slots: 2 });
  assert.deepEqual(asObject.lineupSlots, { QB: 2 });
  assert.deepEqual(asObject.positionCaps, { RB: 4 });
  assert.equal(asObject.irSlots, 2);

  const asString = parseLineupSettings({ lineup_slots: '{"QB":2}', position_caps: '{"RB":4}', ir_slots: 2 });
  assert.deepEqual(asString.lineupSlots, { QB: 2 });
  assert.deepEqual(asString.positionCaps, { RB: 4 });
});
