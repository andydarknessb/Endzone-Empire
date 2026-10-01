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

test('weather-snapshots never throws into the tick: an NWS outage records a failed run so the next tick retries', async (t) => {
  withUserAgent(t);
  mockNws(t, { fail: true });
  stubGate(t);
  const world = weatherWorld(t);
  t.mock.method(console, 'error', () => {});

  assert.equal(await scheduler.runWeatherSnapshotSync({ now: T0 }), null, 'resolves, never throws');
  assert.equal(world.writes.length, 0);
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].job, 'weather-snapshots');
  assert.equal(world.syncRuns[0].ok, false);
});

test('weather-snapshots fails the run when forecasts were fetched and none was saved', async (t) => {
  withUserAgent(t);
  mockNws(t);
  stubGate(t);
  const world = weatherWorld(t);
  const original = require('../modules/pool').query;
  t.mock.method(require('../modules/pool'), 'query', async (sql, params) => {
    if (/^INSERT INTO "game_weather_snapshots"/.test(String(sql).replace(/\s+/g, ' ').trim())) throw new Error('disk full');
    return original(sql, params);
  });
  t.mock.method(console, 'error', () => {});

  assert.equal(await scheduler.runWeatherSnapshotSync({ now: T0 }), null);
  assert.equal(world.writes.length, 0);
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].ok, false);
});

test('weather-snapshots keeps an unconfigured NWS_USER_AGENT an ok run and says why nothing was fetched', async (t) => {
  const previous = process.env.NWS_USER_AGENT;
  delete process.env.NWS_USER_AGENT;
  t.after(() => { if (previous !== undefined) process.env.NWS_USER_AGENT = previous; });
  const nwsCalls = mockNws(t);
  stubGate(t);
  const world = weatherWorld(t);

  const result = await scheduler.runWeatherSnapshotSync({ now: T0 });
  assert.ok(result);
  assert.deepEqual(nwsCalls, []);
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].ok, true);
  assert.match(world.syncRuns[0].detail.reason, /NWS_USER_AGENT/);
});

test('weather-snapshots stays an ok run when at least one forecast was fetched and saved', async (t) => {
  withUserAgent(t);
  mockNws(t);
  stubGate(t);
  const world = weatherWorld(t);

  const result = await scheduler.runWeatherSnapshotSync({ now: T0 });
  assert.equal(result.fetched, 1);
  assert.equal(world.syncRuns[0].ok, true);
});

test('tickUnlocked registers the weather snapshots duty', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );

  assert.match(tickBody, /await runWeatherSnapshotSync\(\);/);
});

test('weather-snapshots gate: an ok row holds it for 6 hours, a failed row leaves it due, an empty window still holds it', async (t) => {
  withUserAgent(t);
  const nwsCalls = mockNws(t);
  const games = [GAME_ROW];
  const world = weatherWorld(t, { games });
  // The real gate (cadence.due is NOT stubbed) reads data_sync_runs through
  // syncRun.lastRun; answer it from the rows the job itself recorded.
  let clock = T0;
  const pool = require('../modules/pool');
  const original = pool.query;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (/^SELECT \(SELECT row_to_json\(r\).*FROM "data_sync_runs"/.test(text)) {
      const mine = world.syncRuns.filter((r) => r.job === params[0]);
      const toJson = (r) => ({ id: r.id, finished_at: r.finishedAt, ok: r.ok, detail: r.detail });
      const latest = mine[mine.length - 1];
      const latestOk = [...mine].reverse().find((r) => r.ok);
      return { rows: [{ latest: latest ? toJson(latest) : null, latestOk: latestOk ? toJson(latestOk) : null }] };
    }
    const res = await original(sql, params);
    if (/^INSERT INTO "data_sync_runs"/.test(text)) {
      const row = world.syncRuns[world.syncRuns.length - 1];
      row.id = world.syncRuns.length;
      row.finishedAt = clock;
    }
    return res;
  });
  t.mock.method(console, 'error', () => {});

  // 1. First run: never run, due. It fetches and records an ok row.
  await scheduler.runWeatherSnapshotSync({ now: clock });
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].ok, true);
  const callsAfterFirst = nwsCalls.length;
  assert.ok(callsAfterFirst > 0);

  // 2. Inside 6 hours of the ok row: not due, no NWS request, no new row.
  clock = new Date(T0.getTime() + 5 * HOUR);
  assert.equal(await scheduler.runWeatherSnapshotSync({ now: clock }), null);
  assert.equal(nwsCalls.length, callsAfterFirst);
  assert.equal(world.syncRuns.length, 1);

  // 3. A failed row never moves the gate: the next call is still due.
  world.syncRuns.length = 0;
  world.snapshots.clear();
  world.syncRuns.push({ job: 'weather-snapshots', ok: false, detail: null, id: 1, finishedAt: T0 });
  clock = new Date(T0.getTime() + 1 * HOUR);
  const before = nwsCalls.length;
  await scheduler.runWeatherSnapshotSync({ now: clock });
  assert.ok(nwsCalls.length > before, 'a failed row leaves the next call due');
  assert.equal(world.syncRuns[world.syncRuns.length - 1].ok, true);

  // 4. A run with no games in the window records an ok row that holds the gate.
  games.length = 0;
  world.syncRuns.length = 0;
  clock = new Date(T0.getTime() + 20 * HOUR);
  await scheduler.runWeatherSnapshotSync({ now: clock });
  assert.equal(world.syncRuns.length, 1);
  assert.equal(world.syncRuns[0].ok, true);
  const quiet = nwsCalls.length;
  clock = new Date(clock.getTime() + 1 * HOUR);
  assert.equal(await scheduler.runWeatherSnapshotSync({ now: clock }), null);
  assert.equal(nwsCalls.length, quiet);
  assert.equal(world.syncRuns.length, 1, 'held by the empty-window ok row');
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
