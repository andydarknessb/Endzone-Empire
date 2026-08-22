const test = require('node:test');
const assert = require('node:assert/strict');
const { detectScoringEvents } = require('../services/scoring.service');

test('detects a new rushing touchdown from a stat delta', () => {
  const prev = { rushingYards: 40, rushingTDs: 0 };
  const next = { rushingYards: 62, rushingTDs: 1 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'rushing', statKey: 'rushingTDs', tdDelta: 1, isTouchdown: true });
});

test('first observation of the week (no prior row) counts as a TD', () => {
  const events = detectScoringEvents(null, { receivingTDs: 1, receptions: 3 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'receiving');
});

test('yardage-only change produces no event', () => {
  const prev = { rushingYards: 40, rushingTDs: 1 };
  const next = { rushingYards: 88, rushingTDs: 1 };
  assert.deepEqual(detectScoringEvents(prev, next), []);
});

test('a stat correction that moves points without a TD increment fires nothing', () => {
  // e.g. receptions corrected upward (+points) but the TD count is unchanged.
  const prev = { receptions: 4, receivingYards: 50, receivingTDs: 1 };
  const next = { receptions: 6, receivingYards: 71, receivingTDs: 1 };
  assert.deepEqual(detectScoringEvents(prev, next), []);
});

test('re-running with identical stats is idempotent (no events)', () => {
  const stats = { passingYards: 300, passingTDs: 3 };
  assert.deepEqual(detectScoringEvents(stats, stats), []);
});

test('multiple TD stats incrementing in one window yield one event each', () => {
  const prev = { passingTDs: 1, rushingTDs: 0 };
  const next = { passingTDs: 2, rushingTDs: 1 };
  const events = detectScoringEvents(prev, next);
  assert.equal(events.length, 2);
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['passing', 'rushing']);
});

test('a multi-TD jump reports the delta, not just a boolean', () => {
  const events = detectScoringEvents({ rushingTDs: 1 }, { rushingTDs: 3 });
  assert.equal(events.length, 1);
  assert.equal(events[0].tdDelta, 2);
});

test('a defensive touchdown is typed as defensive', () => {
  const events = detectScoringEvents({ defensiveTD: 0 }, { defensiveTD: 1 });
  assert.equal(events[0].type, 'defensive');
  assert.equal(events[0].isTouchdown, true);
});

test('a sack is a non-touchdown moment event', () => {
  const events = detectScoringEvents({ sack: 0 }, { sack: 1 });
  assert.equal(events[0].type, 'sack');
  assert.equal(events[0].isTouchdown, false);
});
