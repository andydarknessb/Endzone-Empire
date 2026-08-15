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

test('resolveMinTeams: pick\'em-only defaults the floor to 2', () => {
  assert.equal(resolveMinTeams(undefined, 50, { pickemOnly: true }), 2);
  assert.equal(resolveMinTeams(undefined, 10, { pickemOnly: true }), 2);
  assert.equal(resolveMinTeams(6, 50, { pickemOnly: true }), 6); // explicit value wins
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

test('createSizeError: pick\'em-only cap is 50, and the error names it', () => {
  assert.equal(createSizeError({ minTeams: 2, maxTeams: 50, pickemOnly: true }), null);
  assert.match(createSizeError({ minTeams: 2, maxTeams: 51, pickemOnly: true }), /between 2 and 50/);
});

test('createSizeError: fantasy leagues stay capped at 20', () => {
  assert.match(createSizeError({ minTeams: 2, maxTeams: 21 }), /between 2 and 20/);
  assert.match(createSizeError({ minTeams: 2, maxTeams: 50, pickemOnly: false }), /between 2 and 20/);
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

test('editSizeError: honors the per-mode cap', () => {
  assert.equal(
    editSizeError({ newMin: null, newMax: 50, currentMin: 2, currentMax: 10, teamCount: 4, pickemOnly: true }),
    null
  );
  assert.match(
    editSizeError({ newMin: null, newMax: 51, currentMin: 2, currentMax: 10, teamCount: 4, pickemOnly: true }),
    /between 2 and 50/
  );
  assert.match(
    editSizeError({ newMin: null, newMax: 50, currentMin: 2, currentMax: 10, teamCount: 4 }),
    /between 2 and 20/
  );
  // The min branch takes the same per-mode cap as the max branch.
  assert.equal(
    editSizeError({ newMin: 25, newMax: 50, currentMin: 2, currentMax: 10, teamCount: 4, pickemOnly: true }),
    null
  );
  assert.match(
    editSizeError({ newMin: 25, newMax: null, currentMin: 2, currentMax: 10, teamCount: 4 }),
    /minTeams must be an integer between 2 and 20/
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
