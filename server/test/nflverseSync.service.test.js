const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCsv,
  filterDefRowsForWeek,
  buildStatUpdates,
  isNflverseFinalizationDay,
} = require('../services/nflverseSync.service');

// --- parseCsv ------------------------------------------------------------

test('parseCsv maps header row to keyed row objects', () => {
  const text = 'season,week,player_id\n2025,3,00-0039924\n2025,4,00-0026190\n';
  assert.deepEqual(parseCsv(text), [
    { season: '2025', week: '3', player_id: '00-0039924' },
    { season: '2025', week: '4', player_id: '00-0026190' },
  ]);
});

test('parseCsv respects RFC4180 quoting: commas inside quotes stay in one field', () => {
  const text = 'a,b,c\n1,"https://x.example/f_auto,q_auto/img",3\n';
  const rows = parseCsv(text);
  assert.equal(rows[0].b, 'https://x.example/f_auto,q_auto/img');
});

test('parseCsv unescapes doubled quotes inside a quoted field', () => {
  const text = 'name\n"Say ""hi"" now"\n';
  assert.equal(parseCsv(text)[0].name, 'Say "hi" now');
});

test('parseCsv ignores blank trailing lines and handles CRLF', () => {
  const text = 'a,b\r\n1,2\r\n\r\n';
  assert.deepEqual(parseCsv(text), [{ a: '1', b: '2' }]);
});

test('parseCsv on empty text is an empty array', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv(null), []);
});

// --- filterDefRowsForWeek --------------------------------------------------

const DEF_ROWS = [
  { season: '2025', week: '3', season_type: 'REG', player_id: '00-0039924' },
  { season: '2025', week: '4', season_type: 'REG', player_id: '00-0026190' },
  { season: '2025', week: '3', season_type: 'POST', player_id: '00-0011111' },
  { season: '2024', week: '3', season_type: 'REG', player_id: '00-0022222' },
];

test('filterDefRowsForWeek keeps only the matching season/week/REG rows', () => {
  const result = filterDefRowsForWeek(DEF_ROWS, { season: 2025, week: 3 });
  assert.deepEqual(result.map((r) => r.player_id), ['00-0039924']);
});

test('filterDefRowsForWeek on missing/empty input is empty', () => {
  assert.deepEqual(filterDefRowsForWeek(null, { season: 2025, week: 3 }), []);
  assert.deepEqual(filterDefRowsForWeek([], { season: 2025, week: 3 }), []);
});

// --- buildStatUpdates -------------------------------------------------------

test('buildStatUpdates joins gsis_id -> espn_id -> our player id and extracts the finalization fields', () => {
  const defRows = [{
    player_id: '00-0039924',
    def_sack_yards: '9', def_tackles_for_loss_yards: '2',
    def_fumble_recovery_yards_opp: '15', def_fumble_recovery_yards_own: '99',
    def_safety: '1',
  }];
  const crosswalk = new Map([['00-0039924', '4429795']]);
  const knownPlayersByExternalId = new Map([['4429795', 42]]);

  const updates = buildStatUpdates({ defRows, crosswalk, knownPlayersByExternalId });
  assert.deepEqual(updates, [{
    playerId: 42,
    patch: {
      idpSackYards: 9,
      idpTacklesForLossYards: 2,
      idpFumbleReturnYards: 15, // _opp only, never _own
      idpSafety: 1,
    },
  }]);
});

test('buildStatUpdates skips nflverse\'s placeholder rows (player_id "0" / blank)', () => {
  const defRows = [
    { player_id: '0', def_sack_yards: '5' },
    { player_id: '', def_sack_yards: '5' },
  ];
  const crosswalk = new Map();
  const knownPlayersByExternalId = new Map();
  assert.deepEqual(buildStatUpdates({ defRows, crosswalk, knownPlayersByExternalId }), []);
});

test('buildStatUpdates skips a row with no crosswalk match', () => {
  const defRows = [{ player_id: '00-0039924', def_sack_yards: '9' }];
  const updates = buildStatUpdates({
    defRows, crosswalk: new Map(), knownPlayersByExternalId: new Map([['4429795', 42]]),
  });
  assert.deepEqual(updates, []);
});

test('buildStatUpdates skips a row whose crosswalked espn_id isn\'t one of our rostered players', () => {
  const defRows = [{ player_id: '00-0039924', def_sack_yards: '9' }];
  const updates = buildStatUpdates({
    defRows,
    crosswalk: new Map([['00-0039924', '4429795']]),
    knownPlayersByExternalId: new Map(), // player never synced from Tank01
  });
  assert.deepEqual(updates, []);
});

test('buildStatUpdates defaults missing/non-numeric yardage fields to 0', () => {
  const defRows = [{ player_id: '00-0039924' }]; // no def_* fields at all
  const updates = buildStatUpdates({
    defRows,
    crosswalk: new Map([['00-0039924', '4429795']]),
    knownPlayersByExternalId: new Map([['4429795', 42]]),
  });
  assert.deepEqual(updates[0].patch, {
    idpSackYards: 0, idpTacklesForLossYards: 0, idpFumbleReturnYards: 0, idpSafety: 0,
  });
});

// --- isNflverseFinalizationDay ---------------------------------------------

test('isNflverseFinalizationDay is true Monday through Thursday', () => {
  // 2026-07-20 is a Monday; 2026-07-21..23 are Tue/Wed/Thu.
  for (const day of [20, 21, 22, 23]) {
    assert.equal(isNflverseFinalizationDay(new Date(2026, 6, day)), true, `day ${day}`);
  }
});

test('isNflverseFinalizationDay is false Friday through Sunday', () => {
  // 2026-07-24 is a Friday; 25 Sat; 26 Sun.
  for (const day of [24, 25, 26]) {
    assert.equal(isNflverseFinalizationDay(new Date(2026, 6, day)), false, `day ${day}`);
  }
});
