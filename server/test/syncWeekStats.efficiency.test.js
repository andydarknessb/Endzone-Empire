const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const scoring = require('../services/scoring.service');
const finalBox = require('../modules/finalBox');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

// The Tank01 plan allows ~1,000 calls a MONTH. The old syncWeekStats box-scored
// every game in the week on every ~30-minute pass, so a game that finished at
// 4pm was re-fetched all evening (~350 calls on a single Sunday). These tests
// pin the new behavior: the week's game list comes from live_game_states, and a
// box score is fetched at most once per finalized game.

// --- gamesNeedingBoxScore (pure) --------------------------------------------

test('gamesNeedingBoxScore: only un-ingested finals; in-progress games are the engine’s Live box (#1185)', () => {
  const rows = [
    { tank01_game_id: 'g-live', game_status: 'in_progress', final_stats_synced_at: null },
    { tank01_game_id: 'g-final-new', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g-final-done', game_status: 'final', final_stats_synced_at: new Date() },
    { tank01_game_id: 'g-later', game_status: 'scheduled', final_stats_synced_at: null },
  ];
  assert.deepEqual(scoring.gamesNeedingBoxScore(rows), [
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
//
// syncWeekStats is now a Sync run (#1202, ADR 0036): the box fetches run
// outside any transaction, and each game applies in its own transaction via
// runSyncJob. That means the pg pool's checked-out CLIENT does the per-game
// writes (the player_stats upsert, the final_stats_synced_at stamp), not the
// ambient pool - so these tests use the shared fakePool helper (the migration
// rule in test/helpers/fakePool.js) rather than a hand-rolled pool.query stub.

const LIVE_ROWS = [
  { tank01_game_id: '20260913_KC@BUF', game_status: 'in_progress', final_stats_synced_at: null },
  { tank01_game_id: '20260913_DAL@PHI', game_status: 'final', final_stats_synced_at: null },
  { tank01_game_id: '20260913_NYG@WSH', game_status: 'final', final_stats_synced_at: new Date('2026-09-13T20:00:00Z') },
  { tank01_game_id: '20260914_MIN@CHI', game_status: 'scheduled', final_stats_synced_at: null },
];

const DEFAULT_PLAYERS = [{ id: 7, external_id: '4433971', name: 'Star Back', position: 'RB', nfl_team: 'KC' }];

const DEFAULT_BOX = {
  playerStats: {
    4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '1', carries: '18' } },
  },
};

const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));
// The INSERT is ("job","started_at","ok","detail") with values ($1,$2,$3,$4::jsonb)
// - finished_at is left to the column DEFAULT - so ok is params[2] and the detail
// JSON is params[3].
const runOk = (call) => call.params[2];
const runDetail = (call) => JSON.parse(call.params[3]);

/**
 * Wires a fakePool for syncWeekStats: the target-list read and loadWeekMaps'
 * reads land on the pool (setup, before the Sync run's fetch); the per-game
 * writes (player_stats upsert, the final_stats_synced_at stamp) are pinned to
 * the `'client'` side, since applyWeekStatsUnit now threads its unit's
 * transaction client through applyGameBoxScore/markFinalStatsSynced (#1202) -
 * a regression back to the ambient pool would turn these tests red with
 * "unexpected query" rather than silently passing.
 *
 * `boxByGameId[gameId]` overrides the box body Tank01 answers with for that
 * game; the string `'reject'` makes that game's fetch throw instead.
 */
function stubWorld(t, { liveRows = LIVE_ROWS, players = DEFAULT_PLAYERS, boxByGameId = {}, onPlayerStatsInsert } = {}) {
  const stamped = [];
  const upserts = [];
  const fake = createFakePool([
    [/FROM "live_game_states"/, () => ({ rows: liveRows })],
    [/FROM "players" WHERE "external_id"/, () => ({ rows: players })],
    [/"position" = 'DEF'/, () => ({ rows: [] })],
    [select('player_stats'), () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: [{ nfl_team: 'KC', opponent: 'BUF' }] })],
    [update('live_game_states'), (text, params) => {
      stamped.push(params[0]);
      return { rows: [] };
    }, 'client'],
    [insert('player_stats'), (text, params) => {
      if (onPlayerStatsInsert) onPlayerStatsInsert(params);
      upserts.push(params);
      return { rows: [] };
    }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }], rowCount: 1 })],
  ]).install(t);

  const fetched = [];
  const api = {
    async get(path, opts) {
      const gameId = opts && opts.params && opts.params.gameID;
      fetched.push({ path, gameId, priority: opts && opts.priority });
      if (boxByGameId[gameId] === 'reject') {
        throw new Error(`Tank01 box fetch failed for ${gameId}`);
      }
      const body = boxByGameId[gameId] || DEFAULT_BOX;
      return { data: { body } };
    },
  };
  return { fake, fetched, stamped, upserts, api };
}

