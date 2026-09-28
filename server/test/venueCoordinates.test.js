const test = require('node:test');
const assert = require('node:assert/strict');
const venues = require('../services/venueCoordinates');

// The 30 stadiums that host the 32 teams' 2026 home games, spelled the way
// nflverse's games.csv `stadium` column spells them (what nfl_games.venue holds).
const US_VENUES_2026 = [
  'Mercedes-Benz Stadium', 'M&T Bank Stadium', 'Highmark Stadium', 'Bank of America Stadium',
  'Soldier Field', 'Paycor Stadium', 'Huntington Bank Field', 'AT&T Stadium',
  'Empower Field at Mile High', 'Ford Field', 'Lambeau Field', 'NRG Stadium',
  'Lucas Oil Stadium', 'EverBank Stadium', 'GEHA Field at Arrowhead Stadium',
  'Allegiant Stadium', 'SoFi Stadium', 'Hard Rock Stadium', 'U.S. Bank Stadium',
  'Gillette Stadium', 'Caesars Superdome', 'MetLife Stadium', 'Lincoln Financial Field',
  'Acrisure Stadium', "Levi's Stadium", 'Lumen Field', 'Raymond James Stadium',
  'Nissan Stadium', 'Northwest Stadium', 'State Farm Stadium',
];

test('every 2026 US venue resolves to a coordinate inside the contiguous US', () => {
  assert.equal(US_VENUES_2026.length, 30);
  for (const venue of US_VENUES_2026) {
    const point = venues.coordinatesForVenue(venue);
    assert.ok(point, `${venue} has no coordinates`);
    assert.ok(point.latitude > 24 && point.latitude < 50, `${venue} latitude ${point.latitude}`);
    assert.ok(point.longitude > -125 && point.longitude < -66, `${venue} longitude ${point.longitude}`);
  }
});

test('a shared venue resolves to one point whichever team is at home', () => {
  const sofi = venues.coordinatesForVenue('SoFi Stadium');
  const metlife = venues.coordinatesForVenue('MetLife Stadium');
  assert.ok(sofi && metlife);
  // The key is the venue, so the lookup takes no team and cannot disagree with itself.
  assert.deepEqual(venues.coordinatesForVenue('SoFi Stadium'), sofi);
  assert.equal(venues.coordinatesForVenue.length, 1);
});

test("'Reliant Stadium' (nflverse's 2026 Houston spelling) resolves to NRG Stadium's coordinates", () => {
  const nrg = venues.coordinatesForVenue('NRG Stadium');
  assert.ok(nrg);
  assert.deepEqual(venues.coordinatesForVenue('Reliant Stadium'), nrg);
});

test('non-US venues resolve to null: NWS has no coverage there', () => {
  for (const venue of [
    'Tottenham Hotspur Stadium', 'Wembley Stadium', 'Allianz Arena', 'Deutsche Bank Park',
    'Estadio Azteca', 'Santiago Bernabéu', 'Melbourne Cricket Ground',
  ]) {
    assert.equal(venues.coordinatesForVenue(venue), null, venue);
    assert.ok(venues.isKnownVenue(venue), `${venue} is deliberately listed, not merely unknown`);
  }
});

test('an unknown, blank or missing venue resolves to null and never throws', () => {
  assert.equal(venues.coordinatesForVenue('Some Future Dome'), null);
  assert.equal(venues.isKnownVenue('Some Future Dome'), false);
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(venues.coordinatesForVenue(bad), null);
  }
});

test('lookup ignores case and surrounding whitespace', () => {
  assert.deepEqual(
    venues.coordinatesForVenue('  soldier field '),
    venues.coordinatesForVenue('Soldier Field')
  );
});

test('a returned coordinate cannot be mutated into the table', () => {
  const point = venues.coordinatesForVenue('Lambeau Field');
  assert.throws(() => { 'use strict'; point.latitude = 0; }, TypeError);
  assert.notEqual(venues.coordinatesForVenue('Lambeau Field').latitude, 0);
});
