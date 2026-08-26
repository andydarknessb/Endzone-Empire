const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const scoring = require('../services/scoring.service');

// The Tank01 plan allows ~1,000 calls a MONTH. The old syncWeekStats box-scored
// every game in the week on every ~30-minute pass, so a game that finished at
// 4pm was re-fetched all evening (~350 calls on a single Sunday). These tests
// pin the new behavior: the week's game list comes from live_game_states, and a
// box score is fetched at most once per finalized game.

// --- gamesNeedingBoxScore (pure) --------------------------------------------

test('gamesNeedingBoxScore: only in-progress games and un-ingested finals', () => {
  const rows = [
    { tank01_game_id: 'g-live', game_status: 'in_progress', final_stats_synced_at: null },
    { tank01_game_id: 'g-final-new', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g-final-done', game_status: 'final', final_stats_synced_at: new Date() },
    { tank01_game_id: 'g-later', game_status: 'scheduled', final_stats_synced_at: null },
  ];
  assert.deepEqual(scoring.gamesNeedingBoxScore(rows), [
    { gameId: 'g-live', status: 'in_progress', isFinal: false },
    { gameId: 'g-final-new', status: 'final', isFinal: true },
  ]);
});

test('gamesNeedingBoxScore: a full slate of ingested finals needs nothing', () => {
  const rows = ['a', 'b', 'c'].map((id) => ({
    tank01_game_id: id,
    game_status: 'final',
    final_stats_synced_at: new Date(),
  }));
  assert.deepEqual(scoring.gamesNeedingBoxScore(rows), []);
});

test('gamesNeedingBoxScore: rows without an id are ignored', () => {
  assert.deepEqual(scoring.gamesNeedingBoxScore([{ game_status: 'final' }]), []);
  assert.deepEqual(scoring.gamesNeedingBoxScore(null), []);
});

// --- syncWeekStats -----------------------------------------------------------

const LIVE_ROWS = [
  { tank01_game_id: '20260913_KC@BUF', game_status: 'in_progress', final_stats_synced_at: null },
  { tank01_game_id: '20260913_DAL@PHI', game_status: 'final', final_stats_synced_at: null },
  { tank01_game_id: '20260913_NYG@WSH', game_status: 'final', final_stats_synced_at: new Date('2026-09-13T20:00:00Z') },
  { tank01_game_id: '20260914_MIN@CHI', game_status: 'scheduled', final_stats_synced_at: null },
];

/**
 * Stubs every query syncWeekStats/loadWeekMaps/applyGameBoxScore makes, and
 * records the box-score calls plus any final_stats_synced_at stamps.
 */
function stubWorld(t, { liveRows = LIVE_ROWS } = {}) {
  const fetched = [];
  const stamped = [];
  const upserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "live_game_states"')) return { rows: liveRows };
    if (text.includes('SET "final_stats_synced_at"')) {
      stamped.push(params[0]);
      return { rows: [] };
    }
    if (text.includes('FROM "players" WHERE "external_id"')) {
      return { rows: [{ id: 7, external_id: '4433971', name: 'Star Back', position: 'RB', nfl_team: 'KC' }] };
    }
    if (text.includes(`"position" = 'DEF'`)) return { rows: [] };
    if (text.includes('FROM "player_stats"')) return { rows: [] };
    if (text.includes('FROM "nfl_games"')) return { rows: [{ nfl_team: 'KC', opponent: 'BUF' }] };
    if (text.includes('INTO "player_stats"')) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const api = {
    async get(path, opts) {
      fetched.push({ path, gameId: opts && opts.params && opts.params.gameID });
      return {
        data: {
          body: {
            playerStats: {
              4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '1', carries: '18' } },
            },
          },
        },
      };
    },
  };
  return { fetched, stamped, upserts, api };
}

test('syncWeekStats: skips scheduled games and finals already ingested', async (t) => {
  const { fetched, api } = stubWorld(t);
  const result = await scoring.syncWeekStats({ season: 2026, week: 2, api });

  assert.deepEqual(
    fetched.map((f) => f.gameId),
    ['20260913_KC@BUF', '20260913_DAL@PHI'],
    'only the live game and the un-ingested final cost a call'
  );
  assert.equal(result.gamesProcessed, 2);
  assert.equal(result.gamesSkipped, 2);
});

