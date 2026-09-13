import { sortRosterForDrop } from './rosterDrop';

test('sorts worst weekly projection first, unprojected last', () => {
  const roster = [
    { id: 1, projected_weekly_points: 15 },
    { id: 2, projected_weekly_points: 3.2 },
    { id: 3, projected_weekly_points: null },
    { id: 4, projected_weekly_points: 8 },
  ];
  expect(sortRosterForDrop(roster).map((p) => p.id)).toEqual([2, 4, 1, 3]);
});

test('a null or undefined roster sorts to an empty list', () => {
  expect(sortRosterForDrop(null)).toEqual([]);
  expect(sortRosterForDrop(undefined)).toEqual([]);
});

test('does not mutate the input array', () => {
  const roster = [{ id: 1, projected_weekly_points: 5 }, { id: 2, projected_weekly_points: 1 }];
  const copy = [...roster];
  sortRosterForDrop(roster);
  expect(roster).toEqual(copy);
});
