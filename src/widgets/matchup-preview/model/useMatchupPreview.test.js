import { renderHook } from '@testing-library/react';
import { useMatchupPreview } from './useMatchupPreview';
import { useLeague } from '../../../hooks/useLeague';
import { useWeekMatchups } from '../../../entities/matchup';

jest.mock('../../../hooks/useLeague', () => ({ useLeague: jest.fn() }));
jest.mock('../../../shared/lib', () => ({
  ...jest.requireActual('../../../shared/lib'),
  useEndpoint: () => ({ status: 'loading', data: null }),
}));
jest.mock('../../../entities/matchup', () => ({
  ...jest.requireActual('../../../entities/matchup'),
  useWeekMatchups: jest.fn(),
}));

const row = (week, overrides = {}) => ({
  id: week, season: 2026, week, final: false, status: 'upcoming', narrative: null, postgame: null,
  home: { teamId: 3, expectedFinal: null }, away: { teamId: 7, expectedFinal: null }, ...overrides,
});

const setup = (currentWeek, byWeek) => {
  useLeague.mockReturnValue({ teams: [], viewerTeamId: 3, league: { current_season: 2026, current_week: currentWeek } });
  useWeekMatchups.mockImplementation((leagueId, week) => ({
    matchups: byWeek[week] ?? [], loading: false, error: null, refetch: jest.fn(),
  }));
  return renderHook(() => useMatchupPreview(1)).result.current;
};

afterEach(() => jest.clearAllMocks());

describe('useMatchupPreview lastWeek', () => {
  test('a final matchup with a postgame gives its text', () => {
    const model = setup(3, { 3: [row(3)], 2: [row(2, { final: true, postgame: 'A rout.' })] });
    expect(model.lastWeek).toEqual({ narrative: 'A rout.' });
  });

  test('not final, or no postgame, gives null', () => {
    expect(setup(3, { 2: [row(2, { final: false, postgame: 'Early.' })] }).lastWeek).toBeNull();
    expect(setup(3, { 2: [row(2, { final: true })] }).lastWeek).toBeNull();
  });

  // The ?week= list read is not season-scoped: after a rollover, a viewer on a bye last week
  // would otherwise match last season's same-week row and print its postgame.
  test('a previous season\'s row for that week gives null', () => {
    const model = setup(3, { 2: [row(2, { season: 2025, final: true, postgame: 'Last year.' })] });
    expect(model.lastWeek).toBeNull();
  });

  test('week 1 gives null and never enables a previous-week read', () => {
    const model = setup(1, { 1: [row(1)] });
    expect(model.lastWeek).toBeNull();
    const enabled = useWeekMatchups.mock.calls.filter(([, , opts]) => opts?.enabled !== false);
    expect(enabled.every(([, week]) => week === 1)).toBe(true);
  });
});

describe('useMatchupPreview viewer first', () => {
  test('an away viewer is the viewer: their figures lead and the home Team is the opponent', () => {
    useLeague.mockReturnValue({
      teams: [{ teamId: 3, teamName: 'Home Heroes' }, { teamId: 7, teamName: 'Away Aces' }],
      viewerTeamId: 7,
      league: { current_season: 2026, current_week: 3 },
    });
    useWeekMatchups.mockImplementation(() => ({
      matchups: [row(3, {
        status: 'live',
        home: { teamId: 3, score: 82.2, expectedFinal: 110.5, playersRemaining: 4 },
        away: { teamId: 7, score: 77, expectedFinal: 123.9, playersRemaining: 6 },
      })],
      loading: false,
      error: null,
      refetch: jest.fn(),
    }));
    const model = renderHook(() => useMatchupPreview(1)).result.current;
    expect(model.viewer).toMatchObject({ name: 'Away Aces', score: '77.0', expectedFinal: '123.9', playersRemaining: 6 });
    expect(model.opponent).toMatchObject({ name: 'Home Heroes', score: '82.2', expectedFinal: '110.5', playersRemaining: 4 });
    expect(model.game.winProbability.viewerPct).toBeGreaterThan(50);
  });
});