test('syncWeekStats: the game list comes from live_game_states, not a schedule call', async (t) => {
  const { fetched, api } = stubWorld(t);
  await scoring.syncWeekStats({ season: 2026, week: 2, api });
  assert.equal(
    fetched.filter((f) => f.path === '/getNFLGamesForWeek').length,
    0,
    'no schedule call when we already know the week'
  );
});

test('syncWeekStats: ingesting a final stamps it so it is never fetched again', async (t) => {
  const { stamped, api } = stubWorld(t);
  await scoring.syncWeekStats({ season: 2026, week: 2, api });
  assert.deepEqual(stamped, ['20260913_DAL@PHI'], 'the live game is not stamped, the final is');
});

test('syncWeekStats: a week of finished, ingested games costs zero calls', async (t) => {
  const liveRows = LIVE_ROWS.map((r) => ({
    ...r,
    game_status: 'final',
    final_stats_synced_at: new Date(),
  }));
  const { fetched, api } = stubWorld(t, { liveRows });
  const result = await scoring.syncWeekStats({ season: 2026, week: 2, api });
  assert.deepEqual(fetched, []);
  assert.deepEqual(result, {
    season: 2026,
    week: 2,
    playersUpdated: 0,
    gamesProcessed: 0,
    gamesSkipped: 4,
    plays: [],
  });
});

test('syncWeekStats: with no live rows it falls back to one schedule call', async (t) => {
  const { fetched, api } = stubWorld(t, { liveRows: [] });
  await scoring.syncWeekStats({ season: 2024, week: 7, api });
  assert.equal(fetched[0].path, '/getNFLGamesForWeek');
});

// --- applyGameBoxScore (the extracted loop body) ------------------------------

test('applyGameBoxScore: upserts stats and reports the touchdown as a play', async (t) => {
  const upserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (String(sql).includes('INTO "player_stats"')) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const maps = {
    idByExternal: new Map([['4433971', 7]]),
    metaById: new Map([[7, { name: 'Star Back', position: 'RB', nfl_team: 'KC' }]]),
    defByTeamCode: new Map(),
    prevById: new Map(),
    opponentByTeam: new Map([['KC', 'BUF']]),
  };
  const box = {
    playerStats: {
      4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '1', carries: '18' } },
    },
  };
  const { updated, plays } = await scoring.applyGameBoxScore({ box, season: 2026, week: 2, maps });

  assert.equal(updated, 1);
  assert.equal(upserts.length, 1);
  const stats = JSON.parse(upserts[0][3]);
  assert.equal(stats.rushingYards, 104);
  assert.equal(stats.rushingTDs, 1);
  assert.equal(Number(upserts[0][4]), 16.4); // 104 * 0.1 + 6
  assert.equal(plays.length, 1);
  assert.deepEqual(
    { name: plays[0].name, type: plays[0].type, tdDelta: plays[0].tdDelta, opponent: plays[0].opponent },
    { name: 'Star Back', type: 'rushing', tdDelta: 1, opponent: 'BUF' }
  );
});

test('applyGameBoxScore: re-applying the SAME box score does not re-fire the play', async (t) => {
  // This is what makes it safe for the recap path to apply a box score that the
  // live sync may already have applied.
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  const maps = {
    idByExternal: new Map([['4433971', 7]]),
    metaById: new Map([[7, { name: 'Star Back', position: 'RB', nfl_team: 'KC' }]]),
    defByTeamCode: new Map(),
    prevById: new Map(),
    opponentByTeam: new Map(),
  };
  const box = {
    playerStats: { 4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '1' } } },
  };
  const first = await scoring.applyGameBoxScore({ box, season: 2026, week: 2, maps });
  const second = await scoring.applyGameBoxScore({ box, season: 2026, week: 2, maps });
  assert.equal(first.plays.length, 1);
  assert.equal(second.plays.length, 0);
});

test('applyGameBoxScore: players outside our pool are ignored', async (t) => {
  t.mock.method(pool, 'query', async () => {
    throw new Error('should not write anything');
  });
  const maps = {
    idByExternal: new Map(),
    metaById: new Map(),
    defByTeamCode: new Map(),
    prevById: new Map(),
    opponentByTeam: new Map(),
  };
  const out = await scoring.applyGameBoxScore({
    box: { playerStats: { 999: { playerID: '999', Rushing: { rushYds: '10' } } } },
    season: 2026,
    week: 2,
    maps,
  });
  assert.deepEqual(out, { updated: 0, plays: [] });
});
