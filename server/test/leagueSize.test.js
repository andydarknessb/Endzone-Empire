const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_ALLOWED,
  MAX_ALLOWED,
  PICKEM_MAX_ALLOWED,
  resolveMinTeams,
  createSizeError,
  editSizeError,
  meetsMinimum,
  isFull,
  hasOpenSlotsHavingSql,
} = require('../services/leagueSize');

/*
 * Team caps are pinned to the client by this shared fixture (the client's
 * own parity test lives in src/lib/leagueType.test.js), the same pattern the
 * league-phase twins use, rather than a hand-maintained mirror comment.
 */
const sizeFixture = require('../../src/lib/leagueSize.fixture.json');

test('team caps equal the shared client-parity fixture', () => {
  assert.equal(MIN_ALLOWED, sizeFixture.minTeams);
  assert.equal(MAX_ALLOWED, sizeFixture.fantasyMaxTeams);
  assert.equal(PICKEM_MAX_ALLOWED, sizeFixture.pickemMaxTeams);
});

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

test('isFull: no room once the count reaches the cap', () => {
  assert.equal(isFull(0, 10), false, 'empty league');
  assert.equal(isFull(9, 10), false, 'one slot left');
  assert.equal(isFull(10, 10), true, 'at the cap');
  assert.equal(isFull(11, 10), true, 'past the cap (a shrunk cap, never a join)');
  assert.equal(isFull(2, 2), true, 'the smallest league fills at two');
});

test("isFull: the cap is the league's own max_teams, whatever its type", () => {
  // No league-type ceiling here: a pick'em-only league with max_teams 50 is
  // judged against 50, a fantasy league with 12 against 12.
  assert.equal(isFull(49, 50), false);
  assert.equal(isFull(50, 50), true);
  assert.equal(isFull(12, 12), true);
});

test('hasOpenSlotsHavingSql renders the SQL twin of !isFull over an aggregate', () => {
  assert.equal(
    hasOpenSlotsHavingSql('leagues', 'COUNT(DISTINCT "teams"."id")'),
    `COUNT(DISTINCT "teams"."id") < "leagues"."max_teams"`
  );
  assert.equal(hasOpenSlotsHavingSql(null, 'COUNT(*)'), `COUNT(*) < "max_teams"`);
  // The alias is a code literal and is validated as an identifier.
  assert.throws(() => hasOpenSlotsHavingSql('leagues; DROP', 'COUNT(*)'), /bare identifier/);
});
