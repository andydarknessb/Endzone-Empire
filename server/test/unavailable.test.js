const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unavailableFor } = require('../services/unavailable');

// One row per fact the Unavailable verdict reads. Deleting the no_team branch
// turns the no_team row red.
const ROWS = [
  ['bye', { onBye: true }, { available: false, activeProbability: 0, reason: 'bye' }],
  ['no_team', { noTeam: true }, { available: false, activeProbability: 0, reason: 'no_team' }],
  ['out', { injuryStatus: 'O' }, { available: false, activeProbability: 0, reason: 'out' }],
  ['ir', { injuryStatus: 'IR' }, { available: false, activeProbability: 0, reason: 'ir' }],
  ['doubtful', { injuryStatus: 'D' }, { available: true, autoRecommend: false, activeProbability: null, reason: 'doubtful' }],
  ['questionable', { injuryStatus: 'Q' }, { available: true, autoRecommend: true, activeProbability: null, reason: 'questionable' }],
  ['healthy', {}, { available: true, autoRecommend: true, activeProbability: 1, reason: null }],
  ['locked', { locked: true, lockedSlot: 'QB' }, { available: true, autoRecommend: true, activeProbability: 1, reason: null, locked: true, lockedSlot: 'QB' }],
];

for (const [name, facts, expected] of ROWS) {
  test(`unavailableFor: ${name}`, () => {
    const verdict = unavailableFor(facts);
    for (const [key, value] of Object.entries(expected)) assert.equal(verdict[key], value, key);
  });
}

// #1775: a Position-baseline projection is available but never auto-recommended.
test('unavailableFor: positionBaseline wins over no designation, Questionable and Doubtful', () => {
  for (const injuryStatus of [null, 'Q', 'D']) {
    const verdict = unavailableFor({ injuryStatus, positionBaseline: true });
    assert.equal(verdict.available, true, String(injuryStatus));
    assert.equal(verdict.autoRecommend, false, String(injuryStatus));
    assert.equal(verdict.reason, 'no_history', String(injuryStatus));
  }
});

test('unavailableFor: bye, no team, Out and IR still win over positionBaseline', () => {
  assert.equal(unavailableFor({ onBye: true, positionBaseline: true }).reason, 'bye');
  assert.equal(unavailableFor({ noTeam: true, positionBaseline: true }).reason, 'no_team');
  assert.equal(unavailableFor({ injuryStatus: 'O', positionBaseline: true }).reason, 'out');
  assert.equal(unavailableFor({ injuryStatus: 'IR', positionBaseline: true }).reason, 'ir');
  assert.equal(unavailableFor({ injuryStatus: 'O', positionBaseline: true }).available, false);
});

test('unavailableFor: positionBaseline false or absent changes nothing', () => {
  assert.equal(unavailableFor({ positionBaseline: false }).reason, null);
  assert.equal(unavailableFor({ injuryStatus: 'D', positionBaseline: false }).reason, 'doubtful');
});

test('unavailableFor: bye outranks no_team; called with nothing is healthy', () => {
  assert.equal(unavailableFor({ onBye: true, noTeam: true }).reason, 'bye');
  assert.equal(unavailableFor().available, true);
});
