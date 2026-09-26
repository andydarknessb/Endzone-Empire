import { weeksForSparkline } from './weeksAdapter';

test('maps a points week to a projected bar', () => {
  expect(weeksForSparkline([{ week: 3, points: 12.8 }])).toEqual([
    { week: 3, kind: 'projected', points: 12.8 },
  ]);
});

test('maps reason "bye" to a bye bar', () => {
  expect(weeksForSparkline([{ week: 9, reason: 'bye' }])).toEqual([{ week: 9, kind: 'bye' }]);
});

test('maps any other reason to an unavailable bar carrying the reason', () => {
  expect(weeksForSparkline([{ week: 3, reason: 'ir' }])).toEqual([
    { week: 3, kind: 'unavailable', reason: 'ir' },
  ]);
  expect(weeksForSparkline([{ week: 3, reason: 'out' }])).toEqual([
    { week: 3, kind: 'unavailable', reason: 'out' },
  ]);
});

test('null/empty input renders no bars', () => {
  expect(weeksForSparkline(null)).toEqual([]);
  expect(weeksForSparkline([])).toEqual([]);
});
