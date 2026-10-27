import { itemType, lineupProblemFor } from './actionItemModel';

const DEADLINE = '2026-10-29T17:00:00.000Z';
const item = (over = {}) => ({
  id: 'lineup_problem:7:2026-6',
  type: 'lineup_problem',
  leagueId: 7,
  leagueName: 'Sunday Ballers',
  title: 'Fill your empty FLEX slot',
  deadlineAt: DEADLINE,
  ...over,
});

describe('lineupProblemFor', () => {
  test('returns this league\'s lineup_problem item for the requested week', () => {
    const wanted = item();
    const items = [item({ id: 'picks_open:7:2026-6', type: 'picks_open' }), wanted];
    expect(lineupProblemFor(items, { leagueId: '7', season: 2026, week: 6 })).toBe(wanted);
  });

  test('another week, another league or another type gives undefined', () => {
    const items = [
      item({ id: 'lineup_problem:7:2026-5' }),
      item({ id: 'lineup_problem:8:2026-6', leagueId: 8 }),
      item({ id: 'picks_open:7:2026-6', type: 'picks_open' }),
    ];
    expect(lineupProblemFor(items, { leagueId: 7, season: 2026, week: 6 })).toBeUndefined();
    expect(lineupProblemFor([], { leagueId: 7, season: 2026, week: 6 })).toBeUndefined();
    expect(lineupProblemFor(undefined, { leagueId: 7, season: 2026, week: 6 })).toBeUndefined();
  });
});

describe('itemType', () => {
  test('reads the type from the item id, the one spelling of the id format', () => {
    expect(itemType(item())).toBe('lineup_problem');
    expect(itemType(item({ id: 'picks_open:7:2026-6' }))).toBe('picks_open');
    expect(itemType(item({ id: 'draft_live:7' }))).toBe('draft_live');
    expect(itemType(null)).toBe('');
  });
});
