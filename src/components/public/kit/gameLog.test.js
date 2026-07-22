import { sortGamesByWeek } from './gameLog';

test('orders newest-first API rows into oldest-to-newest render order', () => {
  const apiOrder = [
    { season: 2026, week: 3, fantasyPoints: 20 },
    { season: 2026, week: 2, fantasyPoints: 18 },
    { season: 2026, week: 1, fantasyPoints: 25 },
  ];
  expect(sortGamesByWeek(apiOrder).map((g) => g.week)).toEqual([1, 2, 3]);
});

test('handles non-contiguous weeks (week 1 and 3, no week 2)', () => {
  const games = [
    { season: 2026, week: 3, fantasyPoints: 20 },
    { season: 2026, week: 1, fantasyPoints: 25 },
  ];
  expect(sortGamesByWeek(games).map((g) => g.week)).toEqual([1, 3]);
});

test('does not mutate the input array', () => {
  const games = [
    { season: 2026, week: 3, fantasyPoints: 20 },
    { season: 2026, week: 1, fantasyPoints: 25 },
  ];
  const snapshot = games.map((g) => g.week);
  sortGamesByWeek(games);
  expect(games.map((g) => g.week)).toEqual(snapshot);
});

test('sinks missing/non-numeric weeks to the end without crashing', () => {
  const games = [
    { season: 2026, week: 2, fantasyPoints: 10 },
    { season: 2026, week: null, fantasyPoints: 5 },
    { season: 2026, week: 1, fantasyPoints: 12 },
    { season: 2026, fantasyPoints: 7 },
  ];
  const weeks = sortGamesByWeek(games).map((g) => g.week);
  expect(weeks.slice(0, 2)).toEqual([1, 2]);
  expect(weeks.slice(2)).toEqual([null, undefined]);
});

test('preserves received order for duplicate weeks (stable)', () => {
  const games = [
    { season: 2026, week: 2, fantasyPoints: 10, tag: 'a' },
    { season: 2026, week: 1, fantasyPoints: 12 },
    { season: 2026, week: 2, fantasyPoints: 8, tag: 'b' },
  ];
  const ordered = sortGamesByWeek(games);
  expect(ordered.map((g) => g.week)).toEqual([1, 2, 2]);
  expect(ordered.filter((g) => g.week === 2).map((g) => g.tag)).toEqual(['a', 'b']);
});

test('returns an empty array for empty or missing input', () => {
  expect(sortGamesByWeek([])).toEqual([]);
  expect(sortGamesByWeek()).toEqual([]);
});

test('handles a full-season length input', () => {
  const games = Array.from({ length: 17 }, (_, i) => ({ season: 2026, week: 17 - i, fantasyPoints: i }));
  expect(sortGamesByWeek(games).map((g) => g.week)).toEqual(
    Array.from({ length: 17 }, (_, i) => i + 1)
  );
});
