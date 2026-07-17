const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveMinTeams,
  createSizeError,
  editSizeError,
  meetsMinimum,
} = require('../services/leagueSize');

test('resolveMinTeams: defaults to 8 but never above the cap', () => {
  assert.equal(resolveMinTeams(undefined, 10), 8);
  assert.equal(resolveMinTeams(undefined, 12), 8);
  assert.equal(resolveMinTeams(undefined, 5), 5); // small league: clamp to cap
  assert.equal(resolveMinTeams(4, 10), 4); // explicit value wins
});

test('createSizeError: accepts a valid pair', () => {
  assert.equal(createSizeError({ minTeams: 8, maxTeams: 10 }), null);
  assert.equal(createSizeError({ minTeams: 2, maxTeams: 2 }), null);
});

test('createSizeError: rejects out-of-range and inverted pairs', () => {
  assert.match(createSizeError({ minTeams: 8, maxTeams: 25 }), /maxTeams/);
  assert.match(createSizeError({ minTeams: 1, maxTeams: 10 }), /minTeams/);
  assert.match(createSizeError({ minTeams: 12, maxTeams: 10 }), /minTeams/);
});

test('editSizeError: cap cannot drop below current team count', () => {
  assert.match(
    editSizeError({ newMin: null, newMax: 4, currentMin: 4, currentMax: 10, teamCount: 6 }),
    /cannot be below/
  );
  assert.equal(
    editSizeError({ newMin: null, newMax: 8, currentMin: 4, currentMax: 10, teamCount: 6 }),
    null
  );
});

test('editSizeError: min cannot exceed the effective max', () => {
  assert.match(
    editSizeError({ newMin: 12, newMax: null, currentMin: 4, currentMax: 10, teamCount: 2 }),
    /cannot exceed/
  );
  assert.equal(
    editSizeError({ newMin: 6, newMax: null, currentMin: 4, currentMax: 10, teamCount: 2 }),
    null
  );
});

test('meetsMinimum: draft can start only once the floor is reached', () => {
  assert.equal(meetsMinimum(8, 8), true);
  assert.equal(meetsMinimum(9, 8), true);
  assert.equal(meetsMinimum(7, 8), false);
});
