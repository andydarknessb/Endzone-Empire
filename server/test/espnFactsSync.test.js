const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert } = require('./helpers/fakePool');
const espnAthleteClient = require('../modules/espnAthleteClient');
const { runDepthChartSync, runOwnershipSync } = require('../modules/espnFactsSync');

const PLAYERS_BY_EXTERNAL_ID = /^SELECT "id", "external_id" FROM "players"/;
const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));

/** Mocks `espnAthleteClient.teamDepthChart` so only `teamCode` succeeds
 * (real fixture-shaped rows); every other of our 32 teams resolves `[]`
 * (ESPN answered, nothing there) - never `null`, so the fetch's consecutive-
 * failure circuit breaker never trips in a test that isn't specifically
 * exercising it. */
function mockTeamDepthChart(t, { teamCode, rows }) {
  t.mock.method(espnAthleteClient, 'teamDepthChart', async (code) => (code === teamCode ? rows : []));
}

// ---------------------------------------------------------------------------
// runDepthChartSync
// ---------------------------------------------------------------------------

test('runDepthChartSync: writes one team\'s rows inside one transaction, records ok=true', async (t) => {
  mockTeamDepthChart(t, {
    teamCode: 'NE',
    rows: [
      { athleteId: '4372030', teamCode: 'NE', positionGroup: 'LDE', rank: 1 },
      { athleteId: '4431598', teamCode: 'NE', positionGroup: 'LDE', rank: 2 },
    ],
  });
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }, { id: 502, external_id: 4431598 }] })],
    [insert('player_depth_chart'), (text, params) => {
      assert.match(text, /ON CONFLICT \("player_id", "captured_date"\) DO NOTHING/);
      return { rowCount: params[0].length };
    }],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z') });

  assert.equal(result.teamCode, 'NE');
  assert.ok(result.written >= 2);
  assert.equal(fake.matching(/^BEGIN$/).length, 1, 'exactly one team produced a unit, so exactly one transaction opens');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], true, 'ok is true');
  fake.assertClean();
});

test('runDepthChartSync: an athlete ESPN reports that we do not roster is skipped, not inserted', async (t) => {
  mockTeamDepthChart(t, { teamCode: 'NE', rows: [{ athleteId: '4372030', teamCode: 'NE', positionGroup: 'LDE', rank: 1 }] });
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [] })], // no known player matches any athlete id on the chart
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z') });
  assert.deepEqual(result, { teamCode: 'NE', written: 0 });
  assert.equal(fake.matching(insert('player_depth_chart')).length, 0, 'no known players -> no INSERT at all');
  fake.assertClean();
});

test('runDepthChartSync: a second run on the same captured_date records success with zero rows (ON CONFLICT DO NOTHING)', async (t) => {
  mockTeamDepthChart(t, {
    teamCode: 'NE',
    rows: [
      { athleteId: '4372030', teamCode: 'NE', positionGroup: 'LDE', rank: 1 },
      { athleteId: '4431598', teamCode: 'NE', positionGroup: 'LDE', rank: 2 },
    ],
  });
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }, { id: 502, external_id: 4431598 }] })],
    // The unique (player_id, captured_date) index already holds today's rows,
    // so the real INSERT ... ON CONFLICT DO NOTHING would report 0 written -
    // this fake reproduces exactly that observable outcome.
    [insert('player_depth_chart'), () => ({ rowCount: 0 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z') });
  assert.equal(result.written, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true, 'still recorded ok=true, not a failure');
  fake.assertClean();
});

test('runDepthChartSync: no team returns any rows (all empty, none failed) -> no transaction opens, still records ok=true', async (t) => {
  t.mock.method(espnAthleteClient, 'teamDepthChart', async () => []);
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({});
  assert.deepEqual(result, { results: [] });
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
  fake.assertClean();
});

test('runDepthChartSync: takes no advisory lock', async (t) => {
  mockTeamDepthChart(t, { teamCode: 'NE', rows: [{ athleteId: '4372030', teamCode: 'NE', positionGroup: 'LDE', rank: 1 }] });
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }] })],
    [insert('player_depth_chart'), (text, params) => ({ rowCount: params[0].length })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await runDepthChartSync({});
  assert.equal(fake.matching(/pg_advisory_xact_lock/).length, 0);
});

test('runDepthChartSync: three consecutive team fetch failures trip the circuit breaker and stop the sweep (formal review f3 over-fix guard)', async (t) => {
  const calledTeams = [];
  t.mock.method(espnAthleteClient, 'teamDepthChart', async (teamCode) => {
    calledTeams.push(teamCode);
    return null; // every team fails
  });
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(runDepthChartSync({}), /consecutive team fetches failed/);
  assert.equal(calledTeams.length, 3, 'stops after the third consecutive failure rather than sweeping all 32 teams');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], false, 'recorded fetch_failed, not an ok empty snapshot');
});

test('runDepthChartSync: a total ESPN outage records fetch_failed (ok=false), so the once-a-day gate stays open for the next tick to retry', async (t) => {
  t.mock.method(espnAthleteClient, 'teamDepthChart', async () => null);
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(runDepthChartSync({}));
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], false);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed');
});

