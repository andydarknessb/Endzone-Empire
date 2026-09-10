const test = require('node:test');
const assert = require('node:assert/strict');
const liveBox = require('../modules/liveBox');
const sentryModule = require('../modules/sentry');
const scoring = require('../services/scoring.service');
const { createFakePool, insert } = require('./helpers/fakePool');
const summary = require('./fixtures/espn-summary-2026-w1-ne-sea-final.json');

/**
 * The Live box source switch (#1184, ADR 0035): ESPN by default, Tank01 after
 * three consecutive ESPN failures on a counter separate from the clock's,
 * retried every tick and taken back on the first success; every switch writes
 * a data_sync_runs row (job `live-box`) and a Sentry message; the first apply
 * after a switch writes stats but emits no Scoring plays.
 */

const GAME = { gameId: '20260909_NE@SEA', espnEventId: '401872656', inProgress: true };

const inProgressSummary = () => ({
  ...summary,
  header: {
    ...summary.header,
    competitions: [{ ...summary.header.competitions[0], status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS' } } }],
  },
});

function fakeSentry() {
  return {
    captured: [],
    messages: [],
    scope: { extras: {}, setExtra(k, v) { this.extras[k] = v; }, setFingerprint() {} },
    init() {},
    captureException(err) { this.captured.push(err); },
    captureMessage(msg) { this.messages.push(msg); },
    withScope(fn) { fn(this.scope); },
  };
}

function world(t, { espn, tank01 } = {}) {
  liveBox.__resetLiveBoxState();
  const runs = [];
  const fake = createFakePool([
    [insert('data_sync_runs'), (text, params) => {
      runs.push({ job: params[0], ok: params[2], detail: JSON.parse(params[3]) });
      return { rows: [{ id: runs.length }] };
    }],
  ]);
  fake.install(t);
  const prevDsn = process.env.SENTRY_DSN;
  process.env.SENTRY_DSN = 'https://public@example.test/1';
  const sentry = fakeSentry();
  sentryModule.initSentry(sentry);
  const prevSource = process.env.LIVE_BOX_SOURCE;
  delete process.env.LIVE_BOX_SOURCE;
  t.after(() => {
    if (prevDsn === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = prevDsn;
    if (prevSource === undefined) delete process.env.LIVE_BOX_SOURCE; else process.env.LIVE_BOX_SOURCE = prevSource;
    sentryModule.initSentry(null);
    liveBox.__resetLiveBoxState();
  });
  const espnCalls = [];
  const tank01Calls = [];
  const transport = {
    async get(url, opts) {
      espnCalls.push({ url, opts });
      return espn ? espn(espnCalls.length) : { data: inProgressSummary() };
    },
  };
  const tank01Transport = {
    async get(path, opts) {
      tank01Calls.push({ path, opts });
      return tank01
        ? tank01(tank01Calls.length)
        : { data: { body: { gameID: GAME.gameId, playerStats: { 4430878: { playerID: '4430878', Receiving: { receptions: '8', recYds: '122', recTD: '1' } } } } } };
    },
  };
  return { runs, sentry, transport, tank01Transport, espnCalls, tank01Calls };
}

test('live box source defaults to ESPN and LIVE_BOX_SOURCE=tank01 pins Tank01', (t) => {
  world(t);
  assert.equal(liveBox.configuredBoxSource(), 'espn');
  assert.equal(liveBox.activeBoxSource(), 'espn');
  process.env.LIVE_BOX_SOURCE = 'tank01';
  assert.equal(liveBox.configuredBoxSource(), 'tank01');
  assert.equal(liveBox.activeBoxSource(), 'tank01');
});

test('a healthy ESPN summary is the Live box and costs no Tank01 call', async (t) => {
  const w = world(t);
  const out = await liveBox.fetchLiveBox({ ...GAME, transport: w.transport, tank01Transport: w.tank01Transport, now: 1000 });
  assert.equal(out.source, 'espn');
  assert.equal(out.liveBox.source, 'espn');
  assert.ok(out.liveBox.players.length > 40);
  assert.match(w.espnCalls[0].url, /\/summary$/);
  assert.equal(w.espnCalls[0].opts.params.event, '401872656');
  assert.equal(w.tank01Calls.length, 0);
  assert.deepEqual(w.runs, [], 'no switch, no row');
});

test('three ESPN failures switch the Live box to Tank01 and write one live-box row; a success switches back with a second', async (t) => {
  let fail = true;
  const w = world(t, { espn: () => { if (fail) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }); return { data: inProgressSummary() }; } });
  const args = { ...GAME, transport: w.transport, tank01Transport: w.tank01Transport };

  const first = await liveBox.fetchLiveBox({ ...args, now: 0 });
  const second = await liveBox.fetchLiveBox({ ...args, now: 30_000 });
  assert.equal(first.skipped, true, 'one failure skips the tick, spending nothing');
  assert.equal(second.skipped, true);
  assert.equal(w.tank01Calls.length, 0);
  assert.deepEqual(w.runs, []);

  const third = await liveBox.fetchLiveBox({ ...args, now: 60_000 });
  assert.equal(liveBox.activeBoxSource(), 'tank01', 'the third consecutive failure enters fallback');
  assert.equal(third.source, 'tank01');
  assert.equal(third.liveBox.source, 'tank01', 'the same tick reads the Tank01 box');
  assert.equal(w.tank01Calls.length, 1);
  assert.equal(w.tank01Calls[0].path, '/getNFLBoxScore');
  assert.equal(w.runs.length, 1, 'entering fallback writes exactly one row');
  assert.equal(w.runs[0].job, 'live-box');
  assert.equal(w.runs[0].ok, false);
  assert.equal(w.runs[0].detail.gameId, GAME.gameId);
  assert.equal(w.runs[0].detail.failureKind, 'fetch_failed');
  assert.equal(w.runs[0].detail.consecutiveFailures, 3);
  assert.equal(w.sentry.messages.length, 1, 'and one Sentry message');

  // ESPN is retried every tick; the first success takes the Live box back.
  fail = false;
  const fourth = await liveBox.fetchLiveBox({ ...args, now: 90_000 });
  assert.equal(fourth.source, 'espn');
  assert.equal(liveBox.activeBoxSource(), 'espn');
  assert.equal(w.runs.length, 2);
  assert.equal(w.runs[1].ok, true, 'recovery is an ok row');
  assert.equal(w.runs[1].detail.direction, 'recovery');
  assert.equal(w.sentry.messages.length, 2);
});

test('shape failure: a 200 with zero athletes for a game in progress counts as an ESPN failure', async (t) => {
  const hollow = { ...inProgressSummary(), boxscore: { teams: [], players: [] }, scoringPlays: [], drives: {} };
  const w = world(t, { espn: () => ({ data: hollow }) });
  const args = { ...GAME, transport: w.transport, tank01Transport: w.tank01Transport };
  await liveBox.fetchLiveBox({ ...args, now: 0 });
  await liveBox.fetchLiveBox({ ...args, now: 30_000 });
  const third = await liveBox.fetchLiveBox({ ...args, now: 60_000 });
  assert.equal(third.source, 'tank01');
  assert.equal(w.runs[0].detail.failureKind, 'empty_box');
});

test('a final game with no athletes is not a shape failure (nothing to read is legitimate off the field)', async (t) => {
  const hollow = { ...summary, boxscore: { teams: [], players: [] }, scoringPlays: [], drives: {} };
  const w = world(t, { espn: () => ({ data: hollow }) });
  const out = await liveBox.fetchLiveBox({ ...GAME, inProgress: false, transport: w.transport, tank01Transport: w.tank01Transport, now: 0 });
  assert.equal(out.source, 'espn');
  assert.equal(liveBox.activeBoxSource(), 'espn');
});

test('in fallback the Tank01 box is read at LIVE_FAST_POLL_MS per game, not every tick', async (t) => {
  const w = world(t, { espn: () => { throw new Error('boom'); } });
  const args = { ...GAME, transport: w.transport, tank01Transport: w.tank01Transport };
  await liveBox.fetchLiveBox({ ...args, now: 0 });
  await liveBox.fetchLiveBox({ ...args, now: 30_000 });
  await liveBox.fetchLiveBox({ ...args, now: 60_000 }); // enters fallback, reads Tank01
  assert.equal(w.tank01Calls.length, 1);
  const soon = await liveBox.fetchLiveBox({ ...args, now: 90_000 });
  assert.equal(soon.skipped, true, 'thirty seconds later the paid box is not re-read');
  assert.equal(w.tank01Calls.length, 1);
  const later = await liveBox.fetchLiveBox({ ...args, now: 60_000 + 10 * 60 * 1000 });
  assert.equal(later.source, 'tank01');
  assert.equal(w.tank01Calls.length, 2, 'ten minutes on, it is');
  assert.equal(w.runs.length, 1, 'staying in fallback writes no further rows');
});

test('the first apply after a source switch writes stats but emits no Scoring plays, in both directions', async (t) => {
  world(t);
  const upserts = [];
  const pool = require('../modules/pool');
  t.mock.method(pool, 'query', async (sql, params) => {
    if (String(sql).includes('INTO "player_stats"')) { upserts.push(params); return { rows: [] }; }
    if (String(sql).includes('INTO "data_sync_runs"')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const maps = () => ({
    idByExternal: new Map([['4430878', 12]]),
    metaById: new Map([[12, { name: 'Jaxon Smith-Njigba', position: 'WR', nfl_team: 'SEA' }]]),
    defByTeamCode: new Map(),
    prevById: new Map(),
    opponentByTeam: new Map(),
  });
  const espnBox = { gameId: GAME.gameId, source: 'espn', isFinal: false, players: [{ externalId: '4430878', stats: { receptions: 4, receivingYards: 60, receivingTDs: 1 } }], teamDefense: {}, scoreSummaryLines: [] };
  const tank01Box = { ...espnBox, source: 'tank01', players: [{ externalId: '4430878', stats: { receptions: 6, receivingYards: 90, receivingTDs: 2 } }] };
  const espnAgain = { ...espnBox, players: [{ externalId: '4430878', stats: { receptions: 8, receivingYards: 122, receivingTDs: 3 } }] };

  const m = maps();
  const a = await liveBox.applyLiveBox({ liveBox: espnBox, season: 2026, week: 1, maps: m });
  assert.equal(a.plays.length, 1, 'the first ever apply is not a switch: the TD is a play');
  const b = await liveBox.applyLiveBox({ liveBox: tank01Box, season: 2026, week: 1, maps: m });
  assert.deepEqual(b.plays, [], 'espn -> tank01: stats written, no plays');
  assert.equal(b.updated, 1);
  assert.equal(JSON.parse(upserts[1][3]).receivingTDs, 2, 'the Tank01 numbers landed');
  const c = await liveBox.applyLiveBox({ liveBox: espnAgain, season: 2026, week: 1, maps: m });
  assert.deepEqual(c.plays, [], 'tank01 -> espn: again no plays');
  assert.equal(JSON.parse(upserts[2][3]).receivingTDs, 3);
  const d = await liveBox.applyLiveBox({ liveBox: { ...espnAgain, players: [{ externalId: '4430878', stats: { receptions: 9, receivingYards: 130, receivingTDs: 4 } }] }, season: 2026, week: 1, maps: m });
  assert.equal(d.plays.length, 1, 'the next apply on the same source emits plays again');
});

test('applyGameBoxScore refuses a Live box for a game whose Final box has landed (#1186 guard)', async (t) => {
  const pool = require('../modules/pool');
  t.mock.method(pool, 'query', async () => { throw new Error('must not write'); });
  const maps = {
    idByExternal: new Map([['4430878', 12]]),
    metaById: new Map([[12, { name: 'JSN', position: 'WR', nfl_team: 'SEA' }]]),
    defByTeamCode: new Map(),
    prevById: new Map([[12, { receptions: 8, receivingTDs: 1 }]]),
    opponentByTeam: new Map(),
    finalSyncedGameIds: new Set([GAME.gameId]),
  };
  const box = { gameId: GAME.gameId, source: 'espn', isFinal: true, players: [{ externalId: '4430878', stats: { receptions: 9, receivingTDs: 2 } }], teamDefense: {}, scoreSummaryLines: [] };
  const out = await scoring.applyGameBoxScore({ liveBox: box, season: 2026, week: 1, maps });
  assert.deepEqual(out, { updated: 0, plays: [], skipped: 'final-box-landed' });
  assert.deepEqual(maps.prevById.get(12), { receptions: 8, receivingTDs: 1 }, 'fantasy points and the baseline are untouched');
});
