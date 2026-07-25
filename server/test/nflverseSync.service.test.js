const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCsv,
  filterRowsForWeek,
  buildStatUpdates,
  parseFgMadeList,
  nflverseTeamToOurAbbr,
  normalizeNflversePlayerStats,
  buildFullStatUpdates,
  buildDstStatUpdates,
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

// --- filterRowsForWeek -------------------------------------------------------

const DEF_ROWS = [
  { season: '2025', week: '3', season_type: 'REG', player_id: '00-0039924' },
  { season: '2025', week: '4', season_type: 'REG', player_id: '00-0026190' },
  { season: '2025', week: '3', season_type: 'POST', player_id: '00-0011111' },
  { season: '2024', week: '3', season_type: 'REG', player_id: '00-0022222' },
];

test('filterRowsForWeek keeps only the matching season/week/REG rows', () => {
  const result = filterRowsForWeek(DEF_ROWS, { season: 2025, week: 3 });
  assert.deepEqual(result.map((r) => r.player_id), ['00-0039924']);
});

test('filterRowsForWeek on missing/empty input is empty', () => {
  assert.deepEqual(filterRowsForWeek(null, { season: 2025, week: 3 }), []);
  assert.deepEqual(filterRowsForWeek([], { season: 2025, week: 3 }), []);
});

// --- buildStatUpdates -------------------------------------------------------

