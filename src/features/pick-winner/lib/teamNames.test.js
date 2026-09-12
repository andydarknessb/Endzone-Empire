import { getTeamName } from './teamNames';

test('resolves a known Team code to its full name', () => {
  expect(getTeamName('DET')).toBe('Detroit Lions');
});

test('is case-insensitive', () => {
  expect(getTeamName('det')).toBe('Detroit Lions');
});

test('falls back to the bare code for an unrecognized one', () => {
  expect(getTeamName('ZZZ')).toBe('ZZZ');
});

test('a missing code reads as an empty string, never "undefined"', () => {
  expect(getTeamName(null)).toBe('');
  expect(getTeamName(undefined)).toBe('');
});
