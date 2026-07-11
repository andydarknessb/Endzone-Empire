const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInjuryStatus } = require('../services/scoring.service');

test('normalizeInjuryStatus maps designations to badge codes', () => {
  assert.equal(normalizeInjuryStatus('Questionable'), 'Q');
  assert.equal(normalizeInjuryStatus('questionable - ankle'), 'Q');
  assert.equal(normalizeInjuryStatus('Doubtful'), 'D');
  assert.equal(normalizeInjuryStatus('Out'), 'O');
  assert.equal(normalizeInjuryStatus('Injured Reserve'), 'IR');
  assert.equal(normalizeInjuryStatus('IR'), 'IR');
});

test('normalizeInjuryStatus: healthy/unknown values return null', () => {
  assert.equal(normalizeInjuryStatus(null), null);
  assert.equal(normalizeInjuryStatus(''), null);
  assert.equal(normalizeInjuryStatus('Probable'), null);
  assert.equal(normalizeInjuryStatus('Active'), null);
});

test('normalizeInjuryStatus: IR wins over Out when both words appear', () => {
  assert.equal(normalizeInjuryStatus('Out - Injured Reserve'), 'IR');
});
