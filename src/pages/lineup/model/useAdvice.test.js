import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useAdvice } from './useAdvice';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches the advice endpoint for the given league/week and shapes the response', async () => {
  apiClient.get.mockResolvedValue({
    data: { suggestions: [{ slot: 'WR' }], movePlan: [{ playerId: 1, toSlot: 'WR' }], projectedTotal: 90, optimalTotal: 95 },
  });
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: false }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup/advice?leagueId=1&week=4');
  expect(result.current.suggestions).toEqual([{ slot: 'WR' }]);
  expect(result.current.movePlan).toEqual([{ playerId: 1, toSlot: 'WR' }]);
  expect(result.current.optimalTotal).toBe(95);
});

test('best ball never calls the endpoint at all', () => {
  const { result } = renderHook(() => useAdvice({ leagueId: 1, week: 4, bestBall: true }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.status).toBe('hidden');
  expect(result.current.suggestions).toEqual([]);
});

test('a missing league or week idles with no request', () => {
  const { result } = renderHook(() => useAdvice({ leagueId: null, week: null, bestBall: false }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.suggestions).toEqual([]);
  expect(result.current.movePlan).toEqual([]);
});
