import { allWeekSettled } from './allWeekSettled';

const m = (week, over = {}) => ({ week, final: false, status: 'scheduled', ...over });

// The server marks a finished game 'played' until the commissioner advances; only advancing writes 'final'.
test('true when every matchup of the week is played or final', () => {
  expect(allWeekSettled([m(4, { status: 'played' }), m(4, { status: 'played' })], 4)).toBe(true);
  expect(allWeekSettled([m(4, { final: true }), m(4, { status: 'final' }), m(4, { status: 'played' })], 4)).toBe(true);
});

test('a live, scheduled or unknown-status matchup keeps the week open', () => {
  expect(allWeekSettled([m(4, { status: 'played' }), m(4, { status: 'live' })], 4)).toBe(false);
  expect(allWeekSettled([m(4, { status: 'played' }), m(4, { status: 'scheduled' })], 4)).toBe(false);
  expect(allWeekSettled([m(4, { status: 'played' }), m(4, { status: null })], 4)).toBe(false);
});

test('no matchups for the week is not settled', () => {
  expect(allWeekSettled([], 4)).toBe(false);
  expect(allWeekSettled(null, 4)).toBe(false);
  expect(allWeekSettled([m(5, { final: true })], 4)).toBe(false);
});

test('other weeks are ignored, and week compares as a number', () => {
  expect(allWeekSettled([m(4, { final: true }), m(5)], '4')).toBe(true);
});
