const axios = require('axios');
const pool = require('../modules/pool');

/**
 * Free game-day weather context from the US National Weather Service.
 *
 * https://www.weather.gov/documentation/services-web-api — no API key, no
 * account, no quota to meter. The only requirement the service actually
 * enforces is a User-Agent identifying the caller, which is why
 * `NWS_USER_AGENT` is REQUIRED rather than defaulted: a made-up contact string
 * would be both a lie and a good way to get the app blocked. With the variable
 * unset this module reports every game as "weather unavailable" and does not
 * make a single request.
 *
 * Four rules this module exists to guarantee:
 *
 * 1. **Server-side only.** Nothing here is reachable from the client bundle.
 * 2. **Fail open, always.** A timeout, a 500, a shape change, a missing
 *    stadium coordinate — every failure path returns `null` for that game.
 *    Lineup advice must never be blocked, delayed past a short timeout, or
 *    errored out because a forecast was unavailable.
 * 3. **No request for a dome or a closed roof.** There is no weather to
 *    report, so there is no call to make.
 * 4. **Cached per game and forecast horizon.** Two lineup views an hour apart
 *    reuse one forecast; a forecast pulled five days out does not overwrite
 *    the one pulled near kickoff.
 *
 * Coordinates come from `nfl_games.latitude/longitude`, which are nullable and
 * currently unpopulated: no authoritative stadium-coordinate source is wired
 * into this app, and inventing coordinates would produce a confident forecast
 * for the wrong place. Until a verified source is added, this module is a
 * fully-built, fully-tested provider boundary that honestly reports
 * "unavailable" — which is exactly what the UI renders.
 */

// Roof values (nflverse vocabulary) that mean "no weather at field level".
const CLOSED_ROOF_VALUES = new Set(['dome', 'closed', 'retractable_closed']);

const REQUEST_TIMEOUT_MS = 3500;
// Forecast lead time is bucketed so a cache hit is possible at all: without
// buckets every request would be a different horizon and never reuse a row.
const HORIZON_BUCKET_HOURS = 6;
const MAX_HORIZON_HOURS = 168; // NWS hourly forecasts run about a week out.

/**
 * "Is this a real coordinate?" — deliberately not `Number.isFinite(Number(v))`,
 * because `Number(null)` is 0 and 0,0 is a valid-looking point in the Gulf of
 * Guinea. A missing stadium coordinate must read as missing, not as a forecast
 * for the middle of the Atlantic.
 */
function isRealNumber(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

/** Pure: is this game played under a roof (so weather cannot matter)? */
function isIndoorGame(game) {
  const roof = game && game.roof ? String(game.roof).toLowerCase().trim() : null;
  if (!roof) return false;
  return CLOSED_ROOF_VALUES.has(roof);
}

/** Pure: the cache bucket for a kickoff `hoursAway` in the future. */
function horizonBucket(hoursAway) {
  const hours = Number(hoursAway);
  if (!Number.isFinite(hours)) return null;
  const clamped = Math.max(0, Math.min(MAX_HORIZON_HOURS, hours));
  return Math.floor(clamped / HORIZON_BUCKET_HOURS) * HORIZON_BUCKET_HOURS;
}

/** The configured User-Agent, or null when the operator has not set one. */
function userAgent() {
  const value = process.env.NWS_USER_AGENT;
  return value && String(value).trim() ? String(value).trim() : null;
}

/**
 * Pure: pick the hourly forecast period nearest kickoff. NWS returns periods
 * as `{ startTime, endTime, temperature, temperatureUnit, windSpeed,
 * windGust, probabilityOfPrecipitation: { value }, shortForecast }`. Ties go
 * to the earlier period, which keeps the choice deterministic.
 */
function selectPeriodNearestKickoff(periods, kickoffAt) {
  const target = kickoffAt instanceof Date ? kickoffAt.getTime() : new Date(kickoffAt).getTime();
  if (!Number.isFinite(target)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const period of Array.isArray(periods) ? periods : []) {
    const start = new Date(period && period.startTime).getTime();
    if (!Number.isFinite(start)) continue;
    const distance = Math.abs(start - target);
    if (distance < bestDistance) {
      best = period;
      bestDistance = distance;
    }
  }
  return best;
}

/** Pure: '10 mph' / '5 to 15 mph' -> 15 (the upper bound; null when unparseable). */
function parseSpeedMph(value) {
  const matches = String(value ?? '').match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  return Math.max(...matches.map(Number));
}

/** Pure: an NWS hourly period -> our compact snapshot shape. */
function normalizePeriod(period) {
  if (!period) return null;
  const unit = String(period.temperatureUnit || 'F').toUpperCase();
  const rawTemp = Number(period.temperature);
  const temperatureF = Number.isFinite(rawTemp)
    ? (unit === 'C' ? Math.round((rawTemp * 9) / 5 + 32) : rawTemp)
    : null;
  const precip = period.probabilityOfPrecipitation && period.probabilityOfPrecipitation.value;
  return {
    forecastTime: period.startTime || null,
    temperatureF,
    windSpeedMph: parseSpeedMph(period.windSpeed),
    windGustMph: parseSpeedMph(period.windGust),
    precipitationProbability: Number.isFinite(Number(precip)) ? Number(precip) : null,
    shortForecast: period.shortForecast ? String(period.shortForecast).slice(0, 120) : null,
  };
}

function httpClient(transport) {
  if (transport) return transport;
  return axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'User-Agent': userAgent(), Accept: 'application/geo+json' },
  });
}

