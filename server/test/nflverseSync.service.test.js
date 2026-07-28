const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
  parseCsv,
  filterRowsForWeek,
  buildStatUpdates,
  parseFgMadeList,
  nflverseTeamToOurAbbr,
  optionalTeamAbbr,
  nflverseTeamToScheduleAbbr,
  etKickoffToUtc,
  buildScheduleRows,
  syncScheduleFromNflverse,
  normalizeNflversePlayerStats,
  buildFullStatUpdates,
  buildDstStatUpdates,
  isNflverseFinalizationDay,
} = require('../services/nflverseSync.service');
const scoring = require('../services/scoring.service');

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
    def_interception_yards: '27',
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
      idpInterceptionReturnYards: 27,
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
    idpSackYards: 9, idpTacklesForLossYards: 2, idpFumbleReturnYards: 15,
    idpInterceptionReturnYards: 0, // column didn't exist in the old files
    idpSafety: 1,
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
    def_sack_yards: '11', def_interceptions: '1', def_interception_yards: '34',
    def_fumbles_forced: '1',
    fumble_recovery_opp: '1', fumble_recovery_yards_opp: '15',
    fumble_recovery_tds: '1', def_pass_defended: '2', def_qb_hits: '3',
    def_tackles_for_loss: '2', def_tackles_for_loss_yards: '5', def_safeties: '1',
  });
  assert.equal(stats.soloTackle, 6);
  assert.equal(stats.assistedTackle, 3);
  assert.equal(stats.idpSack, 1.5);
  assert.equal(stats.idpSackYards, 11);
  assert.equal(stats.idpInterception, 1);
  assert.equal(stats.idpInterceptionReturnYards, 34);
  assert.equal(stats.idpFumbleRecovery, 1);
  assert.equal(stats.idpFumbleReturnYards, 15);
  assert.equal(stats.idpDefensiveTD, 1);
  assert.equal(stats.idpSafety, 1);
  assert.equal(stats.twoPointReturn, 0); // no nflverse weekly column
});

// --- gameTeam / gameOpponent (per-week game context in the stats jsonb) ------

test('normalizeNflversePlayerStats records the team a line was earned for and against', () => {
  const stats = normalizeNflversePlayerStats({
    team: 'KC', opponent_team: 'BUF', receiving_yards: '80',
  });
  assert.equal(stats.gameTeam, 'KC');
  assert.equal(stats.gameOpponent, 'BUF');
});

test('normalizeNflversePlayerStats maps game-context teams through our abbreviations (LA -> LAR)', () => {
  const forRams = normalizeNflversePlayerStats({ team: 'LA', opponent_team: 'SF' });
  assert.equal(forRams.gameTeam, 'LAR');
  const againstRams = normalizeNflversePlayerStats({ team: 'SF', opponent_team: 'LA' });
  assert.equal(againstRams.gameOpponent, 'LAR');
  // Kills the "store the raw nflverse code" mutant: LA would never join to LAR.
});

test('normalizeNflversePlayerStats leaves absent game-context columns null, never a blank team', () => {
  for (const row of [{}, { team: '', opponent_team: '   ' }, { team: 'NA', opponent_team: 'NA' }]) {
    const stats = normalizeNflversePlayerStats(row);
    assert.equal(stats.gameTeam, null, JSON.stringify(row));
    assert.equal(stats.gameOpponent, null, JSON.stringify(row));
  }
});

test('normalizeNflversePlayerStats: per-week usage columns stay null when the file lacks them', () => {
  const stats = normalizeNflversePlayerStats({ team: 'KC', opponent_team: 'BUF' });
  for (const key of ['usagePassAttempts', 'usageCompletions', 'usageCarries', 'usageTargets', 'usageAirYards']) {
    assert.equal(stats[key], null, `${key} must stay unknown, not become 0`);
  }
  const known = normalizeNflversePlayerStats({ targets: '0', carries: '11', receiving_air_yards: '84' });
  assert.equal(known.usageTargets, 0, 'a real 0 in the file is still a real 0');
  assert.equal(known.usageCarries, 11);
  assert.equal(known.usageAirYards, 84);
});

