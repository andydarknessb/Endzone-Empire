/**
 * Cross-check of the ownership table against the builders (#1760, spec #1758).
 *
 * The write module keeps its key lists by hand so it stays a leaf. That is only
 * safe while every builder emits keys its source owns, so these tests read the
 * builders' real output and fail when one emits a key the table does not give
 * that source: a new key has to be added to the table on purpose, or the write
 * would silently drop it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { STAT_KEY_OWNERSHIP } = require('../services/playerStatsWrite.service');
const tank01BoxSource = require('../services/tank01BoxSource');
const espnBoxSource = require('../services/espnBoxSource');
const tank01Normalizers = require('../services/tank01Normalizers');
const nflverseSync = require('../services/nflverseSync.service');
const tank01Golden = require('./fixtures/tank01-box-golden.json');
const espnSummary = require('./fixtures/espn-summary-2026-w1-ne-sea-final.json');

const owned = (source) => new Set(STAT_KEY_OWNERSHIP[source].keys);

/** Every key in `keys` must be owned by `source`. */
function assertOwned(source, keys, what) {
  const table = owned(source);
  const stray = [...new Set(keys)].filter((key) => !table.has(key));
  assert.deepEqual(stray, [], `${what} emits key(s) the '${source}' source does not own: ${stray.join(', ')}`);
}

// --- box: tank01 and espn ----------------------------------------------------

// A maximal Tank01 entry, so a key that only appears for some players is seen.
const TANK01_ENTRY = {
  playerID: '1',
  Passing: { passYds: '300', passTD: '2', int: '1' },
  Rushing: { rushYds: '50', rushTD: '1' },
  Receiving: { recYds: '80', recTD: '1', receptions: '6' },
  Kicking: { fgMade: '2', fgAttempts: '3', xpMade: '3', xpAttempts: '3' },
  Punting: { puntReturns: '2', puntReturnYds: '20', puntReturnTD: '1' },
  Defense: {
    totalTackles: '9', soloTackles: '6', sacks: '1', defensiveInterceptions: '1', forcedFumbles: '1',
    fumblesRecovered: '1', passDeflections: '2', qbHits: '3', tfl: '2', defTD: '1', fumblesLost: '1',
    twoPointConversionReturn: '1',
  },
};
const TANK01_PLAYS = [{
  playerStats: {
    1: {
      Kicking: { fgMade: '1', fgYds: '44' },
      Passing: { passTD: '1', passYds: '30' },
      Rushing: { rushTD: '1', rushYds: '3' },
      Receiving: { recTD: '1', recYds: '22' },
    },
  },
}];

test('box owns every key the Tank01 normalizers emit', () => {
  assertOwned('box', Object.keys(tank01Normalizers.normalizeTank01Stats(TANK01_ENTRY)), 'normalizeTank01Stats');
  assertOwned('box', Object.keys(tank01Normalizers.normalizeTank01IdpStats(TANK01_ENTRY)), 'normalizeTank01IdpStats');
  const bonus = [...tank01Normalizers.extractPlayByPlayBonusStats(TANK01_PLAYS).values()].flatMap(Object.keys);
  assert.ok(bonus.length > 0);
  assertOwned('box', bonus, 'extractPlayByPlayBonusStats');
  const dst = tank01Normalizers.normalizeTank01DstStats(
    { sacks: '1', defensiveInterceptions: '1', fumblesRecovered: '1', defTD: '1', safeties: '1', ydsAllowed: '300', ptsAllowed: '10' },
    { blockedFG: '1' },
    17
  );
  assertOwned('box', Object.keys(dst), 'normalizeTank01DstStats');
});

test('box owns every key the Tank01 box adapter and the ESPN box adapter emit on real boxes', () => {
  for (const [name, liveBox] of [
    ['tank01BoxSource.fromBox (golden fixture)', tank01BoxSource.fromBox(tank01Golden.box)],
    ['espnBoxSource.fromSummary (NE at SEA fixture)', espnBoxSource.fromSummary(espnSummary, { gameId: '20260909_NE@SEA' })],
  ]) {
    assert.ok(liveBox.players.length > 0, `${name} has players`);
    assertOwned('box', liveBox.players.flatMap((p) => Object.keys(p.stats)), `${name} players`);
    assertOwned('box', Object.values(liveBox.teamDefense).flatMap(Object.keys), `${name} teamDefense`);
  }
});

test('box owns no key only an nflverse feed writes (a box replace must never delete one)', () => {
  const nflverseOnly = [
    ...STAT_KEY_OWNERSHIP['nflverse-snaps'].keys,
    'idpSackYards', 'idpTacklesForLossYards', 'idpFumbleReturnYards', 'idpSafety',
    'usageTargetShare', 'usageAirYardsShare', 'usageWopr', 'epaPassing', 'epaRushing', 'epaReceiving',
    'gameTeam', 'gameOpponent', 'usagePassAttempts', 'usageCompletions', 'usageCarries', 'usageTargets', 'usageAirYards',
    'passingTwoPt', 'rushingTwoPt', 'receivingTwoPt', 'kickReturns',
  ];
  const stray = nflverseOnly.filter((key) => owned('box').has(key));
  assert.deepEqual(stray, []);
});

// --- nflverse-correction -----------------------------------------------------

