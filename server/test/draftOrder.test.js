const test = require('node:test');
const assert = require('node:assert/strict');
const {
  teamForPick,
  validateOrderOverrides,
  keeperPickNumbers,
  nextOpenPickNumber,
} = require('../services/draftOrder.service');

const teams = [{ id: 10, autodraft: false }, { id: 20, autodraft: false }, { id: 30, autodraft: false }, { id: 40, autodraft: false }];
const teamIds = teams.map((t) => t.id);

test('teamForPick: snake rotation matches the plain round-parity math', () => {
  assert.equal(teamForPick(0, teams, { rotation: 'snake' }).id, 10);
  assert.equal(teamForPick(3, teams, { rotation: 'snake' }).id, 40);
  assert.equal(teamForPick(4, teams, { rotation: 'snake' }).id, 40); // round 1 reversed
  assert.equal(teamForPick(7, teams, { rotation: 'snake' }).id, 10);
  assert.equal(teamForPick(8, teams, { rotation: 'snake' }).id, 10); // round 2 back to forward
});

test('teamForPick: linear rotation repeats the same order every round', () => {
  assert.equal(teamForPick(0, teams, { rotation: 'linear' }).id, 10);
  assert.equal(teamForPick(3, teams, { rotation: 'linear' }).id, 40);
  assert.equal(teamForPick(4, teams, { rotation: 'linear' }).id, 10);
  assert.equal(teamForPick(7, teams, { rotation: 'linear' }).id, 40);
});

test('teamForPick: a valid round override replaces just that round', () => {
  const overrides = { '2': [40, 30, 20, 10] }; // round 2 = picks 4-7
  assert.equal(teamForPick(3, teams, { rotation: 'snake', overrides }).id, 40); // round 1 untouched
  assert.equal(teamForPick(4, teams, { rotation: 'snake', overrides }).id, 40);
  assert.equal(teamForPick(5, teams, { rotation: 'snake', overrides }).id, 30);
  assert.equal(teamForPick(6, teams, { rotation: 'snake', overrides }).id, 20);
  assert.equal(teamForPick(7, teams, { rotation: 'snake', overrides }).id, 10);
  assert.equal(teamForPick(8, teams, { rotation: 'snake', overrides }).id, 10); // round 3 back to rotation
});

test('teamForPick: a stale override (wrong team set) falls back to rotation', () => {
  const overrides = { '1': [10, 20, 30] }; // missing team 40 — not a valid permutation
  assert.equal(teamForPick(0, teams, { rotation: 'linear', overrides }).id, 10);
  assert.equal(teamForPick(3, teams, { rotation: 'linear', overrides }).id, 40);
});

test('validateOrderOverrides: accepts null and valid permutations', () => {
  assert.equal(validateOrderOverrides(null, teamIds, 10), null);
  assert.equal(validateOrderOverrides({ '1': [40, 30, 20, 10] }, teamIds, 10), null);
});

test('validateOrderOverrides: rejects out-of-range rounds', () => {
  assert.match(validateOrderOverrides({ '0': teamIds }, teamIds, 10), /round "0"/);
  assert.match(validateOrderOverrides({ '11': teamIds }, teamIds, 10), /round "11"/);
});

test('validateOrderOverrides: rejects non-permutations (missing/duplicate/foreign team)', () => {
  assert.match(validateOrderOverrides({ '1': [10, 20, 30] }, teamIds, 10), /round 1/);
  assert.match(validateOrderOverrides({ '1': [10, 10, 20, 40] }, teamIds, 10), /round 1/);
  assert.match(validateOrderOverrides({ '1': [10, 20, 30, 999] }, teamIds, 10), /round 1/);
});

test('keeperPickNumbers: resolves round+team to a pick number under snake rotation', () => {
  const keepers = [{ team_id: 40, draft_round: 1 }, { team_id: 10, draft_round: 2 }];
  const resolved = keeperPickNumbers(keepers, teams, { rotation: 'snake' });
  assert.equal(resolved[0].pickNumber, 3); // team 40 picks last in round 1 (snake)
  assert.equal(resolved[1].pickNumber, 7); // team 10 picks last in round 2 (snake reverses)
});

test('keeperPickNumbers: throws when the team does not pick that round under the current order', () => {
  const keepers = [{ team_id: 999, draft_round: 1 }];
  assert.throws(() => keeperPickNumbers(keepers, teams, { rotation: 'snake' }), /does not pick in round 1/);
});

test('nextOpenPickNumber: skips taken picks, returns null when the board is full', () => {
  assert.equal(nextOpenPickNumber(new Set(), 0, 4), 0);
  assert.equal(nextOpenPickNumber(new Set([0, 1]), 0, 4), 2);
  assert.equal(nextOpenPickNumber(new Set([0, 1, 2, 3]), 0, 4), null);
});