test('syncWeekStats: skips scheduled games and finals already ingested', async (t) => {
  const { fake, fetched, api } = stubWorld(t);
  const result = await scoring.syncWeekStats({ season: 2026, week: 2, api });

  assert.deepEqual(
    fetched.map((f) => f.gameId),
    ['20260913_DAL@PHI'],
    'only the un-ingested final costs a call: the in-progress game is the engine’s Live box (#1185)'
  );
  assert.equal(fetched[0].priority, 'essential', 'the Final box is the one call never shed (#1186)');
  assert.equal(result.gamesProcessed, 1);
  assert.equal(result.gamesSkipped, 3);
  fake.assertClean();
});

test('syncWeekStats: an in_progress game is no longer fetched here; a final without final_stats_synced_at still is (#1185)', async (t) => {
  const liveRows = [
    { tank01_game_id: 'g-live', game_status: 'in_progress', final_stats_synced_at: null },
    { tank01_game_id: 'g-final', game_status: 'final', final_stats_synced_at: null },
  ];
  const { fetched, api } = stubWorld(t, { liveRows });
  await scoring.syncWeekStats({ season: 2026, week: 2, api });
  assert.deepEqual(fetched.map((f) => f.gameId), ['g-final']);
});

/**
 * #1221: SF at LAR 2026-09-10 went final at 03:24:57Z; the six-tick sync landed
 * at 03:35:40Z, inside the 15-minute grace, fetched the Final box and stamped
 * the game, then the grace timer fired at 03:39:57Z and the recap fetched its
 * own box: two Tank01 calls where the design pays one. The sync must leave a
 * final alone while its grace is running; the timer's single fetch serves both
 * the stamp and the recap. Once the grace is over (or none is armed, a restart)
 * the sync is still the retry path for a Final box that failed.
 */
