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
 * This read is independent of `entities/player/model/lineModel`'s own Weather
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
 * One Record string per side, in the canvas shape (docs/design/pickem/
 * GameCard.dc.html): the total first, then the cut each team is about to play
 * in (road for the visitor, home for the host), "6-1 · home 4-0". The cut is
 * the part that informs a pick (CONTEXT.md, Record); the total is what a
 * manager reads as the team's record, and #1488 is what printing the cut
 * alone looked like in week 2: a 1-0 team that opened on the road showed
 * "0-0". A neutral-site game drops the split and keeps the total; a missing
 * cut leaves the total alone; a missing total leaves the labelled cut alone.
 */
function recordText(side, cutLabel, neutral) {
  if (side == null) return null;
  const total = side.total ?? null;
  const cut = neutral ? null : (side[cutLabel] ?? null);
  if (total != null && cut != null) return `${total} · ${cutLabel} ${cut}`;
  if (total != null) return total;
  if (cut != null) return `${cutLabel} ${cut}`;
  return null;
}

export function recordsDisplayModel(records, venue) {
  if (!records) return null;
  const neutral = Boolean(venue && venue.neutralSite);
  return {
    home: recordText(records.home, 'home', neutral),
    away: recordText(records.away, 'road', neutral),
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
