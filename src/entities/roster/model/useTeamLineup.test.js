import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useTeamLineup } from './useTeamLineup';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const body = {
  leagueId: 7,
  teamId: 3,
  season: 2026,
  week: 4,
  currentWeek: 4,
  entries: [
    { id: 1, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', slot: 'QB', projected_points: 24.3, injury_status: null },
  ],
};

test('fetches GET /api/team/lineup with leagueId and week, mapped through lineupModel', async () => {
  apiClient.get.mockResolvedValue({ data: body });

  const { result } = renderHook(() => useTeamLineup(7, 4));

  await waitFor(() => expect(result.current.lineup).not.toBeNull());
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup?leagueId=7&week=4');
  expect(result.current.lineup.starters).toHaveLength(1);
  expect(result.current.lineup.week).toBe(4);
});

test('a null leagueId binds no URL: the apiClient mock is never called', async () => {
  renderHook(() => useTeamLineup(null, 4));
  // There is nothing to await for (a null url idles forever), so a microtask
  // flush is enough to prove no fetch was ever scheduled.
  await Promise.resolve();
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('a null week binds no URL: the apiClient mock is never called', async () => {
  renderHook(() => useTeamLineup(7, null));
  await Promise.resolve();
  expect(apiClient.get).not.toHaveBeenCalled();
});