test('syncWeekStats: a final inside its Final box grace is not fetched; one past its grace is (#1221)', async (t) => {
  finalBox.__resetFinalBoxState();
  t.after(() => finalBox.__resetFinalBoxState());
  const liveRows = [
    { tank01_game_id: 'g-final-fresh', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g-final-old', game_status: 'final', final_stats_synced_at: null },
  ];
  // g-final-fresh went final a moment ago: its grace timer is armed and pending.
  finalBox.scheduleFinalBox('g-final-fresh', { now: Date.now(), setTimer: () => ({ unref() {} }), onDue: () => {} });
  const { fetched, stamped, api } = stubWorld(t, { liveRows });
  const result = await scoring.syncWeekStats({ season: 2026, week: 2, api });
  assert.deepEqual(fetched.map((f) => f.gameId), ['g-final-old'], 'the fresh final waits for its timer; the old one is the retry path');
  assert.deepEqual(stamped, ['g-final-old']);
  assert.equal(result.gamesProcessed, 1);
  assert.equal(result.gamesSkipped, 1, 'the deferred final counts as skipped this pass');
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
  const { fake, fetched, api } = stubWorld(t, { liveRows });
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
  assert.equal(dataSyncRuns(fake.calls).length, 0, 'no targets: no Sync run is even attempted');
});

test('syncWeekStats: with no live rows it falls back to one schedule call', async (t) => {
  const { fetched, api } = stubWorld(t, { liveRows: [] });
  await scoring.syncWeekStats({ season: 2024, week: 7, api });
  assert.equal(fetched[0].path, '/getNFLGamesForWeek');
});

// --- syncWeekStats as a Sync run (#1202, ADR 0036) ---------------------------

test('syncWeekStats: fetch-all costs the same Tank01 calls as before - every target is fetched regardless of another target’s outcome', async (t) => {
  const liveRows = [
    { tank01_game_id: 'g1', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g2', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g3', game_status: 'final', final_stats_synced_at: null },
  ];
  const { fetched, api } = stubWorld(t, { liveRows });
  await scoring.syncWeekStats({ season: 2026, week: 2, api });
  assert.deepEqual(fetched.map((f) => f.gameId), ['g1', 'g2', 'g3'], 'fetch-all never adds or skips a call');
});

test('syncWeekStats: game 2 of 3 fails to write; games 1 and 3 stay written and the run records write_failed naming game 2 (#1202)', async (t) => {
  const liveRows = [
    { tank01_game_id: 'g1', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g2', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g3', game_status: 'final', final_stats_synced_at: null },
  ];
  const players = [
    { id: 1, external_id: 'p1', name: 'Player One', position: 'RB', nfl_team: 'KC' },
    { id: 2, external_id: 'p2', name: 'Player Two', position: 'RB', nfl_team: 'KC' },
    { id: 3, external_id: 'p3', name: 'Player Three', position: 'RB', nfl_team: 'KC' },
  ];
  const boxByGameId = {
    g1: { playerStats: { p1: { playerID: 'p1', Rushing: { rushYds: '50', rushTD: '0', carries: '10' } } } },
    g2: { playerStats: { p2: { playerID: 'p2', Rushing: { rushYds: '60', rushTD: '0', carries: '11' } } } },
    g3: { playerStats: { p3: { playerID: 'p3', Rushing: { rushYds: '70', rushTD: '0', carries: '12' } } } },
  };
  const { fake, upserts, api } = stubWorld(t, {
    liveRows,
    players,
    boxByGameId,
    onPlayerStatsInsert: (params) => {
      if (params[0] === 2) throw new Error('player_stats write failed for game2');
    },
  });

  await assert.rejects(scoring.syncWeekStats({ season: 2026, week: 2, api }), /write failed for game2/);

  assert.deepEqual(
    upserts.map((p) => p[0]).sort(),
    [1, 3],
    'game 1 and game 3 rows are written; game 2 never lands'
  );
  assert.equal(fake.matching(/^COMMIT$/).length, 2, 'game 1 and game 3 each commit their own transaction');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'only game 2’s transaction rolls back');
  fake.assertClean();

  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1, 'exactly one run recorded for the whole slate');
  assert.equal(runOk(runs[0]), false);
  const detail = runDetail(runs[0]);
  assert.equal(detail.reason, 'write_failed');
  assert.equal(detail.failed.length, 1);
  assert.match(detail.failed[0].message, /game2/);
});

test('syncWeekStats: one box fetch rejects; the run still applies the rest and records ok with detail.skipped naming that game (#1202)', async (t) => {
  const liveRows = [
    { tank01_game_id: 'g1', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g2', game_status: 'final', final_stats_synced_at: null },
  ];
  const { fake, fetched, upserts, api } = stubWorld(t, {
    liveRows,
    boxByGameId: { g2: 'reject' },
  });

  const result = await scoring.syncWeekStats({ season: 2026, week: 2, api });

  assert.deepEqual(fetched.map((f) => f.gameId), ['g1', 'g2'], 'both targets are attempted - same quota cost as before');
  assert.equal(upserts.length, 1, 'g1 still writes');
  assert.equal(result.gamesProcessed, 1);
  assert.equal(result.gamesSkipped, 1, 'the failed fetch counts against this pass');
  fake.assertClean();

  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runOk(runs[0]), true, 'a partial fetch failure is still an ok run - only the fully-failed slate is not');
  assert.deepEqual(runDetail(runs[0]).skipped, ['g2']);
});

test('syncWeekStats: every box fetch on the slate fails; the run is fetch_failed and nothing is written (#1202)', async (t) => {
  const liveRows = [
    { tank01_game_id: 'g1', game_status: 'final', final_stats_synced_at: null },
    { tank01_game_id: 'g2', game_status: 'final', final_stats_synced_at: null },
  ];
  const { fake, upserts, api } = stubWorld(t, {
    liveRows,
    boxByGameId: { g1: 'reject', g2: 'reject' },
  });

  await assert.rejects(scoring.syncWeekStats({ season: 2026, week: 2, api }), /every box fetch failed/);

  assert.equal(upserts.length, 0, 'nothing was ever applied - fetch never produced a unit');
  assert.equal(fake.matching(/^BEGIN$/).length, 0, 'no transaction opens when fetch itself fails');
  fake.assertClean();

  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runOk(runs[0]), false);
  assert.equal(runDetail(runs[0]).reason, 'fetch_failed');
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
