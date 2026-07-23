import {
  MAX_PROJECTION_TIERS,
  deriveProjectionTiers,
  orderRowsByPosition,
} from './rankingTiers';

const WR_PROJECTIONS = [24.6, 22.4, 21.6, 21.2, 19.1, 19, 18.1, 17, 16.3, 16.1, 15.6, 15];

test('deriveProjectionTiers creates projection drop bands independently by position', () => {
  const tiers = deriveProjectionTiers([
    { playerId: 1, position: 'RB', projectedPoints: 20, rank: 1 },
    { playerId: 2, position: 'RB', projectedPoints: 19, rank: 2 },
    { playerId: 3, position: 'RB', projectedPoints: 15, rank: 3 },
    { playerId: 4, position: 'WR', projectedPoints: 18, rank: 4 },
    { playerId: 5, position: 'WR', projectedPoints: 14, rank: 5 },
  ]);

  expect(tiers.get(1)).toBe(1);
  expect(tiers.get(2)).toBe(1);
  expect(tiers.get(3)).toBe(2);
  expect(tiers.get(4)).toBe(1);
  expect(tiers.get(5)).toBe(2);
});

test('deriveProjectionTiers places missing projections in a trailing tier', () => {
  const tiers = deriveProjectionTiers([
    { playerId: 1, position: 'TE', projectedPoints: 10, rank: 1 },
    { playerId: 2, position: 'TE', projectedPoints: null, rank: 2 },
    { playerId: 3, position: 'TE', projectedPoints: null, rank: 3 },
  ]);
  expect(tiers.get(1)).toBe(1);
  expect(tiers.get(2)).toBe(2);
  expect(tiers.get(3)).toBe(2);
});

test('mixed overall rankings become contiguous position blocks with monotonic tiers', () => {
  const rows = [
    { playerId: 'qb-1', position: 'QB', projectedPoints: 30 },
    ...WR_PROJECTIONS.map((projectedPoints, index) => ({
      playerId: `wr-${index + 1}`,
      position: 'WR',
      projectedPoints,
    })),
    { playerId: 'rb-1', position: 'RB', projectedPoints: 23.8 },
    { playerId: 'qb-2', position: 'QB', projectedPoints: 20.5 },
    { playerId: 'rb-2', position: 'RB', projectedPoints: 18.4 },
  ]
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const tiers = deriveProjectionTiers(rows);
  const ordered = orderRowsByPosition(rows);
  const positionRuns = ordered.reduce((runs, row) => {
    if (runs[runs.length - 1] !== row.position) runs.push(row.position);
    return runs;
  }, []);

  expect(positionRuns).toEqual(['QB', 'RB', 'WR']);
  for (const position of positionRuns) {
    const positionTiers = ordered
      .filter((row) => row.position === position)
      .map((row) => tiers.get(row.playerId));
    expect(positionTiers).toEqual([...positionTiers].sort((a, b) => a - b));
  }

  const wrTiers = ordered
    .filter((row) => row.position === 'WR')
    .map((row) => tiers.get(row.playerId));
  expect(new Set(wrTiers).size).toBeGreaterThan(1);
  expect(Math.max(...wrTiers)).toBeLessThanOrEqual(MAX_PROJECTION_TIERS);
});

test.each([
  ['one player', [{ playerId: 1, position: 'K', projectedPoints: 10 }]],
  ['equal projections', [
    { playerId: 1, position: 'TE', projectedPoints: 10 },
    { playerId: 2, position: 'TE', projectedPoints: 10 },
    { playerId: 3, position: 'TE', projectedPoints: 10 },
  ]],
])('%s stays in a single Tier 1', (_label, rows) => {
  const tiers = deriveProjectionTiers(rows);
  expect([...tiers.values()]).toEqual(rows.map(() => 1));
});
