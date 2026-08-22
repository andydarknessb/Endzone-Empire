import {
  LEAGUE_TYPE, FANTASY_MAX_TEAMS, PICKEM_MAX_TEAMS, MIN_TEAMS, isPickemOnly, leagueTypeOf,
} from './leagueType';
import sizeFixture from './leagueSize.fixture.json';

// leagueTypeOf is the one normaliser for both wire dialects: the raw
// leagues row (snake_case pickem_only) and the Discover projection
// (camelCase pickemOnly). It never returns "both" - that is a create-form
// value only, never inferred from a stored row.
test.each([
  ['snake_case pickem_only: true', { pickem_only: true }, LEAGUE_TYPE.PICKEM],
  ['snake_case pickem_only: false', { pickem_only: false }, LEAGUE_TYPE.FANTASY],
  ['camelCase pickemOnly: true (Discover projection)', { pickemOnly: true }, LEAGUE_TYPE.PICKEM],
  ['camelCase pickemOnly: false (Discover projection)', { pickemOnly: false }, LEAGUE_TYPE.FANTASY],
  ['a fantasy row with pickemEnabled never reads as "both"', { pickem_only: false, pickemEnabled: true }, LEAGUE_TYPE.FANTASY],
  ['a row with neither key reads as fantasy (today\'s falsy read)', {}, LEAGUE_TYPE.FANTASY],
])('%s', (_name, row, expected) => {
  expect(leagueTypeOf(row)).toBe(expected);
});

test('a missing row is null, not a type', () => {
  expect(leagueTypeOf(null)).toBeNull();
  expect(leagueTypeOf(undefined)).toBeNull();
});

// isPickemOnly is null-tolerant so the fantasy route guard fails open exactly
// as it does today: an unknown row is never treated as pick'em-only.
test.each([
  ['snake_case pickem_only: true', { pickem_only: true }, true],
  ['camelCase pickemOnly: true', { pickemOnly: true }, true],
  ['pickem_only: false', { pickem_only: false }, false],
  ['a fantasy row with pickemEnabled is not pick\'em-only', { pickemEnabled: true }, false],
  ['a missing row is not pick\'em-only (fails open)', null, false],
  ['undefined is not pick\'em-only (fails open)', undefined, false],
])('isPickemOnly: %s', (_name, row, expected) => {
  expect(isPickemOnly(row)).toBe(expected);
});

// Team caps are pinned to the server by this shared fixture (parity test on
// server/test/leagueSize.test.js), not by a hand-maintained mirror comment.
test('team caps equal the shared server-parity fixture', () => {
  expect(MIN_TEAMS).toBe(sizeFixture.minTeams);
  expect(FANTASY_MAX_TEAMS).toBe(sizeFixture.fantasyMaxTeams);
  expect(PICKEM_MAX_TEAMS).toBe(sizeFixture.pickemMaxTeams);
});
