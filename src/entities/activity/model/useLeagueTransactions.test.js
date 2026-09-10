import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useLeagueTransactions } from './useLeagueTransactions';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('a null leagueId binds no URL and reports the idle shape', () => {
  const { result } = renderHook(() => useLeagueTransactions(null));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current).toEqual({ status: 'loading', rows: [] });
});

test('reads the league transactions endpoint and maps every row', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { id: 2, type: 'add', team_name: 'A', player_name: 'P2', detail: {}, created_at: '2026-09-09T02:00:00.000Z' },
      { id: 1, type: 'add', team_name: 'A', player_name: 'P1', detail: {}, created_at: '2026-09-09T01:00:00.000Z' },
    ],
  });
  const { result } = renderHook(() => useLeagueTransactions(5));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/5/transactions');
  expect(result.current.rows.map((r) => r.id)).toEqual([2, 1]);
  expect(result.current.rows[0].sentence).toBe('added P2');
});

test('limit slices the mapped rows client-side', async () => {
  apiClient.get.mockResolvedValue({
    data: [
      { id: 3, type: 'add', team_name: 'A', player_name: 'P3', detail: {}, created_at: '2026-09-09T03:00:00.000Z' },
      { id: 2, type: 'add', team_name: 'A', player_name: 'P2', detail: {}, created_at: '2026-09-09T02:00:00.000Z' },
      { id: 1, type: 'add', team_name: 'A', player_name: 'P1', detail: {}, created_at: '2026-09-09T01:00:00.000Z' },
    ],
  });
  const { result } = renderHook(() => useLeagueTransactions(5, { limit: 2 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.rows.map((r) => r.id)).toEqual([3, 2]);
});

test('a failed read reports status error and an empty feed', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 500 } });
  const { result } = renderHook(() => useLeagueTransactions(5));

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.rows).toEqual([]);
});
