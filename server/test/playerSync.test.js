const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerEntry } = require('../services/scoring.service');

test('normalizePlayerEntry: uses a combined name field when present', () => {
  const parsed = normalizePlayerEntry({ id: 42, name: 'Patrick Mahomes', position: 'qb' });
  assert.deepEqual(parsed, { externalId: 42, name: 'Patrick Mahomes', position: 'QB' });
});

test('normalizePlayerEntry: falls back to firstname + lastname', () => {
  const parsed = normalizePlayerEntry({ id: 7, firstname: 'Josh', lastname: 'Allen', position: 'QB' });
  assert.deepEqual(parsed, { externalId: 7, name: 'Josh Allen', position: 'QB' });
});

test('normalizePlayerEntry: uppercases position', () => {
  const parsed = normalizePlayerEntry({ id: 1, name: 'A Player', position: 'rb' });
  assert.equal(parsed.position, 'RB');
});

test('normalizePlayerEntry: missing id returns null', () => {
  assert.equal(normalizePlayerEntry({ name: 'No Id', position: 'WR' }), null);
});

test('normalizePlayerEntry: missing name/firstname/lastname returns null', () => {
  assert.equal(normalizePlayerEntry({ id: 1, position: 'WR' }), null);
});

test('normalizePlayerEntry: missing position returns null', () => {
  assert.equal(normalizePlayerEntry({ id: 1, name: 'No Position' }), null);
});

test('normalizePlayerEntry: null/undefined entry returns null', () => {
  assert.equal(normalizePlayerEntry(null), null);
  assert.equal(normalizePlayerEntry(undefined), null);
});

test('normalizePlayerEntry: only a lastname (no firstname) still builds a name', () => {
  const parsed = normalizePlayerEntry({ id: 3, lastname: 'Defense', position: 'DEF' });
  assert.deepEqual(parsed, { externalId: 3, name: 'Defense', position: 'DEF' });
});
