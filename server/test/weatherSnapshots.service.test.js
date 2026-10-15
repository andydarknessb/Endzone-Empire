const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const weatherSnapshots = require('../services/weatherSnapshots.service');
const nws = require('../services/nwsWeather.service');

// The weather-snapshots Sync run body, driven directly (the scheduler keeps
// the gate; scheduler.weatherSnapshots.test.js covers it end to end). Each
// case reads the recorded data_sync_runs row: `ok` plus `detail.reason`.

const NOW = new Date('2026-10-09T17:00:00.000Z');
const GAME_ROW = {
  game_key: '2026_06_NYJ_BUF',
  season: 2026,
  week: 6,
  kickoff_at: new Date('2026-10-11T17:00:00.000Z'),
  roof: 'outdoors',
  venue: 'Highmark Stadium',
};

function world(t, { gamesHandler = () => ({ rows: [GAME_ROW] }) } = {}) {
  const syncRuns = [];
  createFakePool([
    [/FROM "nfl_games"/, gamesHandler],
    [/^INSERT INTO "data_sync_runs"/, (text, params) => {
      syncRuns.push({ job: params[0], ok: params[2], detail: JSON.parse(params[3]) });
      return { rows: [] };
    }],
  ]).install(t);
  return syncRuns;
}

test('runWeatherSnapshots records an ok row carrying the unit coverage', async (t) => {
  t.mock.method(nws, 'getForecastsForGames', async () => ({ coverage: { requests: 2, fetched: 2, saved: 1 } }));
  const syncRuns = world(t);

  const outcome = await weatherSnapshots.runWeatherSnapshots({ now: NOW });

  assert.equal(outcome.status, 'ok');
  assert.equal(syncRuns.length, 1);
  assert.equal(syncRuns[0].job, 'weather-snapshots');
  assert.equal(syncRuns[0].ok, true);
  assert.deepEqual(syncRuns[0].detail, { season: 2026, week: 6, games: 1, requests: 2, fetched: 2, saved: 1 });
});

test('runWeatherSnapshots records write_failed when apply throws (fetched forecasts, saved none)', async (t) => {
  t.mock.method(nws, 'getForecastsForGames', async () => ({ coverage: { requests: 2, fetched: 2, saved: 0 } }));
  const syncRuns = world(t);

  await assert.rejects(weatherSnapshots.runWeatherSnapshots({ now: NOW }), /saved none/);

  assert.equal(syncRuns.length, 1);
  assert.equal(syncRuns[0].ok, false);
  assert.equal(syncRuns[0].detail.reason, 'write_failed');
});

test('runWeatherSnapshots records fetch_failed when the games read throws', async (t) => {
  t.mock.method(nws, 'getForecastsForGames', async () => { throw new Error('must not be reached'); });
  const syncRuns = world(t, { gamesHandler: () => { throw new Error('connection reset'); } });

  await assert.rejects(weatherSnapshots.runWeatherSnapshots({ now: NOW }), /connection reset/);

  assert.equal(syncRuns.length, 1);
  assert.equal(syncRuns[0].ok, false);
  assert.equal(syncRuns[0].detail.reason, 'fetch_failed');
});
