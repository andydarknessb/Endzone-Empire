import {
  MAX_RANKING_TIERS,
  deriveRankingTiers,
  orderRowsByPosition,
} from './rankingTiers';

const WR_SEASON_POINTS = [246, 224, 216, 212, 191, 190, 181, 170, 163, 161, 156, 150];

test('deriveRankingTiers creates season-points drop bands independently by position', () => {
  const tiers = deriveRankingTiers([
    { playerId: 1, position: 'RB', seasonPoints: 20, rank: 1 },
    { playerId: 2, position: 'RB', seasonPoints: 19, rank: 2 },
    { playerId: 3, position: 'RB', seasonPoints: 15, rank: 3 },
    { playerId: 4, position: 'WR', seasonPoints: 18, rank: 4 },
    { playerId: 5, position: 'WR', seasonPoints: 14, rank: 5 },
  ]);

  expect(tiers.get(1)).toBe(1);
  expect(tiers.get(2)).toBe(1);
  expect(tiers.get(3)).toBe(2);
  expect(tiers.get(4)).toBe(1);
  expect(tiers.get(5)).toBe(2);
});

test('deriveRankingTiers ignores the projection column entirely — a hot per-game average cannot reach Tier 1', () => {
  // The Quentin Johnston case: two huge games (high projection) but a tiny
  // season total must not out-tier full-season producers.
  const tiers = deriveRankingTiers([
    { playerId: 1, position: 'WR', seasonPoints: 280, projectedPoints: 15.1, rank: 1 },
    { playerId: 2, position: 'WR', seasonPoints: 262, projectedPoints: 14.9, rank: 2 },
    { playerId: 3, position: 'WR', seasonPoints: 34.3, projectedPoints: 22.4, rank: 3 },
  ]);
  expect(tiers.get(1)).toBe(1);
  expect(tiers.get(2)).toBe(1);
  expect(tiers.get(3)).toBe(2);
});

test('deriveRankingTiers places rows with no season points value in a trailing tier', () => {
  const tiers = deriveRankingTiers([
    { playerId: 1, position: 'TE', seasonPoints: 10, rank: 1 },
    { playerId: 2, position: 'TE', seasonPoints: null, rank: 2 },
    { playerId: 3, position: 'TE', seasonPoints: null, rank: 3 },
  ]);
  expect(tiers.get(1)).toBe(1);
  expect(tiers.get(2)).toBe(2);
  expect(tiers.get(3)).toBe(2);
});

test('mixed overall rankings become contiguous position blocks with monotonic tiers', () => {
  const rows = [
    { playerId: 'qb-1', position: 'QB', seasonPoints: 300 },
    ...WR_SEASON_POINTS.map((seasonPoints, index) => ({
      playerId: `wr-${index + 1}`,
      position: 'WR',
      seasonPoints,
    })),
    { playerId: 'rb-1', position: 'RB', seasonPoints: 238 },
    { playerId: 'qb-2', position: 'QB', seasonPoints: 205 },
    { playerId: 'rb-2', position: 'RB', seasonPoints: 184 },
  ]
    .sort((a, b) => b.seasonPoints - a.seasonPoints)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const tiers = deriveRankingTiers(rows);
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
  expect(Math.max(...wrTiers)).toBeLessThanOrEqual(MAX_RANKING_TIERS);
});

test.each([
  ['one player', [{ playerId: 1, position: 'K', seasonPoints: 10 }]],
  ['equal season points', [
    { playerId: 1, position: 'TE', seasonPoints: 10 },
    { playerId: 2, position: 'TE', seasonPoints: 10 },
    { playerId: 3, position: 'TE', seasonPoints: 10 },
  ]],
])('%s stays in a single Tier 1', (_label, rows) => {
  const tiers = deriveRankingTiers(rows);
  expect([...tiers.values()]).toEqual(rows.map(() => 1));
});
