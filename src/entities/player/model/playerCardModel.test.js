import { playerCardFromResponse, playerCardUrl } from './playerCardModel';

test('passes a real payload through unchanged', () => {
  const payload = { player: { id: 1, name: 'Josh Allen' }, decision: { upgrade: null } };
  expect(playerCardFromResponse(payload)).toBe(payload);
});

test('a null or undefined response reads as null, never a fabricated object', () => {
  expect(playerCardFromResponse(null)).toBeNull();
  expect(playerCardFromResponse(undefined)).toBeNull();
});

test('playerCardUrl omits week when not given', () => {
  expect(playerCardUrl({ leagueId: 1, playerId: 7 })).toBe('/api/players/7/card?leagueId=1');
  expect(playerCardUrl({ leagueId: 1, playerId: 7, week: null })).toBe('/api/players/7/card?leagueId=1');
});

test('playerCardUrl appends week when given', () => {
  expect(playerCardUrl({ leagueId: 1, playerId: 7, week: 4 })).toBe(
    '/api/players/7/card?leagueId=1&week=4',
  );
});
