const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { createFakePool } = require('./helpers/fakePool');
const scheduler = require('../modules/scheduler');
const cadence = require('../modules/cadence');
const weather = require('../services/nwsWeather.service');

// #1883: game_weather_snapshots had exactly one writer, the projection run
// that generates a week, so once a week's projections were cached nothing
// refreshed its forecast again (a 42-hour silence). The weather-snapshots Sync
// run owns the refresh now, on its own 6-hour cadence (one horizon bucket).
//
// Every NWS call goes through a mocked axios.create, never the network.

const HOUR = 3600000;
const T0 = new Date('2026-10-09T17:00:00.000Z');
const KICKOFF = '2026-10-11T17:00:00.000Z'; // 48 hours after T0
const GAME_ROW = {
  game_key: '2026_06_NYJ_BUF',
  season: 2026,
  week: 6,
  kickoff_at: new Date(KICKOFF),
  roof: 'outdoors',
  venue: 'Highmark Stadium',
};

function withUserAgent(t) {
  const previous = process.env.NWS_USER_AGENT;
  process.env.NWS_USER_AGENT = 'EndzoneEmpire/1.0 (test)';
  t.after(() => {
    if (previous === undefined) delete process.env.NWS_USER_AGENT;
    else process.env.NWS_USER_AGENT = previous;
  });
}

