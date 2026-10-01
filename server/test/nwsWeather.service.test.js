const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const weather = require('../services/nwsWeather.service');

/**
 * Every NWS interaction in these tests goes through an injected `transport`,
 * and `axios.get` is mocked to throw on top of that — so a regression that
 * reintroduces a real HTTP call fails loudly instead of quietly hitting a
 * public API from CI.
 */

const KICKOFF = '2026-10-11T17:00:00.000Z';
const NOW = new Date('2026-10-09T17:00:00.000Z'); // 48 hours before kickoff

function hourlyPeriods() {
  return [
    { startTime: '2026-10-11T14:00:00Z', temperature: 61, temperatureUnit: 'F', windSpeed: '5 mph', probabilityOfPrecipitation: { value: 0 }, shortForecast: 'Sunny' },
    { startTime: '2026-10-11T17:00:00Z', temperature: 54, temperatureUnit: 'F', windSpeed: '10 to 18 mph', windGust: '30 mph', probabilityOfPrecipitation: { value: 40 }, shortForecast: 'Windy' },
    { startTime: '2026-10-11T20:00:00Z', temperature: 49, temperatureUnit: 'F', windSpeed: '12 mph', probabilityOfPrecipitation: { value: 60 }, shortForecast: 'Rain' },
  ];
}

/** A transport that records every URL it is asked for. */
function recordingTransport(calls, { failAfter = Infinity, error = new Error('timeout of 3500ms exceeded') } = {}) {
  return {
    async get(url) {
      calls.push(url);
      if (calls.length > failAfter) throw error;
      if (url.includes('/points/')) {
        return { data: { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/BUF/40,60/forecast/hourly' } } };
      }
      return { data: { properties: { periods: hourlyPeriods() } } };
    },
  };
}

function stubClient(snapshotRows = []) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('SELECT') && text.includes('game_weather_snapshots')) return { rows: snapshotRows };
      writes.push({ text, params });
      return { rows: [], rowCount: 1 };
    },
  };
}

const outdoorGame = (overrides = {}) => ({
  gameKey: '2026_06_NYJ_BUF',
  kickoffAt: KICKOFF,
  roof: 'outdoors',
  venue: 'Highmark Stadium',
  ...overrides,
});

function withUserAgent(t, value = 'EndzoneEmpire/1.0 (test)') {
  const previous = process.env.NWS_USER_AGENT;
  process.env.NWS_USER_AGENT = value;
  t.after(() => {
    if (previous === undefined) delete process.env.NWS_USER_AGENT;
    else process.env.NWS_USER_AGENT = previous;
  });
}

function forbidRealNetwork(t) {
  const calls = [];
  t.mock.method(axios, 'get', async (url) => {
    calls.push(url);
    throw new Error('a real network request escaped the test');
  });
  t.mock.method(axios, 'create', () => {
    throw new Error('a real axios client was constructed in a test');
  });
  return calls;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('isIndoorGame recognizes domes and closed roofs, and nothing else', () => {
  assert.equal(weather.isIndoorGame({ roof: 'dome' }), true);
  assert.equal(weather.isIndoorGame({ roof: 'closed' }), true);
  assert.equal(weather.isIndoorGame({ roof: 'Closed' }), true);
  assert.equal(weather.isIndoorGame({ roof: 'open' }), false);
  assert.equal(weather.isIndoorGame({ roof: 'outdoors' }), false);
  assert.equal(weather.isIndoorGame({ roof: null }), false, 'unknown roof is not "indoors"');
});

test('horizonBucket groups nearby lead times so a cache hit is possible', () => {
  assert.equal(weather.horizonBucket(1), 0);
  assert.equal(weather.horizonBucket(5.9), 0);
  assert.equal(weather.horizonBucket(7), 6);
  assert.equal(weather.horizonBucket(-3), 0, 'kickoff has passed');
  assert.equal(weather.horizonBucket(10000), weather.MAX_HORIZON_HOURS);
  assert.equal(weather.horizonBucket('nonsense'), null);
});

test('parseSpeedMph takes the upper bound of a range', () => {
  assert.equal(weather.parseSpeedMph('10 mph'), 10);
  assert.equal(weather.parseSpeedMph('10 to 18 mph'), 18);
  assert.equal(weather.parseSpeedMph(undefined), null);
  assert.equal(weather.parseSpeedMph('calm'), null);
});

test('selectPeriodNearestKickoff picks the closest hourly period', () => {
  const period = weather.selectPeriodNearestKickoff(hourlyPeriods(), new Date(KICKOFF));
  assert.equal(period.shortForecast, 'Windy');
});

test('normalizePeriod converts Celsius and keeps unknown fields null', () => {
  const normalized = weather.normalizePeriod({
    startTime: KICKOFF, temperature: 10, temperatureUnit: 'C', windSpeed: '8 mph', shortForecast: 'Cloudy',
  });
  assert.equal(normalized.temperatureF, 50);
  assert.equal(normalized.windGustMph, null);
  assert.equal(normalized.precipitationProbability, null);
});

// ---------------------------------------------------------------------------
// Provider behavior
// ---------------------------------------------------------------------------

test('a dome game never triggers an NWS request', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const result = await weather.getForecastsForGames({
    season: 2026,
    week: 6,
    games: [outdoorGame({ roof: 'dome', gameKey: '2026_06_DET_MIN' })],
    now: NOW,
    transport: recordingTransport(calls),
    client: stubClient(),
  });
  assert.deepEqual(calls, [], 'there is no weather under a roof, so there is no call to make');
  assert.equal(result.byGame.get('2026_06_DET_MIN').indoor, true);
  assert.equal(result.coverage.indoorGames, 1);
});

