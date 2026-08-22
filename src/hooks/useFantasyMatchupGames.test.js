import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import useFantasyMatchupGames from './useFantasyMatchupGames';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches real-games for the given matchupId and returns the array', async () => {
  apiClient.get.mockResolvedValue({ data: ['20260910_BUF@KC', '20260913_SF@LAR'] });

  const { result } = renderHook(() => useFantasyMatchupGames(9));
  expect(result.current.loading).toBe(true);

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/matchups/9/real-games');
  expect(result.current.realGameIds).toEqual(['20260910_BUF@KC', '20260913_SF@LAR']);
  expect(result.current.error).toBe(null);
});

test('does not fetch when matchupId is missing', () => {
  const { result } = renderHook(() => useFantasyMatchupGames(null));
  expect(result.current.loading).toBe(false);
  expect(result.current.realGameIds).toEqual([]);
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('surfaces an API error message and clears loading', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'matchup not found' } } });

  const { result } = renderHook(() => useFantasyMatchupGames(404));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toBe('matchup not found');
  expect(result.current.realGameIds).toEqual([]);
});

test('re-fetches when matchupId changes', async () => {
  apiClient.get.mockResolvedValue({ data: ['gameA'] });
  const { result, rerender } = renderHook(
    ({ id }) => useFantasyMatchupGames(id),
    { initialProps: { id: 1 } }
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/matchups/1/real-games');

  apiClient.get.mockResolvedValue({ data: ['gameB'] });
  rerender({ id: 2 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/matchups/2/real-games'));
  await waitFor(() => expect(result.current.realGameIds).toEqual(['gameB']));
});
