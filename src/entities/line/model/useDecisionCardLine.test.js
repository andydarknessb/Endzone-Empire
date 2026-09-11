import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useDecisionCardLine } from './useDecisionCardLine';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('a null leagueId or playerId binds no URL and reports the idle shape', () => {
  const { result } = renderHook(() => useDecisionCardLine({ leagueId: null, playerId: 7 }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current).toEqual({ status: 'loading', line: null, weather: null });

  const { result: result2 } = renderHook(() => useDecisionCardLine({ leagueId: 1, playerId: null }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result2.current).toEqual({ status: 'loading', line: null, weather: null });
});

test('reads the decision card context endpoint and returns line and weather', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      line: { spread: -3, total: 47, observedAt: '2026-10-01T12:00:00.000Z', impliedTeamTotal: 22 },
      weather: { indoor: false, temperatureF: 45, windSpeedMph: 10, windGustMph: 18, precipitationProbability: 20, shortForecast: 'Partly Cloudy' },
      usage: null,
    },
  });

  const { result } = renderHook(() => useDecisionCardLine({ leagueId: 1, playerId: 7, week: 5 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup/7/context?leagueId=1&week=5');
  expect(result.current.line.impliedTeamTotal).toBe(22);
  expect(result.current.weather.temperatureF).toBe(45);
});

test('week is omitted from the query string when not given', async () => {
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });

  const { result } = renderHook(() => useDecisionCardLine({ leagueId: 1, playerId: 7 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup/7/context?leagueId=1');
});

test('a failed read reports status error and null line/weather', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 500 } });

  const { result } = renderHook(() => useDecisionCardLine({ leagueId: 1, playerId: 7 }));

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.line).toBeNull();
  expect(result.current.weather).toBeNull();
});