test('an outdoor game resolves the gridpoint then the period nearest kickoff', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const client = stubClient();
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6, games: [outdoorGame()], now: NOW,
    transport: recordingTransport(calls), client,
  });

  assert.equal(calls.length, 2, 'points lookup, then the hourly forecast it returns');
  assert.match(calls[0], /^https:\/\/api\.weather\.gov\/points\/42\.7738,-78\.7870$/);
  const forecast = result.byGame.get('2026_06_NYJ_BUF');
  assert.equal(forecast.shortForecast, 'Windy');
  assert.equal(forecast.temperatureF, 54);
  assert.equal(forecast.windGustMph, 30);
  assert.equal(forecast.precipitationProbability, 40);
  assert.equal(client.writes.length, 1, 'the snapshot is cached for the next reader');
  assert.equal(result.coverage.fetched, 1);
  assert.equal(result.coverage.saved, 1, 'saved counts the snapshot writes that succeeded');
});

test('a cached snapshot in the same horizon bucket prevents a duplicate request', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const bucket = weather.horizonBucket(48);
  const client = stubClient([{
    game_key: '2026_06_NYJ_BUF',
    horizon_hours: bucket,
    forecast_time: KICKOFF,
    temperature_f: '54.00',
    wind_speed_mph: '18.00',
    wind_gust_mph: '30.00',
    precipitation_probability: 40,
    short_forecast: 'Windy',
    fetched_at: NOW,
  }]);

  const result = await weather.getForecastsForGames({
    season: 2026, week: 6, games: [outdoorGame()], now: NOW,
    transport: recordingTransport(calls), client,
  });
  assert.deepEqual(calls, []);
  assert.equal(result.byGame.get('2026_06_NYJ_BUF').cached, true);
  assert.equal(result.byGame.get('2026_06_NYJ_BUF').windSpeedMph, 18);
  assert.equal(result.coverage.requests, 0);
});

// #1883: a kickoff past the forecast's reach used to clamp into bucket 168 and
// save the LAST hourly period NWS returned as that game's forecast, which the
// Decision card then showed as if it were real.
test('a kickoff beyond the forecast horizon makes no request and writes no row', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const client = stubClient();
  const result = await weather.getForecastsForGames({
    season: 2026,
    week: 17,
    games: [outdoorGame({ gameKey: '2026_17_PHI_SF', kickoffAt: '2027-01-04T01:20:00.000Z' })],
    now: NOW,
    transport: recordingTransport(calls),
    client,
  });

  assert.deepEqual(calls, []);
  assert.equal(client.writes.length, 0);
  assert.equal(result.byGame.get('2026_17_PHI_SF'), null);
  assert.equal(result.coverage.requests, 0);
});

test('a kickoff that has already passed makes no request and writes no row', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const client = stubClient();
  const result = await weather.getForecastsForGames({
    season: 2026,
    week: 6,
    games: [outdoorGame({ kickoffAt: '2026-10-09T16:59:59.000Z' })],
    now: NOW,
    transport: recordingTransport(calls),
    client,
  });

  assert.deepEqual(calls, []);
  assert.equal(client.writes.length, 0);
  assert.equal(result.byGame.get('2026_06_NYJ_BUF'), null);
});

test('a kickoff exactly MAX_HORIZON_HOURS away is still forecast', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const client = stubClient();
  const kickoffAt = new Date(NOW.getTime() + weather.MAX_HORIZON_HOURS * 3600000).toISOString();
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6, games: [outdoorGame({ kickoffAt })], now: NOW,
    transport: recordingTransport(calls), client,
  });

  assert.equal(calls.length, 2);
  assert.equal(client.writes.length, 1);
  assert.equal(client.writes[0].params[3], weather.MAX_HORIZON_HOURS);
  assert.ok(result.byGame.get('2026_06_NYJ_BUF'));
});