test('game-context and usage keys do not change the fantasy points of a stat line', () => {
  const row = {
    team: 'KC', opponent_team: 'BUF', targets: '9', carries: '3', receiving_air_yards: '77',
    receiving_yards: '80', receiving_tds: '1', receptions: '6',
  };
  const withContext = normalizeNflversePlayerStats(row);
  const withoutContext = { ...withContext };
  for (const key of [
    'gameTeam', 'gameOpponent', 'usagePassAttempts', 'usageCompletions',
    'usageCarries', 'usageTargets', 'usageAirYards',
  ]) {
    delete withoutContext[key];
  }
  assert.equal(
    scoring.calculateFantasyPoints(withContext),
    scoring.calculateFantasyPoints(withoutContext),
    'calculateFantasyPoints must keep ignoring the unscored context keys'
  );
});

test('buildDstStatUpdates records game context on both sides of the game', () => {
  const teamRows = [
    { game_id: '2025_02_LA_SF', team: 'LA', opponent_team: 'SF', passing_yards: '0', sack_yards_lost: '0', rushing_yards: '0' },
    { game_id: '2025_02_LA_SF', team: 'SF', opponent_team: 'LA', passing_yards: '0', sack_yards_lost: '0', rushing_yards: '0' },
  ];
  const scoresByGameId = new Map([
    ['2025_02_LA_SF', { homeTeam: 'SF', awayTeam: 'LA', homeScore: 20, awayScore: 17 }],
  ]);
  const updates = buildDstStatUpdates({ teamRows, scoresByGameId });
  const lar = updates.find((u) => u.teamAbbr === 'LAR');
  const sf = updates.find((u) => u.teamAbbr === 'SF');
  assert.deepEqual(
    { team: lar.stats.gameTeam, opponent: lar.stats.gameOpponent },
    { team: 'LAR', opponent: 'SF' }
  );
  assert.deepEqual(
    { team: sf.stats.gameTeam, opponent: sf.stats.gameOpponent },
    { team: 'SF', opponent: 'LAR' }
  );
});

test('optionalTeamAbbr is null-preserving where nflverseTeamToOurAbbr answers a blank', () => {
  assert.equal(nflverseTeamToOurAbbr(''), '', 'the raw mapper still answers a blank string');
  for (const value of [undefined, null, '', '  ', 'NA']) {
    assert.equal(optionalTeamAbbr(value), null, JSON.stringify(value));
  }
  assert.equal(optionalTeamAbbr(' la '), 'LAR');
  assert.equal(optionalTeamAbbr('kc'), 'KC');
});

// --- nflverse-only keys are the ones the Tank01 path carries forward ---------

test('every unscored key nflverse adds is on scoring.NFLVERSE_ONLY_STAT_KEYS', () => {
  // Without this, adding a key here and forgetting the carry list would let the
  // next Tank01 sync of an enriched week silently erase it.
  const stats = normalizeNflversePlayerStats({ team: 'KC', opponent_team: 'BUF' });
  for (const key of ['gameTeam', 'gameOpponent', 'usagePassAttempts', 'usageCompletions',
    'usageCarries', 'usageTargets', 'usageAirYards']) {
    assert.ok(key in stats);
    assert.ok(
      scoring.NFLVERSE_ONLY_STAT_KEYS.includes(key),
      `${key} is written by nflverse but not protected from the Tank01 upsert`
    );
  }
});

