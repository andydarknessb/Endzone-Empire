/**
 * The Pickem game detail model (ADR 0029, entities/pickem-game): derives the
 * glossary's Line, Weather and Record for one game from the week endpoint's
 * per-game detail fields (ADR 0038, #1263). Venue, Broadcast, Situation and
 * the final extras (Linescore, Headline) pass through unchanged - they are
 * already the shape the glossary defines, written by the hourly game-context
 * job or the thirty-second poll.
 */

const WIND_DISPLAY_THRESHOLD_MPH = 15;
const PRECIP_DISPLAY_THRESHOLD_PERCENT = 30;

/**
 * The favorite is derived from the spread's sign at read time (ADR 0038): a
 * negative spread favors the home team (every sportsbook's own convention),
 * a positive spread favors the away team, and a pick'em (a spread of exactly
 * zero) or no Line at all has no favorite.
 */
export function favoriteFromLine(line, homeTeam, awayTeam) {
  if (!line || line.spread == null || line.spread === 0) return null;
  return line.spread < 0 ? homeTeam : awayTeam;
}

/**
 * Wind and precipitation chance are hidden below the glossary's Pick'em-only
 * display thresholds (CONTEXT.md, Weather: 15 mph / 30%); an indoor game has
 * no weather at all, which the server already models as a null `weather`, so
 * this returns null right through.
 *
 * This read is independent of `entities/line/model/lineModel`'s own Weather
 * read (CONTEXT.md, Weather; #1294, ADR 0038 amendment) — the two mirror
 * different server contracts and are not unified here.
 */
export function weatherDisplayModel(weather) {
  if (!weather) return null;
  return {
    shortForecast: weather.shortForecast ?? null,
    temperatureF: weather.temperatureF ?? null,
    windSpeedMph:
      weather.windSpeedMph != null && weather.windSpeedMph >= WIND_DISPLAY_THRESHOLD_MPH
        ? weather.windSpeedMph
        : null,
    precipitationProbability:
      weather.precipitationProbability != null &&
      weather.precipitationProbability >= PRECIP_DISPLAY_THRESHOLD_PERCENT
        ? weather.precipitationProbability
        : null,
  };
}

/**
 * The cut that informs a pick is the one each team is about to play in (road
 * for the visitor, home for the host); a neutral-site game drops the split
 * and keeps the total (CONTEXT.md, Record).
 */
export function recordsDisplayModel(records, venue) {
  if (!records) return null;
  const neutral = Boolean(venue && venue.neutralSite);
  return {
    home: records.home == null ? null : (neutral ? records.home.total : records.home.home) ?? null,
    away: records.away == null ? null : (neutral ? records.away.total : records.away.road) ?? null,
  };
}

/**
 * `game` is one entry of the week endpoint's `games` array, carrying the
 * optional detail fields (each absent when its source has nothing, ADR 0038).
 */
export function gameDetailModel(game) {
  return {
    favorite: favoriteFromLine(game.line, game.homeTeam, game.awayTeam),
    line: game.line ?? null,
    weather: weatherDisplayModel(game.weather),
    venue: game.venue ?? null,
    broadcast: game.broadcast ?? null,
    records: recordsDisplayModel(game.records, game.venue),
    situation: game.situation ?? null,
    linescores: game.linescores ?? null,
    headline: game.headline ?? null,
  };
}