function mockNws(t, { fail = false } = {}) {
  const calls = [];
  const transport = {
    async get(url) {
      calls.push(url);
      if (fail) throw new Error('timeout of 3500ms exceeded');
      if (url.includes('/points/')) {
        return { data: { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/BUF/40,60/forecast/hourly' } } };
      }
      return {
        data: {
          properties: {
            periods: [{
              startTime: KICKOFF, temperature: 54, temperatureUnit: 'F', windSpeed: '10 mph',
              probabilityOfPrecipitation: { value: 40 }, shortForecast: 'Windy',
            }],
          },
        },
      };
    },
  };
  t.mock.method(axios, 'create', () => transport);
  return calls;
}

/**
 * A pool world: nfl_games answers with `games`, game_weather_snapshots keeps
 * what the job writes (keyed game_key:horizon_hours, like the real unique
 * index) and answers the cache read from it.
 */
function weatherWorld(t, { games = [GAME_ROW], inWindow = false } = {}) {
  const snapshots = new Map();
  const writes = [];
  const syncRuns = [];
  const fake = createFakePool([
    [/FROM "live_game_states"/, () => ({ rows: inWindow ? [{ '?column?': 1 }] : [] })],
    [/FROM "nfl_games"/, () => ({ rows: games })],
    [/^SELECT .* FROM "game_weather_snapshots"/, () => ({
      rows: [...snapshots.values()].map((s) => ({
        game_key: s.gameKey, horizon_hours: s.horizonHours, forecast_time: s.forecastTime,
        temperature_f: s.temperatureF, wind_speed_mph: null, wind_gust_mph: null,
        precipitation_probability: s.precipitationProbability, short_forecast: s.shortForecast,
        fetched_at: T0,
      })),
    })],
    [/^INSERT INTO "game_weather_snapshots"/, (text, params) => {
      const [season, week, gameKey, horizonHours, forecastTime, temperatureF, , , precipitationProbability, shortForecast] = params;
      const write = { season, week, gameKey, horizonHours, forecastTime, temperatureF, precipitationProbability, shortForecast };
      writes.push(write);
      snapshots.set(`${gameKey}:${horizonHours}`, write);
      return { rows: [], rowCount: 1 };
    }],
    [/^INSERT INTO "data_sync_runs"/, (text, params) => {
      syncRuns.push({ job: params[0], ok: params[2], detail: params[3] ? JSON.parse(params[3]) : null });
      return { rows: [] };
    }],
  ]).install(t);
  return { fake, snapshots, writes, syncRuns };
}

function stubGate(t, due = true) {
  const asked = [];
  t.mock.method(cadence, 'due', async (args) => {
    asked.push(args);
    return { due, reason: 'stubbed' };
  });
  return asked;
}

test('weather-snapshots writes a fresh snapshot every 6 hours with no projection generation in between', async (t) => {
  withUserAgent(t);
  const nwsCalls = mockNws(t);
  const asked = stubGate(t);
  const world = weatherWorld(t);

  await scheduler.runWeatherSnapshotSync({ now: T0 });
  await scheduler.runWeatherSnapshotSync({ now: new Date(T0.getTime() + 6 * HOUR) });

  assert.equal(world.writes.length, 2, 'one snapshot per run, none from a projection run');
  assert.deepEqual(world.writes.map((w) => w.gameKey), ['2026_06_NYJ_BUF', '2026_06_NYJ_BUF']);
  assert.equal(world.writes[0].horizonHours, 48);
  assert.equal(world.writes[1].horizonHours, 42);
  assert.ok(world.writes[1].horizonHours < world.writes[0].horizonHours);
  assert.equal(nwsCalls.length, 4, 'two lookups (points, hourly) per run');

  assert.deepEqual(world.syncRuns.map((r) => r.job), ['weather-snapshots', 'weather-snapshots']);
  assert.ok(world.syncRuns.every((r) => r.ok === true));
  assert.equal(asked.length, 2);
  assert.equal(asked[0].job, 'weather-snapshots');
  assert.deepEqual(asked[0].every, { ms: 6 * HOUR });
  assert.equal(scheduler.WEATHER_SNAPSHOT_INTERVAL_MS, weather.HORIZON_BUCKET_HOURS * HOUR);
});

test('weather-snapshots only asks about games kicking off in the future and within MAX_HORIZON_HOURS', async (t) => {
  withUserAgent(t);
  mockNws(t);
  stubGate(t);
  const world = weatherWorld(t);

  await scheduler.runWeatherSnapshotSync({ now: T0 });
  const query = world.fake.calls.find((c) => /FROM "nfl_games"/.test(c.text));
  assert.ok(query, 'the games read ran');
  assert.equal(query.params[0].getTime(), T0.getTime());
  assert.equal(query.params[1].getTime(), T0.getTime() + weather.MAX_HORIZON_HOURS * HOUR);
});

test('weather-snapshots does not run when the cadence gate says not due', async (t) => {
  withUserAgent(t);
  const nwsCalls = mockNws(t);
  stubGate(t, false);
  const world = weatherWorld(t);

  assert.equal(await scheduler.runWeatherSnapshotSync({ now: T0 }), null);
  assert.equal(world.fake.calls.length, 0);
  assert.deepEqual(nwsCalls, []);
});

test('weather-snapshots waits out an open game window so it never holds live scoring', async (t) => {
  withUserAgent(t);
  const nwsCalls = mockNws(t);
  stubGate(t);
  const world = weatherWorld(t, { inWindow: true });

  assert.equal(await scheduler.runWeatherSnapshotSync({ now: T0 }), null);
  assert.deepEqual(nwsCalls, []);
  assert.equal(world.syncRuns.length, 0, 'no row, so the gate is still due on the next tick');
});

test('weather-snapshots never throws into the tick: an NWS failure is recorded as a normal run with no snapshot', async (t) => {
  withUserAgent(t);
  mockNws(t, { fail: true });
  stubGate(t);
  const world = weatherWorld(t);
  t.mock.method(console, 'error', () => {});

  const result = await scheduler.runWeatherSnapshotSync({ now: T0 });
  assert.ok(result, 'resolves');
  assert.equal(world.writes.length, 0);
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].job, 'weather-snapshots');
});

test('weather-snapshots swallows a failed games read and records the failed run', async (t) => {
  withUserAgent(t);
  mockNws(t);
  stubGate(t);
  const world = weatherWorld(t);
  world.fake.calls.length = 0;
  // Replace the games read with a fault; handlers are live, so put it first.
  const pool = require('../modules/pool');
  const original = pool.query;
  t.mock.method(pool, 'query', async (sql, params) => {
    if (/FROM "nfl_games"/.test(String(sql))) throw new Error('connection reset');
    return original(sql, params);
  });
  t.mock.method(console, 'error', () => {});

  assert.equal(await scheduler.runWeatherSnapshotSync({ now: T0 }), null);
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].ok, false);
});
