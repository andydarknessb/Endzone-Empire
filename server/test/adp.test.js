const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const adpService = require('../services/adp.service');
const {
  normalizeAdpPosition,
  normalizeAdpEntry,
  buildAdpUpdates,
  syncAdp,
  MARKET_FLOOR,
  MARKET_STALE_DAYS,
} = adpService;
const { NFL_TEAM_FULL_NAMES } = require('../services/nflTeam');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

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

// ---- the wipe guard + data_sync_runs record (#747) -------------------------

// The exported floor is the market-health threshold every gate reads: below it
// the ADP job refuses to write and the draft refuses to start (#747, decision 2).
test('MARKET_FLOOR and MARKET_STALE_DAYS are exported numbers', () => {
  assert.equal(MARKET_FLOOR, 100);
  assert.equal(MARKET_STALE_DAYS, 7);
});

// A FFC "Success" body of `count` distinct, well-formed players. Each row
// normalizes to a usable entry, so entries.length === count and the guard reads
// count directly.
const ffcBody = (count) => ({
  status: 'Success',
  players: Array.from({ length: count }, (_, i) => ({
    name: `Player ${i + 1}`,
    position: 'RB',
    team: 'KC',
    adp: i + 1,
  })),
});

function stubFfc(t, body) {
  t.mock.method(axios, 'create', () => ({ get: async () => ({ data: body }) }));
}

const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));
// The INSERT is ("job","started_at","finished_at","ok","detail") with values
// ($1,$2,now(),$3,$4::jsonb): ok is params[2], the detail JSON is params[3].
const runOk = (call) => call.params[2];
const runDetail = (call) => JSON.parse(call.params[3]);

test('syncAdp wipe guard: a thin Success body writes nothing to players and records ok=false', async (t) => {
  // The point of the ticket: a Success body too short to be a real market must
  // not be allowed to NULL every ADP. 50 usable entries is below MARKET_FLOOR.
  stubFfc(t, ffcBody(MARKET_FLOOR - 50));
  const fake = createFakePool([
    // No players SELECT/UPDATE handler on purpose: if the guard let execution
    // reach either, fakePool throws "unexpected query" and this test goes red.
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }], rowCount: 1 })],
  ]).install(t);

  const result = await syncAdp();

  assert.equal(result.ok, false);
  assert.equal(fake.matching(update('players')).length, 0, 'the market must not be wiped');
  assert.equal(fake.matching(select('players')).length, 0, 'a refused run does not even read the roster');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1, 'exactly one run recorded');
  assert.equal(runOk(runs[0]), false);
  assert.equal(runDetail(runs[0]).adpPlayers, MARKET_FLOOR - 50, 'the thin count is recorded for diagnosis');
});

test('syncAdp on a full Success body refreshes players and records ok=true with the matched count', async (t) => {
  // 200 usable entries clears MARKET_FLOOR, so the reset-and-set runs. Lowering
  // this fixture below MARKET_FLOOR (e.g. to 99) trips the guard above instead,
  // turning the ok=true assertion red - the guard's other half.
  stubFfc(t, ffcBody(200));
  const fake = createFakePool([
    [select('players'), () => ({
      rows: [
        { id: 1, name: 'Player 1', position: 'RB', nfl_team: 'KC' },
        { id: 2, name: 'Player 2', position: 'RB', nfl_team: 'KC' },
      ],
    })],
    [update('players'), () => ({ rows: [], rowCount: 2 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }], rowCount: 1 })],
  ]).install(t);

  const result = await syncAdp();

  assert.equal(result.ok, true);
  assert.equal(result.playersMatched, 2);
  // The reset-and-set: one NULL wipe and one bulk set, both after the guard.
  assert.equal(fake.matching(/^UPDATE "players" SET "adp" = NULL/).length, 1);
  assert.equal(fake.matching(/^UPDATE "players" p SET "adp"/).length, 1);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runOk(runs[0]), true);
  assert.equal(runDetail(runs[0]).matched, 2, 'the matched count is recorded');
  assert.equal(runDetail(runs[0]).adpPlayers, 200);
});
