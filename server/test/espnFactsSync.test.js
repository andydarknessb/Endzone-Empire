const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert } = require('./helpers/fakePool');
const teamDepthChartFixture = require('./fixtures/espn/team-depth-chart.json');
const fantasyPlayerInfoFixture = require('./fixtures/espn/fantasy-player-info.json');
const { runDepthChartSync, runOwnershipSync } = require('../modules/espnFactsSync');

const PLAYERS_BY_EXTERNAL_ID = /^SELECT "id", "external_id" FROM "players"/;
const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));

function neOnlyTransport() {
  return {
    get: async (url) => {
      if (/\/teams\/17\//.test(url)) return { data: teamDepthChartFixture };
      const err = new Error('Not Found');
      err.response = { status: 404 };
      throw err;
    },
  };
}

function fantasyTransport() {
  return { get: async () => ({ data: fantasyPlayerInfoFixture }) };
}

// ---------------------------------------------------------------------------
// runDepthChartSync
// ---------------------------------------------------------------------------

test('runDepthChartSync: fetches every team outside a transaction, writes NE\'s rows inside one, records ok=true', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }, { id: 502, external_id: 4431598 }] })],
    [insert('player_depth_chart'), (text, params) => {
      assert.match(text, /ON CONFLICT \("player_id", "captured_date"\) DO NOTHING/);
      return { rowCount: params[0].length };
    }],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z'), transport: neOnlyTransport() });

  assert.equal(result.teamCode, 'NE');
  assert.ok(result.written >= 2);
  assert.equal(fake.matching(/^BEGIN$/).length, 1, 'exactly one team produced a unit, so exactly one transaction opens');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], true, 'ok is true');
  fake.assertClean();
});

test('runDepthChartSync: an athlete ESPN reports that we do not roster is skipped, not inserted', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [] })], // no known player matches any athlete id on the chart
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z'), transport: neOnlyTransport() });
  assert.deepEqual(result, { teamCode: 'NE', written: 0 });
  assert.equal(fake.matching(insert('player_depth_chart')).length, 0, 'no known players -> no INSERT at all');
  fake.assertClean();
});

test('runDepthChartSync: a second run on the same captured_date records success with zero rows (ON CONFLICT DO NOTHING)', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }, { id: 502, external_id: 4431598 }] })],
    // The unique (player_id, captured_date) index already holds today's rows,
    // so the real INSERT ... ON CONFLICT DO NOTHING would report 0 written -
    // this fake reproduces exactly that observable outcome.
    [insert('player_depth_chart'), () => ({ rowCount: 0 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z'), transport: neOnlyTransport() });
  assert.equal(result.written, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true, 'still recorded ok=true, not a failure');
  fake.assertClean();
});

test('runDepthChartSync: no team returns any rows -> no transaction opens, still records ok=true', async (t) => {
  const noneTransport = { get: async () => { const err = new Error('Not Found'); err.response = { status: 404 }; throw err; } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ transport: noneTransport });
  assert.deepEqual(result, { results: [] });
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
  fake.assertClean();
});

test('runDepthChartSync: takes no advisory lock', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }] })],
    [insert('player_depth_chart'), (text, params) => ({ rowCount: params[0].length })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await runDepthChartSync({ transport: neOnlyTransport() });
  assert.equal(fake.matching(/pg_advisory_xact_lock/).length, 0);
});

// ---------------------------------------------------------------------------
// runOwnershipSync
// ---------------------------------------------------------------------------

test('runOwnershipSync: writes the whole pool as one unit, records ok=true', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 55, external_id: 4431452 }] })],
    [insert('player_ownership'), (text, params) => {
      assert.match(text, /ON CONFLICT \("player_id", "captured_date"\) DO NOTHING/);
      assert.doesNotMatch(text, /draft_rank|rankings|projection/i);
      return { rowCount: params[0].length };
    }],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({ now: new Date('2026-09-15T12:00:00Z'), transport: fantasyTransport() });

  assert.equal(result.written, 1);
  assert.equal(fake.matching(/^BEGIN$/).length, 1);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('runOwnershipSync: an athlete ESPN reports that we do not roster is skipped, not inserted', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [] })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({ transport: fantasyTransport() });
  assert.deepEqual(result, { written: 0 });
  assert.equal(fake.matching(insert('player_ownership')).length, 0);
  fake.assertClean();
});

test('runOwnershipSync: a second run on the same captured_date records success with zero rows', async (t) => {
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 55, external_id: 4431452 }] })],
    [insert('player_ownership'), () => ({ rowCount: 0 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({ transport: fantasyTransport() });
  assert.equal(result.written, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('runOwnershipSync: an ESPN fetch failure resolves [] (client never throws) and still records ok=true with zero written', async (t) => {
  const failingTransport = { get: async () => { const err = new Error('down'); err.response = { status: 500 }; throw err; } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({ transport: failingTransport });
  assert.deepEqual(result, { written: 0 });
  assert.equal(fake.matching(/^BEGIN$/).length, 1, 'one unit (an empty array) still runs, per runSyncJob single-unit semantics');
  fake.assertClean();
});
