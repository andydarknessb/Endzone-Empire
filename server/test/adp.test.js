const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAdpPosition,
  normalizeAdpEntry,
  buildAdpUpdates,
} = require('../services/adp.service');
const { NFL_TEAM_FULL_NAMES } = require('../services/nflTeam');

test('normalizeAdpPosition maps FFC PK to our K, passes others through', () => {
  assert.equal(normalizeAdpPosition('PK'), 'K');
  assert.equal(normalizeAdpPosition('rb'), 'RB');
  assert.equal(normalizeAdpPosition('DEF'), 'DEF');
});

test('normalizeAdpEntry extracts name key, position, team code, and numeric adp', () => {
  const out = normalizeAdpEntry({ name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: '1.6' });
  assert.equal(out.nameKey, 'bijan robinson');
  assert.equal(out.position, 'RB');
  assert.equal(out.teamAbbr, 'ATL');
  assert.equal(out.adp, 1.6);
});

test('normalizeAdpEntry rejects rows without a name or a positive adp', () => {
  assert.equal(normalizeAdpEntry({ position: 'RB', adp: 5 }), null);
  assert.equal(normalizeAdpEntry({ name: 'X', adp: 0 }), null);
  assert.equal(normalizeAdpEntry({ name: 'X', adp: 'n/a' }), null);
});

const entries = [
  { name: "Ja'Marr Chase", nameKey: 'jamarr chase', position: 'WR', adp: 2.1 },
  { name: 'Josh Allen', nameKey: 'josh allen', position: 'QB', adp: 30.5 },
  { name: 'Josh Allen', nameKey: 'josh allen', position: 'LB', adp: 180.0 },
];

test('buildAdpUpdates matches by folded name (punctuation-insensitive)', () => {
  const updates = buildAdpUpdates([{ id: 9, name: 'JaMarr Chase', position: 'WR' }], entries);
  assert.deepEqual(updates, [{ id: 9, adp: 2.1 }]);
});

test('buildAdpUpdates disambiguates same-named players by position', () => {
  const updates = buildAdpUpdates([{ id: 1, name: 'Josh Allen', position: 'QB' }], entries);
  assert.equal(updates[0].adp, 30.5); // the QB, not the LB
});

test('buildAdpUpdates leaves unmatched (undrafted) players out', () => {
  const updates = buildAdpUpdates([{ id: 2, name: 'Deep Sleeper', position: 'WR' }], entries);
  assert.deepEqual(updates, []);
});

// FFC names defenses "Denver Defense" while our DEF rows are "Denver Broncos" —
// the team code is the only key that lines up, so DEF matches on it alone.
const defEntries = [
  { name: 'Denver Defense', nameKey: 'denver defense', position: 'DEF', teamAbbr: 'DEN', adp: 101.1 },
  { name: 'LA Rams Defense', nameKey: 'la rams defense', position: 'DEF', teamAbbr: 'LAR', adp: 108.7 },
];

test('buildAdpUpdates matches a DEF row by team code, not name', () => {
  const updates = buildAdpUpdates(
    [
      { id: 50, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos' },
      { id: 51, name: 'Los Angeles Rams', position: 'DEF', nfl_team: 'Los Angeles Rams' },
    ],
    defEntries
  );
  assert.deepEqual(updates, [{ id: 50, adp: 101.1 }, { id: 51, adp: 108.7 }]);
});

test('buildAdpUpdates leaves a DEF with no FFC entry (undrafted defense) null', () => {
  const updates = buildAdpUpdates(
    [{ id: 52, name: 'Carolina Panthers', position: 'DEF', nfl_team: 'Carolina Panthers' }],
    defEntries
  );
  assert.deepEqual(updates, []);
});

test('buildAdpUpdates matches a DEF row whose nfl_team is already an abbreviation', () => {
  const updates = buildAdpUpdates(
    [{ id: 53, name: 'Denver Broncos', position: 'DEF', nfl_team: 'DEN' }],
    defEntries
  );
  assert.deepEqual(updates, [{ id: 53, adp: 101.1 }]);
});

test('buildAdpUpdates matches a DEF row across a raw-spelling mismatch (FFC WSH vs our full name)', () => {
  // Washington: our DEF row spells its team the full-name way
  // ("Washington Commanders"); FFC spells it the Tank01-style raw code
  // ("WSH"). Only folding both sides through normalizeNflTeam reconciles them.
  const updates = buildAdpUpdates(
    [{ id: 70, name: 'Washington Commanders', position: 'DEF', nfl_team: 'Washington Commanders' }],
    [
      normalizeAdpEntry({ position: 'DEF', team: 'WSH', name: 'Washington Defense', adp: 150.2 }),
    ]
  );
  assert.deepEqual(updates, [{ id: 70, adp: 150.2 }]);
});

test('buildAdpUpdates matches every canonical team\'s DEF row by its full name', () => {
  // Driven from NFL_TEAM_FULL_NAMES itself (not a literal list): every one of
  // the 32 canonical teams must still match its own full-name DEF row after
  // the switch to normalizeNflTeam, proving the switch changed nothing here.
  const fullNames = Object.keys(NFL_TEAM_FULL_NAMES);
  const players = fullNames.map((fullName, i) => ({
    id: i,
    name: fullName,
    position: 'DEF',
    nfl_team: fullName,
  }));
  const defEntries = fullNames.map((fullName, i) =>
    normalizeAdpEntry({ position: 'DEF', team: NFL_TEAM_FULL_NAMES[fullName], name: `${fullName} Defense`, adp: i + 1 })
  );
  const updates = buildAdpUpdates(players, defEntries);
  assert.deepEqual(
    updates,
    players.map((p) => ({ id: p.id, adp: p.id + 1 }))
  );
});

test('an IDP player never inherits a same-named offensive player\'s ADP', () => {
  // Real hazard, live in the players table: Browns LB Justin Jefferson vs the
  // Vikings WR. FFC has no IDP entries, so any IDP name hit is a false one.
  const updates = buildAdpUpdates(
    [
      { id: 60, name: 'Justin Jefferson', position: 'LB', nfl_team: 'CLE' },
      { id: 61, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN' },
    ],
    [{ name: 'Justin Jefferson', nameKey: 'justin jefferson', position: 'WR', teamAbbr: 'MIN', adp: 13.7 }]
  );
  assert.deepEqual(updates, [{ id: 61, adp: 13.7 }]); // the WR only
});
