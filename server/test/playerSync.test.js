const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlayerEntry, resolveHeadshotUrl } = require('../services/scoring.service');

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
    photoUrl: null,
    jerseyNumber: null,
  });
});

test('normalizePlayerEntry carries the provider headshot and jersey number', () => {
  const parsed = normalizePlayerEntry({
    playerID: '3915511',
    longName: 'Josh Allen',
    pos: 'QB',
    team: 'BUF',
    espnHeadshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png',
    jerseyNum: '17',
  });
  assert.equal(parsed.photoUrl, 'https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png');
  assert.equal(parsed.jerseyNumber, '17');
});

test('resolveHeadshotUrl builds the ESPN URL from espnID when no headshot is given', () => {
  assert.equal(
    resolveHeadshotUrl({ espnID: '3918298' }),
    'https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png'
  );
});

test('resolveHeadshotUrl prefers a provided http headshot over espnID', () => {
  assert.equal(
    resolveHeadshotUrl({ espnHeadshot: 'https://img.example/x.png', espnID: '999' }),
    'https://img.example/x.png'
  );
});

test('resolveHeadshotUrl returns null when nothing usable is present', () => {
  assert.equal(resolveHeadshotUrl({}), null);
  assert.equal(resolveHeadshotUrl({ espnID: 'not-a-number' }), null);
  assert.equal(resolveHeadshotUrl({ espnHeadshot: 'ftp://nope' }), null);
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
    normalizePlayerEntry({ playerID: '2', longName: 'A Center', pos: 'C', team: 'SF' }),
    null
  );
});

test('normalizePlayerEntry keeps individual defenders (DL/LB/DB group members) for DP-enabled leagues', () => {
  for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) {
    const parsed = normalizePlayerEntry({ playerID: `d-${pos}`, longName: 'A Defender', pos, team: 'SF' });
    assert.equal(parsed.position, pos); // keeps its specific Tank01 position, unlike PK->K
  }
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
