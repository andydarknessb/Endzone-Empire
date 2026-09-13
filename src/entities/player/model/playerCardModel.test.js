import { playerCardFromResponse } from './playerCardModel';

test('passes a real payload through unchanged', () => {
  const payload = { player: { id: 1, name: 'Josh Allen' }, decision: { upgrade: null } };
  expect(playerCardFromResponse(payload)).toBe(payload);
});

test('a null or undefined response reads as null, never a fabricated object', () => {
  expect(playerCardFromResponse(null)).toBeNull();
  expect(playerCardFromResponse(undefined)).toBeNull();
});