test('the IDP finalization patch keys are all protected from the Tank01 upsert', () => {
  const updates = buildStatUpdates({
    defRows: [{ player_id: '00-0039924', def_sack_yards: '11' }],
    crosswalk: new Map([['00-0039924', '4429795']]),
    knownPlayersByExternalId: new Map([['4429795', 42]]),
  });
  for (const key of Object.keys(updates[0].patch)) {
    assert.ok(
      scoring.NFLVERSE_ONLY_STAT_KEYS.includes(key),
      `${key} is patched by the finalization pass but not protected`
    );
  }
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
    gameTeam: 'BUF', gameOpponent: 'BAL',
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

// ---- free stat corrections (no Tank01 quota) --------------------------------
//
// The Tue/Wed correction pass used to re-run Tank01's syncWeekStats (~34 calls a
// week against a ~1,000/month plan). It now rebuilds the week wholesale from
// nflverse instead — but a wholesale rebuild must not destroy the one thing
// nflverse cannot supply: Tank01's play-by-play TD-length arrays, which price
// TD-length bonuses for leagues that opted into them.

const pool = require('../modules/pool');
const nflverseSync = require('../services/nflverseSync.service');

test('PBP_ONLY_STAT_KEYS covers the TD-length arrays and not FG distances', () => {
  assert.deepEqual(nflverseSync.PBP_ONLY_STAT_KEYS, [
    'passingTDLengths', 'rushingTDLengths', 'receivingTDLengths',
  ]);
  // nflverse DOES publish exact FG distances (fg_made_list), so that key is
  // rebuilt rather than preserved.
  assert.ok(!nflverseSync.PBP_ONLY_STAT_KEYS.includes('fieldGoalDistances'));
});

test('applyNflverseFullWeek carries forward preserved keys over the fresh stats', async (t) => {
  const upserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "players" WHERE "external_id"')) {
      return { rows: [{ id: 42, external_id: '4429795' }] };
    }
    if (text.includes(`"position" = 'DEF'`)) return { rows: [] };
    if (text.includes('FROM "player_stats"')) {
      // What Tank01 wrote live: pbp arrays plus a now-corrected yardage figure.
      return {
        rows: [
          {
            player_id: 42,
            stats: { passingYards: 288, passingTDLengths: [42, 7], receivingTDLengths: [] },
          },
        ],
      };
    }
    if (text.includes('INTO "player_stats"')) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  await nflverseSync.applyNflverseFullWeek({
    season: 2025,
    week: 3,
    playerRows: [{ season: '2025', week: '3', season_type: 'REG', player_id: '00-0039924', passing_yards: '300' }],
    teamRows: [],
    scoresByGameId: new Map(),
    crosswalk: new Map([['00-0039924', '4429795']]),
    preserveKeys: nflverseSync.PBP_ONLY_STAT_KEYS,
  });

  assert.equal(upserts.length, 1);
  const stats = JSON.parse(upserts[0][3]);
  assert.equal(stats.passingYards, 300, 'nflverse’s corrected number wins');
  assert.deepEqual(stats.passingTDLengths, [42, 7], 'the pbp-only array survived');
  assert.deepEqual(stats.receivingTDLengths, []);
});

test('applyNflverseFullWeek preserves nothing by default (backfill behavior)', async (t) => {
  const upserts = [];
  let readExisting = false;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "players" WHERE "external_id"')) {
      return { rows: [{ id: 42, external_id: '4429795' }] };
    }
    if (text.includes(`"position" = 'DEF'`)) return { rows: [] };
    if (text.includes('FROM "player_stats"')) {
      readExisting = true;
      return { rows: [] };
    }
    if (text.includes('INTO "player_stats"')) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  await nflverseSync.applyNflverseFullWeek({
    season: 2025,
    week: 3,
    playerRows: [{ season: '2025', week: '3', season_type: 'REG', player_id: '00-0039924', passing_yards: '300' }],
    teamRows: [],
    scoresByGameId: new Map(),
    crosswalk: new Map([['00-0039924', '4429795']]),
  });

  assert.equal(readExisting, false, 'no extra read when nothing needs preserving');
  assert.equal(JSON.parse(upserts[0][3]).passingTDLengths, undefined);
});

