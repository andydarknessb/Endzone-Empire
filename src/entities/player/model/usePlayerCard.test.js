import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { usePlayerCard } from './usePlayerCard';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('a null leagueId or playerId binds no URL and reports the idle shape', () => {
  const { result } = renderHook(() => usePlayerCard({ leagueId: null, playerId: 7 }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current).toEqual({ status: 'loading', card: null });

  const { result: result2 } = renderHook(() => usePlayerCard({ leagueId: 1, playerId: null }));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result2.current).toEqual({ status: 'loading', card: null });
});

test('reads the card route and returns the payload verbatim', async () => {
  const payload = {
    player: { id: 7, name: 'Breece Hall' },
    availability: { state: 'waivers' },
    decision: { upgrade: null },
    weeks: [],
    news: [],
  };
  apiClient.get.mockResolvedValue({ data: payload });

  const { result } = renderHook(() => usePlayerCard({ leagueId: 1, playerId: 7, week: 5 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/7/card?leagueId=1&week=5');
  expect(result.current.card).toBe(payload);
});

test('week is omitted from the query string when not given', async () => {
  apiClient.get.mockResolvedValue({ data: { player: { id: 7 } } });

  const { result } = renderHook(() => usePlayerCard({ leagueId: 1, playerId: 7 }));

  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/7/card?leagueId=1');
});

test('a failed read reports status error and a null card', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 500 } });

  const { result } = renderHook(() => usePlayerCard({ leagueId: 1, playerId: 7 }));

  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.card).toBeNull();
});
