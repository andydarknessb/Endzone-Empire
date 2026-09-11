import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useBenchPointsLeft } from './useBenchPointsLeft';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('reads GET /api/team/hindsight and formats the total once leagueId/teamId/season are known', async () => {
  apiClient.get.mockResolvedValue({ data: { totalPointsLeftOnBench: 42.5 } });
  const { result } = renderHook(() => useBenchPointsLeft({ leagueId: 1, teamId: 3, season: 2026 }));
  await waitFor(() => expect(result.current.text).toBe('Bench points this season: 42.5'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/hindsight?leagueId=1&teamId=3&season=2026');
});

test('no leagueId/teamId/season yet: no request fires and text stays null', () => {
  const { result } = renderHook(() => useBenchPointsLeft({ leagueId: null, teamId: null, season: null }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.text).toBeNull();
});

test('a missing or non-numeric totalPointsLeftOnBench degrades to no line rather than throwing', async () => {
  apiClient.get.mockResolvedValue({ data: {} });
  const { result } = renderHook(() => useBenchPointsLeft({ leagueId: 1, teamId: 3, season: 2026 }));
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(result.current.text).toBeNull();
});
