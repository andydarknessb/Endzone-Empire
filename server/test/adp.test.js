const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAdpPosition,
  normalizeAdpEntry,
  buildAdpUpdates,
} = require('../services/adp.service');

test('normalizeAdpPosition maps FFC PK to our K, passes others through', () => {
  assert.equal(normalizeAdpPosition('PK'), 'K');
  assert.equal(normalizeAdpPosition('rb'), 'RB');
  assert.equal(normalizeAdpPosition('DEF'), 'DEF');
});

test('normalizeAdpEntry extracts name key, position, and numeric adp', () => {
  const out = normalizeAdpEntry({ name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: '1.6' });
  assert.equal(out.nameKey, 'bijan robinson');
  assert.equal(out.position, 'RB');
  assert.equal(out.adp, 1.6);
});

test('normalizeAdpEntry rejects rows without a name or a positive adp', () => {
  assert.equal(normalizeAdpEntry({ position: 'RB', adp: 5 }), null);
  assert.equal(normalizeAdpEntry({ name: 'X', adp: 0 }), null);
  assert.equal(normalizeAdpEntry({ name: 'X', adp: 'n/a' }), null);
});

const entries = [
  { name: "Ja'Marr Chase", nameKey: 'jamarr chase', position: 'WR', adp: 2.1 },
  { name: 'Josh Allen', nameKey: 'josh allen', position: 'QB', adp: 30.5 },
  { name: 'Josh Allen', nameKey: 'josh allen', position: 'LB', adp: 180.0 },
];

test('buildAdpUpdates matches by folded name (punctuation-insensitive)', () => {
  const updates = buildAdpUpdates([{ id: 9, name: 'JaMarr Chase', position: 'WR' }], entries);
  assert.deepEqual(updates, [{ id: 9, adp: 2.1 }]);
});

test('buildAdpUpdates disambiguates same-named players by position', () => {
  const updates = buildAdpUpdates([{ id: 1, name: 'Josh Allen', position: 'QB' }], entries);
  assert.equal(updates[0].adp, 30.5); // the QB, not the LB
});

test('buildAdpUpdates leaves unmatched (undrafted) players out', () => {
  const updates = buildAdpUpdates([{ id: 2, name: 'Deep Sleeper', position: 'WR' }], entries);
  assert.deepEqual(updates, []);
});
