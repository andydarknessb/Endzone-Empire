import { initialsFor } from './initials';

test('takes the first letter of up to two words, uppercased', () => {
  expect(initialsFor('Alice Smith')).toBe('AS');
  expect(initialsFor('cher')).toBe('C');
});

test('ignores extra words beyond the first two', () => {
  expect(initialsFor('Sunday Ballers United')).toBe('SB');
});

test('collapses extra whitespace between words', () => {
  expect(initialsFor('  Alice   Smith  ')).toBe('AS');
});

test('falls back to "?" for empty/null/undefined names', () => {
  expect(initialsFor('')).toBe('?');
  expect(initialsFor(null)).toBe('?');
  expect(initialsFor(undefined)).toBe('?');
});
