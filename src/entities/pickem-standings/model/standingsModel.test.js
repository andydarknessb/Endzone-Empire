import { accuracy, bestWeek, standingsModel, trend } from './standingsModel';

describe('accuracy', () => {
  test('correct / (correct + incorrect)', () => {
    expect(accuracy({ correct: 9, incorrect: 4, pending: 2 })).toBeCloseTo(9 / 13);
  });

  // A tied game credits nobody (CONTEXT.md), so it must never inflate the
  // denominator the way an incorrect pick would.
  test('tie handling: tied and pending games are excluded from the ratio, not counted as incorrect', () => {
    // Same correct/incorrect as above; more pushes/pending should not move it.
    expect(accuracy({ correct: 9, incorrect: 4, pending: 5 })).toBeCloseTo(9 / 13);
  });

  test('no decided games yet reads as null, never NaN or zero', () => {
    expect(accuracy({ correct: 0, incorrect: 0, pending: 3 })).toBeNull();
  });

  test('a perfect and a winless record both compute cleanly', () => {
    expect(accuracy({ correct: 5, incorrect: 0 })).toBe(1);
    expect(accuracy({ correct: 0, incorrect: 5 })).toBe(0);
  });
});

describe('bestWeek', () => {
  test('the week with the most points', () => {
    expect(bestWeek({ 1: 3, 2: 9, 3: 5 })).toEqual({ week: 2, points: 9 });
  });

  test('a tie between two weeks favors the earlier one', () => {
    expect(bestWeek({ 3: 7, 1: 7, 2: 4 })).toEqual({ week: 1, points: 7 });
  });

  test('no weekly data reads as null', () => {
    expect(bestWeek(null)).toBeNull();
    expect(bestWeek({})).toBeNull();
  });
});

describe('trend', () => {
  test('a smaller rank than before is up', () => {
    expect(trend(1, 3)).toBe('up');
  });

  test('a larger rank than before is down', () => {
    expect(trend(5, 2)).toBe('down');
  });

  test('the same rank as before is flat', () => {
    expect(trend(4, 4)).toBe('flat');
  });

  test('no previous rank (or no current rank) is null', () => {
    expect(trend(1, null)).toBeNull();
    expect(trend(null, 1)).toBeNull();
  });
});

describe('standingsModel', () => {
  test('marks rows sharing a rank as tied and leaves a unique rank untied', () => {
    const rows = [
      { teamId: 1, rank: 1, correct: 5, incorrect: 1, previousRank: 2 },
      { teamId: 2, rank: 1, correct: 5, incorrect: 1, previousRank: 1 },
      { teamId: 3, rank: 3, correct: 2, incorrect: 4, previousRank: 3 },
    ];
    const [first, second, third] = standingsModel(rows);
    expect(first.tied).toBe(true);
    expect(second.tied).toBe(true);
    expect(third.tied).toBe(false);
  });

  test('augments every row with accuracy, bestWeek and trend without losing its own fields', () => {
    const rows = [
      { teamId: 1, teamName: 'Anvils', rank: 1, previousRank: 2, correct: 4, incorrect: 1, weekly: { 1: 3, 2: 8 } },
    ];
    const [row] = standingsModel(rows);
    expect(row.teamName).toBe('Anvils');
    expect(row.accuracy).toBeCloseTo(4 / 5);
    expect(row.bestWeek).toEqual({ week: 2, points: 8 });
    expect(row.trend).toBe('up');
  });

  test('an empty list stays empty', () => {
    expect(standingsModel([])).toEqual([]);
    expect(standingsModel(undefined)).toEqual([]);
  });
});
