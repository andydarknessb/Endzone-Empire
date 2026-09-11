const test = require('node:test');
const assert = require('node:assert/strict');
const finalBox = require('../modules/finalBox');
const liveBox = require('../modules/liveBox');
const pool = require('../modules/pool');
const scoring = require('../services/scoring.service');
const { priorityAllowed } = require('../modules/tank01Client');
const { createFakePool, insert, update } = require('./helpers/fakePool');

/**
 * The Final box handoff (#1186, ADR 0035): when ESPN reports a game final the
 * Final box is scheduled fifteen minutes later, read once from Tank01 at
 * essential priority, applied with no Scoring plays, stamped, and from then on
 * no Live box write is accepted for that game.
 */

test('grace: a game marked final at T schedules the Final box at T+15 min, not before', () => {
  finalBox.__resetFinalBoxState();
  const timers = [];
  const due = [];
  const T = 1_000_000;
  const ok = finalBox.scheduleFinalBox('g1', {
    now: T,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; },
    onDue: (gameId) => due.push(gameId),
  });
  assert.equal(ok, true);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 15 * 60 * 1000, 'FINAL_BOX_GRACE_MS default');
  assert.equal(finalBox.finalBoxDueAt('g1'), T + 15 * 60 * 1000);
  assert.equal(finalBox.isWithinGrace('g1', T + 14 * 60 * 1000), true);
  assert.equal(finalBox.isWithinGrace('g1', T + 15 * 60 * 1000), false);
  assert.deepEqual(due, [], 'nothing runs before the timer fires');
  timers[0].fn();
  assert.deepEqual(due, ['g1']);
  assert.equal(finalBox.isWithinGrace('g1', T + 1), false, 'once due, the grace is over');
  finalBox.__resetFinalBoxState();
});

test('grace: scheduling the same game twice arms one timer', () => {
  finalBox.__resetFinalBoxState();
  let armed = 0;
  const setTimer = () => { armed += 1; return { unref() {} }; };
  assert.equal(finalBox.scheduleFinalBox('g2', { now: 0, setTimer, onDue: () => {} }), true);
  assert.equal(finalBox.scheduleFinalBox('g2', { now: 0, setTimer, onDue: () => {} }), false);
  assert.equal(armed, 1);
  finalBox.__resetFinalBoxState();
});

test('FINAL_BOX_GRACE_MS is env-tunable', () => {
  const prev = process.env.FINAL_BOX_GRACE_MS;
  process.env.FINAL_BOX_GRACE_MS = '1000';
  try {
    assert.equal(finalBox.graceMs(), 1000);
  } finally {
    if (prev === undefined) delete process.env.FINAL_BOX_GRACE_MS; else process.env.FINAL_BOX_GRACE_MS = prev;
  }
});

test('the Final box call passes essential priority: essential-only allows it, blocked refuses it', async (t) => {
  liveBox.__resetLiveBoxState();
  const calls = [];
  // syncWeekStats is now a Sync run (#1202, ADR 0036): its per-game write goes
  // through the unit's own transaction client, not the ambient pool, so this
  // needs the fakePool helper (which patches pool.connect() too) rather than a
  // hand-rolled pool.query stub.
  createFakePool([
    [/FROM "live_game_states"/, () => ({ rows: [{ tank01_game_id: 'g-final', game_status: 'final', final_stats_synced_at: null }] })],
    [update('live_game_states'), () => ({ rows: [] }), 'client'],
    [/FROM "players" WHERE "external_id"/, () => ({ rows: [{ id: 7, external_id: '4433971', name: 'Star Back', position: 'RB', nfl_team: 'KC' }] })],
    [/"position" = 'DEF'/, () => ({ rows: [] })],
    [/FROM "player_stats"/, () => ({ rows: [{ player_id: 7, stats: { rushingYards: 50, rushingTDs: 0 } }] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [insert('player_stats'), (text, params) => { calls.push({ upsert: params }); return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }], rowCount: 1 })],
  ]).install(t);
  const api = { get: async (path, opts) => { calls.push({ path, opts }); return { data: { body: { gameID: 'g-final', playerStats: { 4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '2' } } } } } }; } };
  const result = await scoring.syncWeekStats({ season: 2026, week: 2, api });
  const fetch = calls.find((c) => c.path === '/getNFLBoxScore');
  assert.ok(fetch, 'the Final box was fetched');
  assert.equal(fetch.opts.priority, 'essential', 'the call is made at essential priority');
  assert.equal(priorityAllowed('essential', 'essential-only'), true);
  assert.equal(priorityAllowed('essential', 'blocked'), false);
  assert.equal(priorityAllowed('standard', 'essential-only'), false, 'a standard call would have been shed here');
  // The Final box apply emits no Scoring plays even though the TD count rose.
  assert.deepEqual(result.plays, [], 'switch-pass rule on the Final box landing');
  const upsert = calls.find((c) => c.upsert);
  assert.equal(JSON.parse(upsert.upsert[3]).rushingTDs, 2, 'the stats were written');
  liveBox.__resetLiveBoxState();
});

test('an ESPN Live box applied after final_stats_synced_at is set writes nothing and changes no fantasy_points', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not write'); });
  const maps = {
    idByExternal: new Map([['4430878', 12]]),
    metaById: new Map([[12, { name: 'JSN', position: 'WR', nfl_team: 'SEA' }]]),
    defByTeamCode: new Map(),
    prevById: new Map([[12, { receptions: 8, receivingTDs: 1 }]]),
    opponentByTeam: new Map(),
    finalSyncedGameIds: new Set(['g-done']),
  };
  const box = { gameId: 'g-done', source: 'espn', isFinal: true, players: [{ externalId: '4430878', stats: { receptions: 9, receivingTDs: 2 } }], teamDefense: {}, scoreSummaryLines: [] };
  const out = await liveBox.applyLiveBox({ liveBox: box, season: 2026, week: 1, maps });
  assert.equal(out.updated, 0);
  assert.deepEqual(out.plays, []);
  assert.equal(out.skipped, 'final-box-landed');
});
