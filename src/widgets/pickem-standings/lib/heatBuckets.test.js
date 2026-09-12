import { HEAT_WEEKS, heatBucket, heatStrip } from './heatBuckets';

describe('heatBucket', () => {
  test('null points (week not played) is null, never a bucket', () => {
    expect(heatBucket(null, 100)).toBeNull();
    expect(heatBucket(undefined, 100)).toBeNull();
  });

  test('boundary: exactly 25% of the best week is h1, one unit over is h2', () => {
    expect(heatBucket(25, 100)).toBe('h1');
    expect(heatBucket(25.01, 100)).toBe('h2');
  });

  test('boundary: exactly 50% of the best week is h2, one unit over is h3', () => {
    expect(heatBucket(50, 100)).toBe('h2');
    expect(heatBucket(50.01, 100)).toBe('h3');
  });

  test('boundary: exactly 75% of the best week is h3, one unit over is h4', () => {
    expect(heatBucket(75, 100)).toBe('h3');
    expect(heatBucket(75.01, 100)).toBe('h4');
  });

  test('boundary: the best week itself (100%) is h4', () => {
    expect(heatBucket(100, 100)).toBe('h4');
  });

  test('a value inside each bucket', () => {
    expect(heatBucket(10, 100)).toBe('h1');
    expect(heatBucket(40, 100)).toBe('h2');
    expect(heatBucket(60, 100)).toBe('h3');
    expect(heatBucket(90, 100)).toBe('h4');
  });

  test('zero points on a played week is the lowest bucket, not null', () => {
    expect(heatBucket(0, 100)).toBe('h1');
  });

  test('a best week of zero (every played week scored zero) never divides by zero', () => {
    expect(heatBucket(0, 0)).toBe('h1');
    expect(heatBucket(0, null)).toBe('h1');
  });
});

describe('heatStrip', () => {
  test('returns eighteen cells, one per week, in order', () => {
    const strip = heatStrip({ weekly: {}, bestWeek: null });
    expect(strip).toHaveLength(HEAT_WEEKS);
    expect(strip.map((cell) => cell.week)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  test('a week absent from the weekly map is not played: null points, null bucket, never best', () => {
    const strip = heatStrip({ weekly: { 1: 10 }, bestWeek: { week: 1, points: 10 } });
    const week2 = strip.find((cell) => cell.week === 2);
    expect(week2.points).toBeNull();
    expect(week2.bucket).toBeNull();
    expect(week2.isBest).toBe(false);
  });

  test('marks the bestWeek cell as best and buckets it h4', () => {
    const strip = heatStrip({ weekly: { 1: 3, 2: 9, 3: 5 }, bestWeek: { week: 2, points: 9 } });
    const best = strip.find((cell) => cell.week === 2);
    expect(best.isBest).toBe(true);
    expect(best.bucket).toBe('h4');
    expect(strip.find((cell) => cell.week === 1).isBest).toBe(false);
  });

  test('a team with no weekly data at all renders eighteen not-played cells', () => {
    const strip = heatStrip({ weekly: null, bestWeek: null });
    expect(strip.every((cell) => cell.points === null && cell.bucket === null)).toBe(true);
  });

  test('a missing row (undefined) renders eighteen not-played cells rather than throwing', () => {
    expect(() => heatStrip(undefined)).not.toThrow();
    const strip = heatStrip(undefined);
    expect(strip.every((cell) => cell.points === null)).toBe(true);
  });
});
