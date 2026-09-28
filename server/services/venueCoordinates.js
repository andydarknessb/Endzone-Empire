/**
 * Stadium coordinates keyed by VENUE, not by team (#1707).
 *
 * The key is the `venue` value nflverse's games.csv `stadium` column writes into
 * `nfl_games.venue`. Keying on the venue is what makes a shared stadium (SoFi:
 * Rams and Chargers; MetLife: Giants and Jets) resolve correctly: both teams'
 * games carry the same venue string, so both get the same point.
 *
 * `nfl_games.latitude` / `longitude` are nullable and never populated by the
 * sync, so the NWS weather job reads coordinates from here instead.
 *
 * Values are `{ latitude, longitude }` for a US venue (NWS covers the US only)
 * and `null` for an international or otherwise non-US venue, listed on purpose
 * so "no coverage" is distinguishable from "a venue we have not seen"
 * (`isKnownVenue`). Both come back from `coordinatesForVenue` as `null`: an
 * unknown venue must never produce a guessed point.
 *
 * Coordinates are the stadium's field, to four decimals (about 10 m), which is
 * finer than the NWS 2.5 km gridpoint they resolve to. Former sponsor names are
 * kept as aliases because nflverse back-fills historical rows under the name in
 * force at the time.
 */

const point = (latitude, longitude) => Object.freeze({ latitude, longitude });

const VENUE_TABLE = {
  // --- United States: the 30 stadiums hosting the 32 teams' 2026 home games ---
  'Mercedes-Benz Stadium': point(33.7554, -84.4009),
  'M&T Bank Stadium': point(39.2780, -76.6227),
  'Highmark Stadium': point(42.7738, -78.7870),
  'Bank of America Stadium': point(35.2258, -80.8528),
  'Soldier Field': point(41.8623, -87.6167),
  'Paycor Stadium': point(39.0955, -84.5161),
  'Huntington Bank Field': point(41.5061, -81.6995),
  'AT&T Stadium': point(32.7473, -97.0945),
  'Empower Field at Mile High': point(39.7439, -105.0201),
  'Ford Field': point(42.3400, -83.0456),
  'Lambeau Field': point(44.5013, -88.0622),
  'NRG Stadium': point(29.6847, -95.4107),
  'Lucas Oil Stadium': point(39.7601, -86.1639),
  'EverBank Stadium': point(30.3239, -81.6373),
  'GEHA Field at Arrowhead Stadium': point(39.0489, -94.4839),
  'Allegiant Stadium': point(36.0909, -115.1833),
  'SoFi Stadium': point(33.9535, -118.3392), // Rams + Chargers
  'Hard Rock Stadium': point(25.9580, -80.2389),
  'U.S. Bank Stadium': point(44.9735, -93.2575),
  'Gillette Stadium': point(42.0909, -71.2643),
  'Caesars Superdome': point(29.9511, -90.0812),
  'MetLife Stadium': point(40.8128, -74.0742), // Giants + Jets
  'Lincoln Financial Field': point(39.9008, -75.1675),
  'Acrisure Stadium': point(40.4468, -80.0158),
  "Levi's Stadium": point(37.4033, -121.9694),
  'Lumen Field': point(47.5952, -122.3316),
  'Raymond James Stadium': point(27.9759, -82.5033),
  'Nissan Stadium': point(36.1665, -86.7713),
  'Northwest Stadium': point(38.9076, -76.8645),
  'State Farm Stadium': point(33.5276, -112.2626),

  // --- United States: earlier names for the same fields (historical rows) ---
  // nflverse's 2026 games.csv still spells Houston's venue 'Reliant Stadium';
  // 'NRG Stadium' above is kept, both resolve to the same field.
  'Reliant Stadium': point(29.6847, -95.4107),
  'FirstEnergy Stadium': point(41.5061, -81.6995),
  'TIAA Bank Field': point(30.3239, -81.6373),
  'Arrowhead Stadium': point(39.0489, -94.4839),
  'Mercedes-Benz Superdome': point(29.9511, -90.0812),
  'FedExField': point(38.9076, -76.8645),
  'Broncos Stadium at Mile High': point(39.7439, -105.0201),
  'Empower Field': point(39.7439, -105.0201),

  // --- Outside the US: NWS has no coverage, so no coordinates by design ---
  'Tottenham Hotspur Stadium': null,
  'Wembley Stadium': null,
  'Twickenham Stadium': null,
  'Allianz Arena': null,
  'Deutsche Bank Park': null,
  'Santiago Bernabéu': null,
  'Estadio Azteca': null,
  'Estadio Banorte': null,
  'Arena Corinthians': null,
  'Maracanã Stadium': null,
  'Melbourne Cricket Ground': null,
  'Stade de France': null,
  'Rogers Centre': null,
  'Commonwealth Stadium': null,
};

const normalize = (venue) => String(venue).trim().toLowerCase();

// Built once: case- and whitespace-insensitive lookup over the table above.
const BY_KEY = new Map(
  Object.entries(VENUE_TABLE).map(([name, coordinates]) => [normalize(name), coordinates])
);

const isName = (venue) => typeof venue === 'string' && venue.trim() !== '';

/** Whether the venue string is in the table, US or not. */
function isKnownVenue(venue) {
  return isName(venue) && BY_KEY.has(normalize(venue));
}

/**
 * `{ latitude, longitude }` (frozen) for a US venue; `null` for a non-US venue,
 * an unknown string, or a missing value. Never throws.
 */
function coordinatesForVenue(venue) {
  if (!isName(venue)) return null;
  return BY_KEY.get(normalize(venue)) || null;
}

module.exports = { coordinatesForVenue, isKnownVenue };