/**
 * One game's forecast, live from NWS. Two hops, exactly as the API is
 * designed: /points resolves a coordinate to its gridpoint and hands back the
 * hourly-forecast URL, which is then fetched and searched for the period
 * nearest kickoff. Returns null on any failure.
 */
async function fetchForecast({ latitude, longitude, kickoffAt, transport }) {
  const client = httpClient(transport);
  const points = await client.get(
    `https://api.weather.gov/points/${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`
  );
  const hourlyUrl = points && points.data && points.data.properties
    && points.data.properties.forecastHourly;
  if (!hourlyUrl) return null;
  const forecast = await client.get(String(hourlyUrl));
  const periods = forecast && forecast.data && forecast.data.properties
    && forecast.data.properties.periods;
  return normalizePeriod(selectPeriodNearestKickoff(periods, kickoffAt));
}

/** Cached snapshots for this week, keyed `${game_key}:${horizon_hours}`. */
async function loadSnapshots({ season, week, client = pool }) {
  const result = await client.query(
    `SELECT "game_key", "horizon_hours", "forecast_time", "temperature_f", "wind_speed_mph",
            "wind_gust_mph", "precipitation_probability", "short_forecast", "fetched_at"
     FROM "game_weather_snapshots" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const byKey = new Map();
  for (const row of result.rows) {
    byKey.set(`${row.game_key}:${row.horizon_hours}`, {
      forecastTime: row.forecast_time,
      temperatureF: row.temperature_f == null ? null : Number(row.temperature_f),
      windSpeedMph: row.wind_speed_mph == null ? null : Number(row.wind_speed_mph),
      windGustMph: row.wind_gust_mph == null ? null : Number(row.wind_gust_mph),
      precipitationProbability: row.precipitation_probability == null
        ? null
        : Number(row.precipitation_probability),
      shortForecast: row.short_forecast || null,
      fetchedAt: row.fetched_at,
      cached: true,
    });
  }
  return byKey;
}

async function saveSnapshot({ season, week, gameKey, horizonHours, forecast, client = pool }) {
  await client.query(
    `INSERT INTO "game_weather_snapshots"
       ("season", "week", "game_key", "horizon_hours", "fetched_at", "forecast_time",
        "temperature_f", "wind_speed_mph", "wind_gust_mph", "precipitation_probability", "short_forecast")
     VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10)
     ON CONFLICT ("game_key", "horizon_hours")
     DO UPDATE SET "fetched_at" = now(), "forecast_time" = EXCLUDED."forecast_time",
                   "temperature_f" = EXCLUDED."temperature_f",
                   "wind_speed_mph" = EXCLUDED."wind_speed_mph",
                   "wind_gust_mph" = EXCLUDED."wind_gust_mph",
                   "precipitation_probability" = EXCLUDED."precipitation_probability",
                   "short_forecast" = EXCLUDED."short_forecast",
                   "updated_at" = now()`,
    [
      season, week, gameKey, horizonHours, forecast.forecastTime, forecast.temperatureF,
      forecast.windSpeedMph, forecast.windGustMph, forecast.precipitationProbability,
      forecast.shortForecast,
    ]
  );
}

/**
 * Forecasts for a week's games, as Map<gameKey, forecast|null>, plus a
 * coverage descriptor explaining WHY anything is missing. Never throws and
 * never rejects: the worst case is a map of nulls and
 * `{ status: 'unavailable' }`.
 *
 * `games` are the distinct games (one entry per game_key, not per team) with
 * `{ gameKey, kickoffAt, roof, latitude, longitude }`.
 */
async function getForecastsForGames({
  season,
  week,
  games = [],
  now = new Date(),
  transport = null,
  client = pool,
}) {
  const byGame = new Map();
  const distinct = [];
  const seen = new Set();
  for (const game of games || []) {
    if (!game || !game.gameKey || seen.has(game.gameKey)) continue;
    seen.add(game.gameKey);
    distinct.push(game);
    byGame.set(game.gameKey, null);
  }
  if (distinct.length === 0) {
    return { byGame, coverage: { status: 'unavailable', reason: 'no games' } };
  }

  if (!userAgent()) {
    // Not an error state — an unconfigured optional integration. Say so
    // plainly so an operator can see why weather is missing.
    return {
      byGame,
      coverage: { status: 'unavailable', reason: 'NWS_USER_AGENT not configured', requests: 0 },
    };
  }

  const outdoor = distinct.filter((game) => !isIndoorGame(game));
  const indoorCount = distinct.length - outdoor.length;
  const locatable = outdoor.filter((game) => isRealNumber(game.latitude) && isRealNumber(game.longitude));
  for (const game of distinct) {
    if (isIndoorGame(game)) {
      byGame.set(game.gameKey, {
        indoor: true,
        roof: game.roof || null,
        shortForecast: null,
        forecastTime: null,
        temperatureF: null,
        windSpeedMph: null,
        windGustMph: null,
        precipitationProbability: null,
      });
    }
  }
  if (locatable.length === 0) {
    return {
      byGame,
      coverage: {
        status: 'unavailable',
        reason: 'no verified stadium coordinates',
        indoorGames: indoorCount,
        requests: 0,
      },
    };
  }

  let snapshots = new Map();
  try {
    snapshots = await loadSnapshots({ season, week, client });
  } catch (err) {
    console.error('weather: snapshot cache read failed:', err.message);
  }

  let requests = 0;
  let fetched = 0;
  for (const game of locatable) {
    const hoursAway = (new Date(game.kickoffAt).getTime() - new Date(now).getTime()) / 3600000;
    const bucket = horizonBucket(hoursAway);
    if (bucket == null) continue;
    const cached = snapshots.get(`${game.gameKey}:${bucket}`);
    if (cached) {
      byGame.set(game.gameKey, { ...cached, indoor: false, roof: game.roof || null });
      continue;
    }
    try {
      requests += 1;
      const forecast = await fetchForecast({
        latitude: game.latitude,
        longitude: game.longitude,
        kickoffAt: game.kickoffAt,
        transport,
      });
      if (!forecast) continue;
      byGame.set(game.gameKey, { ...forecast, indoor: false, roof: game.roof || null, cached: false });
      fetched += 1;
      try {
        await saveSnapshot({
          season, week, gameKey: game.gameKey, horizonHours: bucket, forecast, client,
        });
      } catch (err) {
        // A cache write failure must not lose the forecast we already have.
        console.error('weather: snapshot write failed for %s:', game.gameKey, err.message);
      }
    } catch (err) {
      // Timeout, non-200, or a shape we do not recognize: this game simply has
      // no weather context. Never log the provider's full response body.
      console.error('weather: NWS lookup failed for %s:', game.gameKey, err.message);
    }
  }

  return {
    byGame,
    coverage: {
      status: fetched > 0 || [...byGame.values()].some(Boolean) ? 'available' : 'unavailable',
      indoorGames: indoorCount,
      requests,
      fetched,
    },
  };
}

module.exports = {
  CLOSED_ROOF_VALUES,
  HORIZON_BUCKET_HOURS,
  MAX_HORIZON_HOURS,
  REQUEST_TIMEOUT_MS,
  isIndoorGame,
  horizonBucket,
  userAgent,
  selectPeriodNearestKickoff,
  parseSpeedMph,
  normalizePeriod,
  fetchForecast,
  loadSnapshots,
  saveSnapshot,
  getForecastsForGames,
};