/** Stubs the four CSV fetches + every query the correction path makes. */
function stubCorrectionWorld(t) {
  const upserts = [];
  t.mock.method(axios, 'get', async (url) => {
    if (url.includes('stats_player_week')) {
      return {
        data: [
          'season,week,season_type,player_id,passing_yards,team,opponent_team',
          '2025,3,REG,00-0039924,300,KC,BUF',
        ].join('\n'),
      };
    }
    if (url.includes('players.csv')) return { data: 'gsis_id,espn_id\n00-0039924,4429795\n' };
    if (url.includes('stats_team_week')) return { data: 'season,week,season_type,team\n' };
    return { data: 'game_id,season,game_type,week\n' }; // games.csv
  });
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "players" WHERE "external_id"')) {
      return { rows: [{ id: 42, external_id: '4429795' }] };
    }
    if (text.includes(`"position" = 'DEF'`)) return { rows: [] };
    if (text.includes('FROM "player_stats"')) {
      return { rows: [{ player_id: 42, stats: { passingYards: 288, passingTDLengths: [42, 7] } }] };
    }
    if (text.includes('INTO "player_stats"')) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  return upserts;
}

test('correctWeekFromNflverse preserves the pbp-only keys without the caller asking', async (t) => {
  // This path always runs over weeks Tank01 already filled, so the default has
  // to live in the function rather than in each caller (correction.service
  // passes only season/week/rescoreLeagues).
  const upserts = stubCorrectionWorld(t);
  await nflverseSync.correctWeekFromNflverse({ season: 2025, week: 3, rescoreLeagues: false });

  const stats = JSON.parse(upserts[0][3]);
  assert.equal(stats.passingYards, 300, 'the corrected nflverse number still wins');
  assert.deepEqual(
    stats.passingTDLengths,
    [42, 7],
    'kills the "caller must remember preserveKeys" mutant: TD-length bonuses would zero out'
  );
});

test('correctWeekFromNflverse still honors an explicit preserveKeys', async (t) => {
  const upserts = stubCorrectionWorld(t);
  await nflverseSync.correctWeekFromNflverse({
    season: 2025, week: 3, rescoreLeagues: false, preserveKeys: [],
  });
  assert.equal(JSON.parse(upserts[0][3]).passingTDLengths, undefined);
});

// --- nflverse schedule backfill ----------------------------------------------

test('nflverseTeamToScheduleAbbr writes Tank01 schedule vocabulary: WAS -> WSH, LA -> LAR', () => {
  assert.equal(nflverseTeamToScheduleAbbr('WAS'), 'WSH');
  assert.equal(nflverseTeamToScheduleAbbr('LA'), 'LAR');
  assert.equal(nflverseTeamToScheduleAbbr('KC'), 'KC');
  assert.equal(nflverseTeamToScheduleAbbr(''), null);
});

test('etKickoffToUtc resolves EST vs EDT from the date', () => {
  // January (EST, UTC-5) and September (EDT, UTC-4)
  assert.equal(etKickoffToUtc('2027-01-10', '13:00').toISOString(), '2027-01-10T18:00:00.000Z');
  assert.equal(etKickoffToUtc('2026-09-13', '13:00').toISOString(), '2026-09-13T17:00:00.000Z');
});

test('etKickoffToUtc rejects malformed inputs', () => {
  assert.equal(etKickoffToUtc('', '13:00'), null);
  assert.equal(etKickoffToUtc('2026-09-13', ''), null);
  assert.equal(etKickoffToUtc('9/13/2026', '13:00'), null);
  assert.equal(etKickoffToUtc('2026-09-13', 'TBD'), null);
});

test('buildScheduleRows emits both team perspectives in Tank01 codes for the target REG season only', () => {
  const rows = [
    { season: '2026', game_type: 'REG', week: '18', gameday: '2027-01-10', gametime: '13:00', home_team: 'WAS', away_team: 'LA' },
    { season: '2026', game_type: 'POST', week: '1', gameday: '2027-01-16', gametime: '16:30', home_team: 'KC', away_team: 'BUF' },
    { season: '2025', game_type: 'REG', week: '1', gameday: '2025-09-07', gametime: '13:00', home_team: 'KC', away_team: 'BUF' },
  ];
  const out = buildScheduleRows(rows, { season: 2026 });
  assert.deepEqual(out.map((g) => [g.week, g.nflTeam, g.opponent]), [
    [18, 'WSH', 'LAR'],
    [18, 'LAR', 'WSH'],
  ]);
  assert.equal(out[0].kickoffAt.toISOString(), '2027-01-10T18:00:00.000Z');
});

