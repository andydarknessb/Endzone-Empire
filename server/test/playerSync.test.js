const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerEntry } = require('../services/scoring.service');

// Tank01 getNFLPlayerList entry shape: { playerID, longName, pos, team, ... }

test('normalizePlayerEntry maps a Tank01 player entry', () => {
  const parsed = normalizePlayerEntry({
    playerID: '3915511',
    longName: 'Josh Allen',
    pos: 'QB',
    team: 'BUF',
  });
  assert.deepEqual(parsed, {
    externalId: '3915511',
    name: 'Josh Allen',
    position: 'QB',
    nflTeam: 'BUF',
  });
});

test('normalizePlayerEntry uppercases position and stringifies numeric ids', () => {
  const parsed = normalizePlayerEntry({ playerID: 42, longName: 'A Player', pos: 'rb', team: 'KC' });
  assert.equal(parsed.position, 'RB');
  assert.equal(parsed.externalId, '42');
});

test("normalizePlayerEntry translates Tank01's PK to our K", () => {
  const parsed = normalizePlayerEntry({ playerID: '9', longName: 'A Kicker', pos: 'PK', team: 'DAL' });
  assert.equal(parsed.position, 'K');
});

test('normalizePlayerEntry drops non-fantasy positions', () => {
  assert.equal(
    normalizePlayerEntry({ playerID: '1', longName: 'A Lineman', pos: 'OT', team: 'SF' }),
    null
  );
  assert.equal(
    normalizePlayerEntry({ playerID: '2', longName: 'A Backer', pos: 'LB', team: 'SF' }),
    null
  );
});

test('normalizePlayerEntry: missing id, name, or position returns null', () => {
  assert.equal(normalizePlayerEntry({ longName: 'No Id', pos: 'WR' }), null);
  assert.equal(normalizePlayerEntry({ playerID: '1', pos: 'WR' }), null);
  assert.equal(normalizePlayerEntry({ playerID: '1', longName: 'No Position' }), null);
});

test('normalizePlayerEntry: null/undefined entry returns null', () => {
  assert.equal(normalizePlayerEntry(null), null);
  assert.equal(normalizePlayerEntry(undefined), null);
});

test('normalizePlayerEntry tolerates a missing team (free agents)', () => {
  const parsed = normalizePlayerEntry({ playerID: '5', longName: 'Free Agent', pos: 'WR' });
  assert.equal(parsed.nflTeam, null);
});
