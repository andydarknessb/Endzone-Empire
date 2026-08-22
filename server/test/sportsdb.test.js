const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSportsDbPosition,
  normalizeNameKey,
  normalizeSportsDbPlayer,
  teamMatches,
  buildPhotoUpdates,
} = require('../services/sportsdb.service');

// --- normalizeSportsDbPosition ---------------------------------------------

test('normalizeSportsDbPosition maps spelled-out positions to slot codes', () => {
  assert.equal(normalizeSportsDbPosition('Quarterback'), 'QB');
  assert.equal(normalizeSportsDbPosition('Running Back'), 'RB');
  assert.equal(normalizeSportsDbPosition('Wide Receiver'), 'WR');
  assert.equal(normalizeSportsDbPosition('Tight End'), 'TE');
  assert.equal(normalizeSportsDbPosition('Placekicker'), 'K');
});

test('normalizeSportsDbPosition returns null for non-fantasy / unknown positions', () => {
  assert.equal(normalizeSportsDbPosition('Offensive Tackle'), null);
  assert.equal(normalizeSportsDbPosition('Cornerback'), null);
  assert.equal(normalizeSportsDbPosition(''), null);
  assert.equal(normalizeSportsDbPosition(null), null);
});

// --- normalizeNameKey -------------------------------------------------------

test('normalizeNameKey strips punctuation, accents, and generational suffixes', () => {
  assert.equal(normalizeNameKey("Ja'Marr Chase"), 'jamarr chase');
  assert.equal(normalizeNameKey('A.J. Brown'), 'aj brown');
  assert.equal(normalizeNameKey('Amon-Ra St. Brown'), 'amon ra st brown');
  assert.equal(normalizeNameKey('Michael Pittman Jr.'), 'michael pittman');
  assert.equal(normalizeNameKey('San Nicolás'), 'san nicolas');
});

test('normalizeNameKey is stable across provider spellings of the same name', () => {
  assert.equal(normalizeNameKey("Ja'Marr Chase"), normalizeNameKey('JaMarr Chase'));
  assert.equal(normalizeNameKey('A.J. Brown'), normalizeNameKey('AJ Brown'));
});

// --- normalizeSportsDbPlayer ------------------------------------------------

test('normalizeSportsDbPlayer extracts photo, jersey, position, and team', () => {
  const out = normalizeSportsDbPlayer({
    strPlayer: 'Patrick Mahomes',
    strPosition: 'Quarterback',
    strNumber: '15',
    strThumb: 'https://img/thumb.jpg',
    strCutout: 'https://img/cutout.png',
    strTeam: 'Kansas City Chiefs',
    strTeamShort: 'KC',
  });
  assert.equal(out.name, 'Patrick Mahomes');
  assert.equal(out.nameKey, 'patrick mahomes');
  assert.equal(out.position, 'QB');
  assert.equal(out.jerseyNumber, '15');
  assert.equal(out.photoUrl, 'https://img/thumb.jpg'); // prefers the headshot thumb
  assert.equal(out.teamShort, 'KC');
});

test('normalizeSportsDbPlayer falls back to the cutout when no thumb', () => {
  const out = normalizeSportsDbPlayer({ strPlayer: 'X Y', strCutout: 'https://img/c.png' });
  assert.equal(out.photoUrl, 'https://img/c.png');
});

test('normalizeSportsDbPlayer: no usable name returns null; missing photo/jersey are null', () => {
  assert.equal(normalizeSportsDbPlayer({ strPosition: 'Quarterback' }), null);
  const out = normalizeSportsDbPlayer({ strPlayer: 'No Photo', strNumber: '' });
  assert.equal(out.photoUrl, null);
  assert.equal(out.jerseyNumber, null);
});

// --- teamMatches ------------------------------------------------------------

test('teamMatches accepts either the full name or the abbreviation', () => {
  const entry = { team: 'Kansas City Chiefs', teamShort: 'KC' };
  assert.equal(teamMatches('Kansas City Chiefs', entry), true); // seeded full name
  assert.equal(teamMatches('KC', entry), true); // Tank01 abbreviation
  assert.equal(teamMatches('Buffalo Bills', entry), false);
  assert.equal(teamMatches(null, entry), false);
});

// --- buildPhotoUpdates (the matching core) ---------------------------------

const entries = [
  { nameKey: 'patrick mahomes', photoUrl: 'https://img/pm.jpg', jerseyNumber: '15', team: 'Kansas City Chiefs', teamShort: 'KC' },
  { nameKey: 'josh allen', photoUrl: 'https://img/ja-buf.jpg', jerseyNumber: '17', team: 'Buffalo Bills', teamShort: 'BUF' },
  { nameKey: 'josh allen', photoUrl: 'https://img/ja-jax.jpg', jerseyNumber: '41', team: 'Jacksonville Jaguars', teamShort: 'JAX' },
];

test('buildPhotoUpdates matches by name and returns photo + jersey', () => {
  const updates = buildPhotoUpdates([{ id: 1, name: 'Patrick Mahomes', nfl_team: 'KC' }], entries);
  assert.deepEqual(updates, [{ id: 1, photoUrl: 'https://img/pm.jpg', jerseyNumber: '15' }]);
});

test('buildPhotoUpdates disambiguates same-named players by team', () => {
  const updates = buildPhotoUpdates(
    [{ id: 2, name: 'Josh Allen', nfl_team: 'Jacksonville Jaguars' }],
    entries
  );
  assert.equal(updates[0].jerseyNumber, '41'); // the Jaguars LB, not the Bills QB
});

test('buildPhotoUpdates falls back to the first candidate when no team matches', () => {
  const updates = buildPhotoUpdates([{ id: 3, name: 'Josh Allen', nfl_team: 'Denver Broncos' }], entries);
  assert.equal(updates[0].jerseyNumber, '17'); // first listed
});

test('buildPhotoUpdates skips unmatched players and photo/jersey-less entries', () => {
  const updates = buildPhotoUpdates(
    [
      { id: 4, name: 'Nobody Here', nfl_team: 'KC' },
      { id: 5, name: 'Blank Guy', nfl_team: 'KC' },
    ],
    [{ nameKey: 'blank guy', photoUrl: null, jerseyNumber: null }]
  );
  assert.deepEqual(updates, []);
});