test('an unset NWS_USER_AGENT skips cleanly with no request and an honest reason', async (t) => {
  const previous = process.env.NWS_USER_AGENT;
  delete process.env.NWS_USER_AGENT;
  t.after(() => {
    if (previous !== undefined) process.env.NWS_USER_AGENT = previous;
  });
  forbidRealNetwork(t);
  const calls = [];

  const result = await weather.getForecastsForGames({
    season: 2026, week: 6, games: [outdoorGame()], now: NOW,
    transport: recordingTransport(calls), client: stubClient(),
  });
  assert.deepEqual(calls, []);
  assert.equal(result.byGame.get('2026_06_NYJ_BUF'), null);
  assert.equal(result.coverage.status, 'unavailable');
  assert.match(result.coverage.reason, /NWS_USER_AGENT/);
});

test('a timeout produces neutral weather rather than an error', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6, games: [outdoorGame()], now: NOW,
    transport: recordingTransport(calls, { failAfter: 0 }),
    client: stubClient(),
  });
  assert.equal(result.byGame.get('2026_06_NYJ_BUF'), null, 'no forecast, and no thrown error');
  assert.equal(result.coverage.status, 'unavailable');
});

test('an unknown venue reports unavailable and makes no request', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  // A venue string the table has never seen is honestly unavailable rather
  // than guessed from an invented coordinate.
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6,
    games: [outdoorGame({ venue: 'Some Future Stadium' }), outdoorGame({ gameKey: 'g2', venue: null })],
    now: NOW, transport: recordingTransport(calls), client: stubClient(),
  });
  assert.deepEqual(calls, []);
  assert.equal(result.coverage.status, 'unavailable');
  assert.match(result.coverage.reason, /coordinates/);
});

test('coordinates come from the venue table, never from nfl_games.latitude/longitude', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  // The row's own columns point at the middle of the Atlantic; the venue is Buffalo.
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6,
    games: [outdoorGame({ latitude: 0.5, longitude: 0.5 })],
    now: NOW, transport: recordingTransport(calls), client: stubClient(),
  });
  assert.match(calls[0], /\/points\/42\.7738,-78\.7870$/);
  assert.equal(result.byGame.get('2026_06_NYJ_BUF').shortForecast, 'Windy');

  const columnsOnly = await weather.getForecastsForGames({
    season: 2026, week: 6,
    games: [outdoorGame({ venue: null, latitude: 42.7738, longitude: -78.787 })],
    now: NOW, transport: recordingTransport([]), client: stubClient(),
  });
  assert.equal(columnsOnly.coverage.status, 'unavailable');
});

test('a shared venue, a non-US venue and an unknown venue in one week', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6,
    games: [
      // Same stadium, two different home teams: both resolve to SoFi.
      outdoorGame({ gameKey: '2026_06_LV_LAR', venue: 'SoFi Stadium' }),
      outdoorGame({ gameKey: '2026_06_KC_LAC', venue: 'SoFi Stadium' }),
      // Non-US: skipped without error, no request.
      outdoorGame({ gameKey: '2026_06_JAX_LAR', venue: 'Tottenham Hotspur Stadium' }),
      // Unknown string: skipped without error, no request.
      outdoorGame({ gameKey: '2026_06_XXX_YYY', venue: 'Not A Real Stadium' }),
    ],
    now: NOW, transport: recordingTransport(calls), client: stubClient(),
  });
  const pointCalls = calls.filter((url) => url.includes('/points/'));
  assert.equal(pointCalls.length, 2, 'only the two SoFi games are fetched');
  for (const url of pointCalls) assert.match(url, /\/points\/33\.9535,-118\.3392$/);
  assert.equal(result.byGame.get('2026_06_LV_LAR').shortForecast, 'Windy');
  assert.equal(result.byGame.get('2026_06_KC_LAC').shortForecast, 'Windy');
  assert.equal(result.byGame.get('2026_06_JAX_LAR'), null);
  assert.equal(result.byGame.get('2026_06_XXX_YYY'), null);
  assert.equal(result.coverage.status, 'available');
});

test('a snapshot cache failure still returns the forecast it fetched', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const calls = [];
  const brokenClient = {
    async query(sql) {
      if (String(sql).includes('SELECT')) throw new Error('cache read down');
      throw new Error('cache write down');
    },
  };
  const result = await weather.getForecastsForGames({
    season: 2026, week: 6, games: [outdoorGame()], now: NOW,
    transport: recordingTransport(calls), client: brokenClient,
  });
  assert.equal(result.byGame.get('2026_06_NYJ_BUF').shortForecast, 'Windy');
  assert.equal(result.coverage.fetched, 1);
  assert.equal(result.coverage.saved, 0, 'a failed write is fetched but not saved');
});

test('no games means no work and no request', async (t) => {
  withUserAgent(t);
  forbidRealNetwork(t);
  const result = await weather.getForecastsForGames({ season: 2026, week: 6, games: [], client: stubClient() });
  assert.equal(result.byGame.size, 0);
  assert.equal(result.coverage.status, 'unavailable');
});
