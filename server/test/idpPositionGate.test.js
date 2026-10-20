const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { applyGameBoxScore } = require('../services/boxScoreApply.service');
const { applyNflverseFullWeek } = require('../services/nflverseSync.service');
const { IDP_POSITION_CODES } = require('../services/playerStatsWrite.service');
const { IDP_POSITIONS } = require('../services/feedSyncRuns.service');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../services/scoringRules');
const tank01BoxSource = require('../services/tank01BoxSource');
const espnBoxSource = require('../services/espnBoxSource');
const espnSummary = require('./fixtures/espn-summary-2026-w1-ne-sea-final.json');

/**
 * #2373: a non-defender's tackle (a special-teams stop, a tackle after a
 * turnover) shows up in the box's defensive figures, and the default IDP rates
 * are non-zero, so it used to score in every league. The one write funnel
 * (upsertPlayerStats) now drops non-zero IDP keys unless players.position is
 * DL/LB/DB. Each writer is driven through its own path with the same line, the
 * Nabers week 6 shape: 6 rec / 125 yds / 1 TD / 1 solo tackle. Priced under
 * PPR the offense is 6 + 12.5 + 6 = 24.5; a defender's tackle adds 1 (25.5).
 * The stored line is read back off the INSERT, then priced.
 */

const WR_PPR = 24.5;
const LB_PPR = 25.5;
const price = (stats) => calculateFantasyPoints(stats, SCORING_PRESETS.ppr);

function captureWrites(t, target) {
  const writes = [];
  const query = async (sql, params) => {
    if (String(sql).includes('INTO "player_stats"')) {
      writes.push(JSON.parse(params[3]));
      return { rows: [] };
    }
    return { rows: [] }; // the nflverse prior-line read: no stored row
  };
  if (target === pool) t.mock.method(pool, 'query', query);
  return { writes, db: { query } };
}

// --- Box: Tank01 Final box ---------------------------------------------------

const TANK01_BOX = {
  gameID: '20261011_NYG@PHI',
  playerStats: {
    1: {
      playerID: '9001',
      Receiving: { receptions: '6', recYds: '125', recTD: '1' },
      Defense: { soloTackles: '1', totalTackles: '1' },
    },
  },
};

async function tank01Line(t, position) {
  const { writes } = captureWrites(t, pool);
  const maps = {
    idByExternal: new Map([['9001', 11]]),
    metaById: new Map([[11, { name: 'Fixture Player', position, nfl_team: 'NYG' }]]),
    defByTeamCode: new Map(),
    prevById: new Map(),
    opponentByTeam: new Map(),
  };
  await applyGameBoxScore({ liveBox: tank01BoxSource.fromBox(TANK01_BOX), season: 2026, week: 6, maps, suppressPlays: true });
  assert.equal(writes.length, 1);
  return writes[0];
}

test('Tank01 Final box: a WR with a solo tackle prices as offense only', async (t) => {
  assert.equal(price(await tank01Line(t, 'WR')), WR_PPR);
});

test('Tank01 Final box: a LB with the same tackle still scores it', async (t) => {
  assert.equal(price(await tank01Line(t, 'LB')), LB_PPR);
});

// --- Box: ESPN Live box ------------------------------------------------------

// JSN's receiving row becomes 6 / 125 / 1 and he is added to SEA's defensive
// group with one solo tackle, so the ESPN reader itself emits the IDP key.
function espnBox() {
  const summary = structuredClone(espnSummary);
  const sea = summary.boxscore.players.find((side) => side.team.abbreviation === 'SEA');
  const group = (name) => sea.statistics.find((g) => g.name === name);
  const jsn = group('receiving').athletes.find((a) => a.athlete.id === '4430878');
  jsn.stats = ['6', '125', '20.8', '1', '45', '11'];
  group('defensive').athletes.push({ athlete: jsn.athlete, stats: ['1', '1', '0', '0', '0', '0', '0'] });
  return espnBoxSource.fromSummary(summary, { gameId: '20260909_NE@SEA' });
}

async function espnLine(t, position) {
  const { writes } = captureWrites(t, pool);
  const liveBox = espnBox();
  assert.equal(liveBox.players.find((p) => p.externalId === '4430878').stats.soloTackle, 1, 'the ESPN reader emits the tackle');
  const maps = {
    idByExternal: new Map([['4430878', 12]]),
    metaById: new Map([[12, { name: 'Fixture Player', position, nfl_team: 'SEA' }]]),
    defByTeamCode: new Map(),
    prevById: new Map(),
    opponentByTeam: new Map(),
  };
  await applyGameBoxScore({ liveBox, season: 2026, week: 1, maps, suppressPlays: true });
  assert.equal(writes.length, 1);
  return writes[0];
}

test('ESPN Live box: a WR with a solo tackle prices as offense only', async (t) => {
  assert.equal(price(await espnLine(t, 'WR')), WR_PPR);
});

test('ESPN Live box: a LB with the same tackle still scores it', async (t) => {
  assert.equal(price(await espnLine(t, 'LB')), LB_PPR);
});

// --- nflverse correction -----------------------------------------------------

const NFLVERSE_ROW = {
  player_id: '00-0039999', team: 'NYG', opponent_team: 'PHI',
  receptions: '6', receiving_yards: '125', receiving_tds: '1', def_tackles_solo: '1',
};

async function nflverseLine(position) {
  const writes = [];
  const db = {
    query: async (sql, params) => {
      if (String(sql).includes('INTO "player_stats"')) writes.push(JSON.parse(params[3]));
      return { rows: [] };
    },
  };
  await applyNflverseFullWeek(db, {
    season: 2026, week: 6, gameId: '2026_06_NYG_PHI',
    playerRows: [NFLVERSE_ROW], teamRows: [], scoresByGameId: new Map(),
    crosswalk: new Map([['00-0039999', '9001']]),
    idByExternal: new Map([['9001', 13]]),
    positionById: new Map([[13, position]]),
    defByTeamCode: new Map(),
  });
  assert.equal(writes.length, 1);
  return writes[0];
}

test('nflverse correction: a WR with a solo tackle prices as offense only', async () => {
  assert.equal(price(await nflverseLine('WR')), WR_PPR);
});

test('nflverse correction: a LB with the same tackle still scores it', async () => {
  assert.equal(price(await nflverseLine('LB')), LB_PPR);
});

// --- the position list -------------------------------------------------------

test('the funnel and feedSyncRuns agree on which positions are defenders', () => {
  assert.deepEqual([...IDP_POSITION_CODES].sort(), [...IDP_POSITIONS].sort());
});
