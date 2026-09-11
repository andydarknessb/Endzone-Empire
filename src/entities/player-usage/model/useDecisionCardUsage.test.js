import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useDecisionCardUsage } from './useDecisionCardUsage';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('a null leagueId or playerId binds no URL and reports the idle shape', () => {
  const { result } = renderHook(() => useDecisionCardUsage({ leagueId: null, playerId: 7 }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current).toEqual({ status: 'loading', usage: null });
});

test('reads the decision card context endpoint and returns usage', async () => {
  const usage = {
    weeks: [
      { season: 2026, week: 4, targets: 8, carries: 0, airYards: 90, targetShare: 0.2286, fantasyPoints: 12.4 },
      { season: 2026, week: 3, targets: null, carries: null, airYards: null, targetShare: null, fantasyPoints: null },
      { season: 2026, week: 2, targets: 5, carries: 1, airYards: 40, targetShare: 0.2, fantasyPoints: 8.1 },
    ],
    seasonAverage: { targets: 6.5, carries: 0.5, airYards: 65, targetShare: 0.21, fantasyPoints: 10.25 },
  };
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage } });

  const { result } = renderHook(() => useDecisionCardUsage({ leagueId: 1, playerId: 7, week: 5 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup/7/context?leagueId=1&week=5');
  expect(result.current.usage.weeks).toHaveLength(3);
  expect(result.current.usage.weeks[1].targets).toBeNull();
  expect(result.current.usage.seasonAverage.targets).toBe(6.5);
});

test('week is omitted from the query string when not given', async () => {
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });

  const { result } = renderHook(() => useDecisionCardUsage({ leagueId: 1, playerId: 7 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup/7/context?leagueId=1');
  expect(result.current.usage).toBeNull();
});

test('a failed read reports status error and null usage', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 500 } });

  const { result } = renderHook(() => useDecisionCardUsage({ leagueId: 1, playerId: 7 }));

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.usage).toBeNull();
});
