import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { useLeague, clearLeagueCache, primeLeagueCache } from './useLeague';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const leagueResponse = (overrides = {}) => ({
  data: { league: { id: 1, name: 'Sunday Ballers', ...overrides }, teams: [] },
});

beforeEach(() => {
  clearLeagueCache();
});

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches the league on mount and clears loading once it resolves', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result } = renderHook(() => useLeague(1));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.league).toEqual({ id: 1, name: 'Sunday Ballers' });
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1');
});

test('dedupes concurrent mounts for the same league into a single request', async () => {
  let resolveGet;
  apiClient.get.mockReturnValue(
    new Promise((resolve) => {
      resolveGet = resolve;
    })
  );

  const { result: a } = renderHook(() => useLeague(1));
  const { result: b } = renderHook(() => useLeague(1));

  expect(apiClient.get).toHaveBeenCalledTimes(1);

  resolveGet(leagueResponse({ name: 'Dedup League' }));

  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));
  expect(a.current.league.name).toBe('Dedup League');
  expect(b.current.league.name).toBe('Dedup League');
});

test('serves cache within the TTL on a later mount without refetching', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result, unmount } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();
  apiClient.get.mockClear();

  const { result: second } = renderHook(() => useLeague(1));
  expect(second.current.loading).toBe(false);
  expect(second.current.league.name).toBe('Sunday Ballers');
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('refetches once the TTL has elapsed', async () => {
  const now = Date.now();
  const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

  apiClient.get.mockResolvedValue(leagueResponse());
  const { result, unmount } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  dateSpy.mockReturnValue(now + 61000); // past CACHE_TTL_MS
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(leagueResponse({ name: 'Fresh League' }));

  const { result: second } = renderHook(() => useLeague(1));
  await waitFor(() => expect(second.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1');
  expect(second.current.league.name).toBe('Fresh League');

  dateSpy.mockRestore();
});

test('refetch() bypasses the cache and re-requests the league', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));

  apiClient.get.mockResolvedValue(leagueResponse({ name: 'Refetched League' }));
  await act(async () => {
    await result.current.refetch();
  });

  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(result.current.league.name).toBe('Refetched League');
});

test('clearLeagueCache(leagueId) forces the next mount to refetch', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result, unmount } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  clearLeagueCache(1);
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(leagueResponse({ name: 'Cleared League' }));

  const { result: second } = renderHook(() => useLeague(1));
  await waitFor(() => expect(second.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(second.current.league.name).toBe('Cleared League');
});

test('clearLeagueCache() with no id clears every cached league', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result: r1, unmount: u1 } = renderHook(() => useLeague(1));
  await waitFor(() => expect(r1.current.loading).toBe(false));
  u1();

  apiClient.get.mockResolvedValue(leagueResponse({ id: 2, name: 'League Two' }));
  const { result: r2, unmount: u2 } = renderHook(() => useLeague(2));
  await waitFor(() => expect(r2.current.loading).toBe(false));
  u2();

  clearLeagueCache();
  apiClient.get.mockClear();
  apiClient.get.mockResolvedValue(leagueResponse({ name: 'League One Again' }));

  const { result: r1b } = renderHook(() => useLeague(1));
  await waitFor(() => expect(r1b.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1');
});

test('surfaces the server error message and clears loading on a failed fetch', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'league not found' } } });
  const { result } = renderHook(() => useLeague(1));

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('league not found');
  expect(result.current.league).toBeNull();
});

test('primeLeagueCache(leagueId, league) lets a later mount skip the request entirely', () => {
  primeLeagueCache(7, { id: 7, name: 'Office Pool', pickem_only: true });

  const { result } = renderHook(() => useLeague(7));

  expect(result.current.loading).toBe(false);
  expect(result.current.league).toEqual({ id: 7, name: 'Office Pool', pickem_only: true });
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('primeLeagueCache ignores an empty row so a bad prime cannot poison the cache', async () => {
  primeLeagueCache(7, null);
  apiClient.get.mockResolvedValue(leagueResponse({ id: 7 }));

  const { result } = renderHook(() => useLeague(7));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/league/7');
});

test('switching leagueId stops serving the previous league while the new one loads', async () => {
  apiClient.get.mockImplementation((url) =>
    url.endsWith('/1') ? Promise.resolve(leagueResponse({ id: 1 })) : new Promise(() => {})
  );
  const { result, rerender } = renderHook(({ id }) => useLeague(id), { initialProps: { id: 1 } });
  await waitFor(() => expect(result.current.league?.id).toBe(1));

  rerender({ id: 2 });

  expect(result.current.league).toBeNull();
  expect(result.current.loading).toBe(true);
});

test('a response for a league the hook has already left never lands as the current league', async () => {
  let resolveTwo;
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/1')) return Promise.resolve(leagueResponse({ id: 1 }));
    return new Promise((resolve) => { resolveTwo = resolve; });
  });
  const { result, rerender } = renderHook(({ id }) => useLeague(id), { initialProps: { id: 1 } });
  await waitFor(() => expect(result.current.league?.id).toBe(1));

  rerender({ id: 2 }); // league 2 request in flight
  rerender({ id: 1 }); // back to 1: fresh cache, no new request
  expect(result.current.league?.id).toBe(1);
  expect(result.current.loading).toBe(false);

  await act(async () => { resolveTwo(leagueResponse({ id: 2, name: 'Late arrival' })); });

  expect(result.current.league?.id).toBe(1);
  expect(result.current.loading).toBe(false);
});