test('buildScheduleRows carries game context, and leaves absent columns null', () => {
  const rows = [{
    season: '2026', game_type: 'REG', week: '3', gameday: '2026-09-20', gametime: '13:00',
    home_team: 'MIN', away_team: 'GB', location: 'Home', stadium: 'U.S. Bank Stadium',
    roof: 'dome', surface: 'a_turf', home_rest: '7', away_rest: '10',
  }];
  const [home, away] = buildScheduleRows(rows, { season: 2026 });
  // Both perspectives share one game key, spelled the way nflverse spells its
  // own game_id, so a weather lookup happens once per GAME.
  assert.equal(home.gameKey, '2026_03_GB_MIN');
  assert.equal(away.gameKey, '2026_03_GB_MIN');
  assert.equal(home.homeAway, 'home');
  assert.equal(away.homeAway, 'away');
  assert.equal(home.restDays, 7);
  assert.equal(away.restDays, 10);
  assert.equal(home.roof, 'dome');
  assert.equal(home.surface, 'a_turf');
  assert.equal(home.venue, 'U.S. Bank Stadium');
  assert.equal(home.neutralSite, false);

  // A file generation without the context columns must yield nulls, not zeros
  // or fabricated defaults.
  const [bare] = buildScheduleRows(
    [{ season: '2026', game_type: 'REG', week: '3', gameday: '2026-09-20', gametime: '13:00', home_team: 'MIN', away_team: 'GB' }],
    { season: 2026 }
  );
  assert.equal(bare.roof, null);
  assert.equal(bare.surface, null);
  assert.equal(bare.venue, null);
  assert.equal(bare.restDays, null);
  assert.equal(bare.neutralSite, null, 'unknown is not "not neutral"');
});

test('buildScheduleRows flags a neutral-site game', () => {
  const [home] = buildScheduleRows(
    [{ season: '2026', game_type: 'REG', week: '5', gameday: '2026-10-04', gametime: '09:30', home_team: 'JAX', away_team: 'NE', location: 'Neutral' }],
    { season: 2026 }
  );
  assert.equal(home.neutralSite, true);
});

test('syncScheduleFromNflverse never overwrites a Tank01 kickoff, but does fill in game context', async (t) => {
  const csv = [
    'game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,roof,surface,stadium',
    '2026_18_SF_ARI,2026,REG,18,2027-01-10,Sunday,13:00,SF,,ARI,,closed,grass,State Farm Stadium',
  ].join('\n');
  t.mock.method(axios, 'get', async () => ({ data: csv }));
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql: String(sql), params });
    // Simulate the ARI perspective already existing from a Tank01 sync.
    const inserted = params[2] !== 'ARI';
    return { rowCount: 1, rows: [{ inserted }] };
  });

  const out = await syncScheduleFromNflverse({ season: 2026 });

  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO "nfl_games"/);
  // The conflict branch touches ONLY the additive context columns.
  assert.match(calls[0].sql, /ON CONFLICT \("season", "week", "nfl_team"\)\s*\n?\s*DO UPDATE SET/);
  assert.equal(/DO UPDATE SET[\s\S]*"kickoff_at"/.test(calls[0].sql), false);
  assert.equal(/DO UPDATE SET[\s\S]*"opponent" =/.test(calls[0].sql), false);
  assert.deepEqual(calls[0].params.slice(0, 4), [2026, 18, 'ARI', 'SF']);
  assert.equal(calls[0].params[5], '2026_18_SF_ARI');
  assert.equal(calls[0].params[9], 'closed');
  assert.deepEqual(calls[1].params.slice(0, 4), [2026, 18, 'SF', 'ARI']);
  assert.deepEqual(out, { season: 2026, gamesInFile: 1, rowsInserted: 1, contextUpdated: 1 });
});
