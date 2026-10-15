import { allWeekFinal } from './allWeekFinal';

const m = (week, over = {}) => ({ week, final: false, status: 'scheduled', ...over });

test('true only when every matchup of the week is final', () => {
  expect(allWeekFinal([m(4, { final: true }), m(4, { status: 'final' })], 4)).toBe(true);
  expect(allWeekFinal([m(4, { final: true }), m(4, { status: 'played' })], 4)).toBe(false);
  expect(allWeekFinal([m(4, { final: true }), m(4, { status: 'live' })], 4)).toBe(false);
});

test('no matchups for the week is not final', () => {
  expect(allWeekFinal([], 4)).toBe(false);
  expect(allWeekFinal(null, 4)).toBe(false);
  expect(allWeekFinal([m(5, { final: true })], 4)).toBe(false);
});

test('other weeks are ignored, and week compares as a number', () => {
  expect(allWeekFinal([m(4, { final: true }), m(5)], '4')).toBe(true);
});