test('runDepthChartSync: an occasional single failed team (not consecutive enough to trip the breaker) does not stop the run', async (t) => {
  // ATL fails once, every other team (including NE) resets the streak by
  // succeeding - one bad team must never take down the whole sweep.
  t.mock.method(espnAthleteClient, 'teamDepthChart', async (teamCode) => {
    if (teamCode === 'ATL') return null;
    if (teamCode === 'NE') return [{ athleteId: '4372030', teamCode: 'NE', positionGroup: 'LDE', rank: 1 }];
    return [];
  });
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }] })],
    [insert('player_depth_chart'), (text, params) => ({ rowCount: params[0].length })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runDepthChartSync({ now: new Date('2026-09-15T12:00:00Z') });
  assert.equal(result.teamCode, 'NE');
  assert.ok(result.written >= 1);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
});

test('runDepthChartSync: stamps the run\'s UTC day into detail.day, computed once at the start of the run (#1509)', async (t) => {
  mockTeamDepthChart(t, { teamCode: 'NE', rows: [{ athleteId: '4372030', teamCode: 'NE', positionGroup: 'LDE', rank: 1 }] });
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 501, external_id: 4372030 }] })],
    [insert('player_depth_chart'), (text, params) => ({ rowCount: params[0].length })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  // 23:30 US Central on the 20th is already 04:30 UTC the 21st - the input
  // that turns a local-calendar-day comparison red (fleet#1509 red-tell).
  await runDepthChartSync({ now: new Date('2026-08-20T23:30:00-05:00') });

  const runs = dataSyncRuns(fake.calls);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.day, '2026-08-21', 'the UTC day, not the local en-CA day (2026-08-20)');
});

// ---------------------------------------------------------------------------
// runOwnershipSync
// ---------------------------------------------------------------------------

test('runOwnershipSync: writes the whole pool as one unit, records ok=true', async (t) => {
  t.mock.method(espnAthleteClient, 'ownership', async () => [{ athleteId: '4431452', percentOwned: 99.31, percentStarted: 78.37, percentChange: -0.03 }]);
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 55, external_id: 4431452 }] })],
    [insert('player_ownership'), (text, params) => {
      assert.match(text, /ON CONFLICT \("player_id", "captured_date"\) DO NOTHING/);
      assert.doesNotMatch(text, /draft_rank|rankings|projection/i);
      return { rowCount: params[0].length };
    }],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({ now: new Date('2026-09-15T12:00:00Z') });

  assert.equal(result.written, 1);
  assert.equal(fake.matching(/^BEGIN$/).length, 1);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('runOwnershipSync: an athlete ESPN reports that we do not roster is skipped, not inserted', async (t) => {
  t.mock.method(espnAthleteClient, 'ownership', async () => [{ athleteId: '4431452', percentOwned: 99.31, percentStarted: 78.37, percentChange: -0.03 }]);
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [] })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({});
  assert.deepEqual(result, { written: 0 });
  assert.equal(fake.matching(insert('player_ownership')).length, 0);
  fake.assertClean();
});

test('runOwnershipSync: a second run on the same captured_date records success with zero rows', async (t) => {
  t.mock.method(espnAthleteClient, 'ownership', async () => [{ athleteId: '4431452', percentOwned: 99.31, percentStarted: 78.37, percentChange: -0.03 }]);
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 55, external_id: 4431452 }] })],
    [insert('player_ownership'), () => ({ rowCount: 0 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runOwnershipSync({});
  assert.equal(result.written, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('runOwnershipSync: an ESPN fetch failure (null) records fetch_failed (ok=false), so the once-a-day gate stays open for the next tick to retry (formal review f3)', async (t) => {
  t.mock.method(espnAthleteClient, 'ownership', async () => null);
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(runOwnershipSync({}), /ESPN fetch failed/);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], false);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed');
  assert.equal(fake.matching(/^BEGIN$/).length, 0, 'a fetch_failed run never opens a write transaction');
});

test('runOwnershipSync: stamps the run\'s UTC day into detail.day, computed once at the start of the run (#1509)', async (t) => {
  t.mock.method(espnAthleteClient, 'ownership', async () => [{ athleteId: '4431452', percentOwned: 99.31, percentStarted: 78.37, percentChange: -0.03 }]);
  const fake = createFakePool([
    [PLAYERS_BY_EXTERNAL_ID, () => ({ rows: [{ id: 55, external_id: 4431452 }] })],
    [insert('player_ownership'), (text, params) => ({ rowCount: params[0].length })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  // 23:30 US Central on the 20th is already 04:30 UTC the 21st - the input
  // that turns a local-calendar-day comparison red (fleet#1509 red-tell).
  await runOwnershipSync({ now: new Date('2026-08-20T23:30:00-05:00') });

  const runs = dataSyncRuns(fake.calls);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.day, '2026-08-21', 'the UTC day, not the local en-CA day (2026-08-20)');
});