test('nflverse-correction owns every key the full-week builders emit', () => {
  // Every column the normalizer reads, so no key hides behind a blank field.
  const row = {
    team: 'KC', opponent_team: 'BUF', attempts: '1', completions: '1', carries: '1', targets: '1',
    receiving_air_yards: '1', passing_yards: '1', passing_tds: '1', passing_interceptions: '1',
    passing_2pt_conversions: '1', rushing_yards: '1', rushing_tds: '1', rushing_2pt_conversions: '1',
    receiving_yards: '1', receiving_tds: '1', receptions: '1', receiving_2pt_conversions: '1',
    fumbles_lost_total: '1', fg_made: '1', fg_missed: '1', fg_made_list: '30;40', pat_made: '1', pat_missed: '1',
    special_teams_tds: '1', punt_returns: '1', punt_return_yards: '1', kickoff_returns: '1',
    kickoff_return_yards: '1', def_tackles_solo: '1', def_tackle_assists: '1', def_sacks: '1',
    def_interceptions: '1', def_fumbles_forced: '1', fumble_recovery_opp: '1', def_pass_defended: '1',
    def_qb_hits: '1', def_tackles_for_loss: '1', def_tds: '1', fumble_recovery_tds: '1',
    def_sack_yards: '1', def_tackles_for_loss_yards: '1', fumble_recovery_yards_opp: '1',
    def_interception_yards: '1', def_safeties: '1', target_share: '0.1', air_yards_share: '0.1',
    wopr: '0.1', passing_epa: '1', rushing_epa: '1', receiving_epa: '1',
  };
  assertOwned('nflverse-correction', Object.keys(nflverseSync.normalizeNflversePlayerStats(row)), 'normalizeNflversePlayerStats');
  assertOwned('nflverse-correction', Object.keys(nflverseSync.normalizeNflversePlayerStats({})), 'normalizeNflversePlayerStats on an empty row');

  const teamRows = [
    { game_id: 'g', team: 'KC', opponent_team: 'BUF', def_sacks: '1', def_interceptions: '1', fumble_recovery_opp: '1', def_tds: '1', def_safeties: '1', fg_blocked: '1', pat_blocked: '1', pt_blocked: '1', passing_yards: '1', sack_yards_lost: '-1', rushing_yards: '1' },
    { game_id: 'g', team: 'BUF', opponent_team: 'KC', passing_yards: '1', sack_yards_lost: '-1', rushing_yards: '1' },
  ];
  const dst = nflverseSync.buildDstStatUpdates({
    teamRows,
    scoresByGameId: new Map([['g', { homeTeam: 'KC', awayTeam: 'BUF', homeScore: 20, awayScore: 10 }]]),
  });
  assert.ok(dst.length > 0);
  assertOwned('nflverse-correction', dst.flatMap((u) => Object.keys(u.stats)), 'buildDstStatUpdates');

  const full = nflverseSync.buildFullStatUpdates({
    rows: [{ ...row, player_id: '00-1' }],
    crosswalk: new Map([['00-1', '9']]),
    knownPlayersByExternalId: new Map([['9', 1]]),
  });
  assert.equal(full.length, 1);
  assertOwned('nflverse-correction', Object.keys(full[0].stats), 'buildFullStatUpdates');
});

test('nflverse-correction does not own the keys it must carry: TD-length lists and snap keys', () => {
  for (const key of ['passingTDLengths', 'rushingTDLengths', 'receivingTDLengths', ...STAT_KEY_OWNERSHIP['nflverse-snaps'].keys]) {
    assert.equal(owned('nflverse-correction').has(key), false, `${key} must be carried by a correction, not owned`);
  }
});

// --- nflverse-week and nflverse-snaps ----------------------------------------

test('nflverse-week owns every key the finalization patch emits', () => {
  const updates = nflverseSync.buildStatUpdates({
    defRows: [{
      player_id: '00-1', def_sack_yards: '1', def_tackles_for_loss_yards: '1', fumble_recovery_yards_opp: '1',
      def_interception_yards: '1', def_safeties: '1', target_share: '0.1', air_yards_share: '0.1', wopr: '0.1',
      passing_epa: '1', rushing_epa: '1', receiving_epa: '1',
    }],
    crosswalk: new Map([['00-1', '9']]),
    knownPlayersByExternalId: new Map([['9', 1]]),
  });
  assert.equal(updates.length, 1);
  assertOwned('nflverse-week', Object.keys(updates[0].patch), 'buildStatUpdates');
  assert.deepEqual(Object.keys(updates[0].patch).sort(), [...owned('nflverse-week')].sort(), 'the table owns nothing the patch never writes');
});

test('nflverse-snaps owns every key the snap patch emits', () => {
  const { updates } = nflverseSync.buildSnapUpdates({
    snapRows: [{
      season: '2025', week: '3', game_type: 'REG', pfr_player_id: 'P1', team: 'KC',
      offense_snaps: '50', offense_pct: '0.8', defense_snaps: '2', defense_pct: '0.03',
    }],
    pfrCrosswalk: new Map([['P1', '9']]),
    knownPlayersByExternalId: new Map([['9', 1]]),
    season: 2025,
    week: 3,
  });
  assert.equal(updates.length, 1);
  assertOwned('nflverse-snaps', Object.keys(updates[0].patch), 'buildSnapUpdates');
  assert.deepEqual(Object.keys(updates[0].patch).sort(), [...owned('nflverse-snaps')].sort());
});
