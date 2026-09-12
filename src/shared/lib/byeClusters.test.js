import { computeByeClusters, worstByeCluster } from './byeClusters';

// A rostered entry shape close enough to entities/roster's lineupEntries
// output for this pure helper's own purposes: only slot, spent, byeWeek,
// playerId, name and position are read.
const entry = (over = {}) => ({
  playerId: 1,
  name: 'Player',
  position: 'RB',
  slot: 'RB',
  spent: false,
  byeWeek: null,
  ...over,
});

describe('computeByeClusters', () => {
  test('returns the seven weeks AFTER fromWeek, not including it', () => {
    const clusters = computeByeClusters({ entries: [], fromWeek: 3 });
    expect(clusters.map((c) => c.week)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  test('a week with no rostered player on bye reads quiet, count 0, no players', () => {
    const clusters = computeByeClusters({ entries: [entry({ byeWeek: 20 })], fromWeek: 3 });
    expect(clusters.every((c) => c.count === 0 && c.severity === 'quiet' && c.players.length === 0)).toBe(true);
  });

  test('a cluster of two is notable', () => {
    const entries = [
      entry({ playerId: 1, name: 'A', position: 'RB', byeWeek: 5 }),
      entry({ playerId: 2, name: 'B', position: 'WR', byeWeek: 5 }),
    ];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    const wk5 = clusters.find((c) => c.week === 5);
    expect(wk5.count).toBe(2);
    expect(wk5.severity).toBe('notable');
    expect(wk5.players.map((p) => p.name)).toEqual(['A', 'B']);
  });

  test('a cluster of three or more is a warning', () => {
    const entries = [
      entry({ playerId: 1, name: 'A', byeWeek: 5 }),
      entry({ playerId: 2, name: 'B', byeWeek: 5 }),
      entry({ playerId: 3, name: 'C', byeWeek: 5 }),
    ];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    const wk5 = clusters.find((c) => c.week === 5);
    expect(wk5.count).toBe(3);
    expect(wk5.severity).toBe('warning');
  });

  test('IR entries are excluded even when their bye week matches', () => {
    const entries = [
      entry({ playerId: 1, name: 'A', byeWeek: 5 }),
      entry({ playerId: 2, name: 'B', byeWeek: 5, slot: 'IR' }),
    ];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    const wk5 = clusters.find((c) => c.week === 5);
    expect(wk5.count).toBe(1);
    expect(wk5.players.map((p) => p.name)).toEqual(['A']);
  });

  test('a spent entry (a settled week\'s departed-starter record) is excluded', () => {
    const entries = [
      entry({ playerId: 1, name: 'A', byeWeek: 5 }),
      entry({ playerId: 2, name: 'Departed', byeWeek: 5, spent: true }),
    ];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    expect(clusters.find((c) => c.week === 5).count).toBe(1);
  });

  test('a bench player on bye counts (only IR is excluded, not BENCH)', () => {
    const entries = [entry({ playerId: 1, name: 'Bencher', byeWeek: 5, slot: 'BENCH' })];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    expect(clusters.find((c) => c.week === 5).count).toBe(1);
  });

  test('a bye week outside the seven-week window is not counted anywhere', () => {
    const entries = [entry({ playerId: 1, name: 'TooLate', byeWeek: 11 })];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    expect(clusters.every((c) => c.count === 0)).toBe(true);
  });

  test('no fromWeek yields no clusters', () => {
    expect(computeByeClusters({ entries: [entry()], fromWeek: null })).toEqual([]);
    expect(computeByeClusters()).toEqual([]);
  });
});

describe('worstByeCluster', () => {
  test('null when no week reaches two', () => {
    const clusters = computeByeClusters({ entries: [entry({ byeWeek: 5 })], fromWeek: 3 });
    expect(worstByeCluster(clusters)).toBeNull();
  });

  test('the highest-count week at two or more', () => {
    const entries = [
      entry({ playerId: 1, name: 'A', byeWeek: 5 }),
      entry({ playerId: 2, name: 'B', byeWeek: 5 }),
      entry({ playerId: 3, name: 'C', byeWeek: 9 }),
      entry({ playerId: 4, name: 'D', byeWeek: 9 }),
      entry({ playerId: 5, name: 'E', byeWeek: 9 }),
    ];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    expect(worstByeCluster(clusters)).toMatchObject({ week: 9, count: 3 });
  });

  // f6 (formal review): the prior version of this fixture never exercised
  // the tie-break branch at all (its two counts were 2 and 3) - this one
  // ties two weeks at the top count and pins that the earlier week wins.
  test('earliest week wins a tie at the top count', () => {
    const entries = [
      entry({ playerId: 1, name: 'A', byeWeek: 5 }),
      entry({ playerId: 2, name: 'B', byeWeek: 5 }),
      entry({ playerId: 3, name: 'C', byeWeek: 5 }),
      entry({ playerId: 4, name: 'D', byeWeek: 9 }),
      entry({ playerId: 5, name: 'E', byeWeek: 9 }),
      entry({ playerId: 6, name: 'F', byeWeek: 9 }),
    ];
    const clusters = computeByeClusters({ entries, fromWeek: 3 });
    expect(worstByeCluster(clusters)).toMatchObject({ week: 5, count: 3 });
  });

  test('empty/missing input is safe', () => {
    expect(worstByeCluster([])).toBeNull();
    expect(worstByeCluster()).toBeNull();
  });
});