test('buildStatUpdates joins gsis_id -> espn_id -> our player id and extracts the finalization fields', () => {
  const defRows = [{
    player_id: '00-0039924',
    def_sack_yards: '9', def_tackles_for_loss_yards: '2',
    fumble_recovery_yards_opp: '15', fumble_recovery_yards_own: '99',
    def_safeties: '1',
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

test('buildStatUpdates still reads the pre-2025 column names (def_ prefix, singular safety)', () => {
  const defRows = [{
    player_id: '00-0039924',
    def_sack_yards: '9', def_tackles_for_loss_yards: '2',
    def_fumble_recovery_yards_opp: '15', def_fumble_recovery_yards_own: '99',
    def_safety: '1',
  }];
  const updates = buildStatUpdates({
    defRows,
    crosswalk: new Map([['00-0039924', '4429795']]),
    knownPlayersByExternalId: new Map([['4429795', 42]]),
  });
  assert.deepEqual(updates[0].patch, {
    idpSackYards: 9, idpTacklesForLossYards: 2, idpFumbleReturnYards: 15, idpSafety: 1,
  });
});

test('buildStatUpdates skips all-zero patches — the combined file lists every offensive player too', () => {
  const defRows = [{ player_id: '00-0011111', def_sack_yards: '0', def_safeties: '0' }];
  const updates = buildStatUpdates({
    defRows,
    crosswalk: new Map([['00-0011111', '5555']]),
    knownPlayersByExternalId: new Map([['5555', 7]]),
  });
  assert.deepEqual(updates, []);
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

test('buildStatUpdates treats missing/non-numeric yardage fields as 0 (and so skips the row)', () => {
  const defRows = [{ player_id: '00-0039924', def_sack_yards: 'not-a-number' }];
  const updates = buildStatUpdates({
    defRows,
    crosswalk: new Map([['00-0039924', '4429795']]),
    knownPlayersByExternalId: new Map([['4429795', 42]]),
  });
  assert.deepEqual(updates, []); // all four coerced to 0 -> no-op patch, skipped
});

// --- full-week backfill helpers ----------------------------------------------

test('parseFgMadeList splits fg_made_list into numeric distances', () => {
  assert.deepEqual(parseFgMadeList('25;43;32'), [25, 43, 32]);
  assert.deepEqual(parseFgMadeList('52'), [52]);
  assert.deepEqual(parseFgMadeList(''), []);
  assert.deepEqual(parseFgMadeList(undefined), []);
  assert.deepEqual(parseFgMadeList('25;;x'), [25]);
});

test('nflverseTeamToOurAbbr maps only the Rams', () => {
  assert.equal(nflverseTeamToOurAbbr('LA'), 'LAR');
  assert.equal(nflverseTeamToOurAbbr('LAC'), 'LAC');
  assert.equal(nflverseTeamToOurAbbr('KC'), 'KC');
});

test('normalizeNflversePlayerStats maps a kicker row with exact FG distances and miss counts', () => {
  const stats = normalizeNflversePlayerStats({
    fg_made: '3', fg_made_list: '25;43;32', fg_missed: '1', pat_made: '2', pat_missed: '1',
  });
  assert.equal(stats.fieldGoal, 3);
  assert.deepEqual(stats.fieldGoalDistances, [25, 43, 32]);
  assert.equal(stats.fieldGoalMissed, 1);
  assert.equal(stats.extraPoint, 2);
  assert.equal(stats.extraPointMissed, 1);
  assert.equal(stats.passingYards, 0);
});

test('normalizeNflversePlayerStats maps punt AND kickoff return yardage (Tank01 only sees punts)', () => {
  const stats = normalizeNflversePlayerStats({
    punt_returns: '2', punt_return_yards: '31', kickoff_returns: '3', kickoff_return_yards: '74',
    special_teams_tds: '1',
  });
  assert.equal(stats.puntReturnYards, 31);
  assert.equal(stats.kickReturns, 3);
  assert.equal(stats.kickReturnYards, 74);
  assert.equal(stats.returnTDs, 1);
});

test('normalizeNflversePlayerStats maps offense including per-category two-point conversions', () => {
  const stats = normalizeNflversePlayerStats({
    passing_yards: '244', passing_tds: '4', passing_interceptions: '1',
    passing_2pt_conversions: '1', rushing_yards: '12', rushing_tds: '1',
    rushing_2pt_conversions: '0', receptions: '5', receiving_yards: '61',
    receiving_tds: '0', receiving_2pt_conversions: '1',
    fumbles_lost_total: '1', special_teams_tds: '1',
    punt_returns: '2', punt_return_yards: '31',
  });
  assert.equal(stats.passingYards, 244);
  assert.equal(stats.passingTDs, 4);
  assert.equal(stats.interceptions, 1);
  assert.equal(stats.passingTwoPt, 1);
  assert.equal(stats.receivingTwoPt, 1);
  assert.equal(stats.fumbles, 1);
  assert.equal(stats.returnTDs, 1);
  assert.equal(stats.puntReturnYards, 31);
});

test('normalizeNflversePlayerStats maps IDP including the finalization-only yardage keys', () => {
  const stats = normalizeNflversePlayerStats({
    def_tackles_solo: '6', def_tackle_assists: '3', def_sacks: '1.5',
    def_sack_yards: '11', def_interceptions: '1', def_fumbles_forced: '1',
    fumble_recovery_opp: '1', fumble_recovery_yards_opp: '15',
    fumble_recovery_tds: '1', def_pass_defended: '2', def_qb_hits: '3',
    def_tackles_for_loss: '2', def_tackles_for_loss_yards: '5', def_safeties: '1',
  });
  assert.equal(stats.soloTackle, 6);
  assert.equal(stats.assistedTackle, 3);
  assert.equal(stats.idpSack, 1.5);
  assert.equal(stats.idpSackYards, 11);
  assert.equal(stats.idpFumbleRecovery, 1);
  assert.equal(stats.idpFumbleReturnYards, 15);
  assert.equal(stats.idpDefensiveTD, 1);
  assert.equal(stats.idpSafety, 1);
  assert.equal(stats.twoPointReturn, 0); // no nflverse weekly column
});

test('buildFullStatUpdates joins via the crosswalk and skips unknown players', () => {
  const rows = [
    { player_id: '00-0039924', passing_yards: '300' },
    { player_id: '00-0000001', passing_yards: '250' }, // no crosswalk entry
    { player_id: '0', passing_yards: '99' },           // placeholder row
  ];
  const updates = buildFullStatUpdates({
    rows,
    crosswalk: new Map([['00-0039924', '4429795']]),
    knownPlayersByExternalId: new Map([['4429795', 42]]),
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].playerId, 42);
  assert.equal(updates[0].stats.passingYards, 300);
});

test('buildDstStatUpdates builds one DST line per team from its own defense + opponent allowances', () => {
  const teamRows = [
    {
      game_id: '2025_01_BAL_BUF', team: 'BUF', opponent_team: 'BAL',
      def_sacks: '2', def_interceptions: '1', fumble_recovery_opp: '1',
      def_tds: '1', def_safeties: '0',
      passing_yards: '394', sack_yards_lost: '-5', rushing_yards: '108',
      fg_blocked: '0', pat_blocked: '0', pt_blocked: '0',
    },
    {
      game_id: '2025_01_BAL_BUF', team: 'BAL', opponent_team: 'BUF',
      def_sacks: '1', def_interceptions: '0', fumble_recovery_opp: '0',
      def_tds: '0', def_safeties: '0',
      passing_yards: '209', sack_yards_lost: '-15', rushing_yards: '238',
      fg_blocked: '1', pat_blocked: '1', pt_blocked: '0',
    },
  ];
  const scoresByGameId = new Map([
    ['2025_01_BAL_BUF', { homeTeam: 'BUF', awayTeam: 'BAL', homeScore: 41, awayScore: 40 }],
  ]);

  const updates = buildDstStatUpdates({ teamRows, scoresByGameId });
  const buf = updates.find((u) => u.teamAbbr === 'BUF');
  const bal = updates.find((u) => u.teamAbbr === 'BAL');

  // BUF's defense: its own def_* columns; what it allowed comes from BAL's row.
  assert.deepEqual(buf.stats, {
    sack: 2, interceptionReturn: 1, fumbleRecovery: 1, defensiveTD: 1, safety: 0,
    blockedKick: 2,          // BAL's own fg_blocked + pat_blocked + pt_blocked
    pointsAllowed: 40,       // away score — BUF is home
    yardsAllowed: 432,       // BAL net: 209 + (-15) + 238
  });
  assert.equal(bal.stats.pointsAllowed, 41);
  assert.equal(bal.stats.yardsAllowed, 394 - 5 + 108);
  assert.equal(bal.stats.blockedKick, 0);
});

test('buildDstStatUpdates maps the Rams to LAR and drops games with no score row', () => {
  const teamRows = [
    { game_id: '2025_02_LA_SF', team: 'LA', opponent_team: 'SF', def_sacks: '3', passing_yards: '0', sack_yards_lost: '0', rushing_yards: '0' },
    { game_id: '2025_02_LA_SF', team: 'SF', opponent_team: 'LA', def_sacks: '1', passing_yards: '0', sack_yards_lost: '0', rushing_yards: '0' },
    { game_id: '2025_02_KC_NE', team: 'KC', opponent_team: 'NE', def_sacks: '4', passing_yards: '0', sack_yards_lost: '0', rushing_yards: '0' },
    // NE row missing -> KC has no opponent row either way
  ];
  const scoresByGameId = new Map([
    ['2025_02_LA_SF', { homeTeam: 'SF', awayTeam: 'LA', homeScore: 20, awayScore: 17 }],
    // 2025_02_KC_NE deliberately absent
  ]);

  const updates = buildDstStatUpdates({ teamRows, scoresByGameId });
  assert.deepEqual(updates.map((u) => u.teamAbbr).sort(), ['LAR', 'SF']);
  const lar = updates.find((u) => u.teamAbbr === 'LAR');
  assert.equal(lar.stats.pointsAllowed, 20); // LA is away, allows the home score
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
