import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { usePickemStandings, clearPickemStandingsCache } from './usePickemStandings';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const standingsResponse = (overrides = {}) => ({
  data: { season: 2026, mode: 'straight', standings: [{ userId: 1, username: 'alice', points: 3 }], ...overrides },
});

beforeEach(() => {
  clearPickemStandingsCache();
});

afterEach(() => {
  jest.restoreAllMocks(); // the TTL test spies on Date.now; never let a failure there leak it
  jest.clearAllMocks();
});

test('fetches the standings for the league and season on mount and clears loading', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => usePickemStandings(7, 2026));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.data.season).toBe(2026);
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings?season=2026');
});

test('omits the season query when no season is given (the server uses the league season)', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => usePickemStandings(7));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings');
});

test('dedupes concurrent mounts for the same league and season into one request', async () => {
  let resolveGet;
  apiClient.get.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

  const { result: a } = renderHook(() => usePickemStandings(7, 2026));
  const { result: b } = renderHook(() => usePickemStandings(7, 2026));

  expect(apiClient.get).toHaveBeenCalledTimes(1);
  await act(async () => { resolveGet(standingsResponse()); });
  expect(a.current.data.season).toBe(2026);
  expect(b.current.data.season).toBe(2026);
});

test('serves a fresh cache entry to a later mount without a request (dashboard -> Pick\'em page)', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result: firstResult, unmount } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(firstResult.current.loading).toBe(false));
  unmount();

  const { result: secondResult } = renderHook(() => usePickemStandings(7, 2026));
  expect(secondResult.current.loading).toBe(false);
  expect(secondResult.current.data.season).toBe(2026);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a different season is a different entry', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result: firstResult } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(firstResult.current.loading).toBe(false));

  const { result: secondResult } = renderHook(() => usePickemStandings(7, 2025));
  await waitFor(() => expect(secondResult.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/pickem/league/7/standings?season=2025');
});

test('refetches once the TTL has elapsed', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1_000_000);
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result: firstResult, unmount } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(firstResult.current.loading).toBe(false));
  unmount();

  now.mockReturnValue(1_000_000 + 31_000);
  const { result: secondResult } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(secondResult.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

test('refetch() bypasses the cache and re-requests', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(result.current.loading).toBe(false));

  apiClient.get.mockResolvedValue(standingsResponse({ standings: [{ userId: 1, username: 'alice', points: 4 }] }));
  await act(async () => { await result.current.refetch(); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(result.current.data.standings[0].points).toBe(4);
});

test('clearPickemStandingsCache(leagueId) forces the next mount to refetch (a picks save calls it)', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result: firstResult, unmount } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(firstResult.current.loading).toBe(false));
  unmount();

  clearPickemStandingsCache(7);
  const { result: secondResult } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(secondResult.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('clearPickemStandingsCache(leagueId) leaves other leagues cached', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result: resultA, unmount: unmountA } = renderHook(() => usePickemStandings(7, 2026));
  const { result: resultB, unmount: unmountB } = renderHook(() => usePickemStandings(8, 2026));
  await waitFor(() => expect(resultA.current.loading).toBe(false));
  await waitFor(() => expect(resultB.current.loading).toBe(false));
  unmountA(); unmountB();

  clearPickemStandingsCache(7);
  const { result: againResult } = renderHook(() => usePickemStandings(8, 2026));
  expect(againResult.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('surfaces the server error and clears loading on a failed fetch, and does not cache the failure', async () => {
  apiClient.get.mockRejectedValueOnce({ response: { data: { error: 'database is down' } } });
  const { result } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('database is down');
  expect(result.current.data).toBeNull();

  apiClient.get.mockResolvedValue(standingsResponse());
  await act(async () => { await result.current.refetch(); });
  expect(result.current.error).toBeNull();
  expect(result.current.data.season).toBe(2026);
});

test('switching leagues stops serving the previous league while the new one loads', async () => {
  apiClient.get.mockImplementation((url) =>
    url.includes('/league/7/') ? Promise.resolve(standingsResponse()) : new Promise(() => {})
  );
  const { result, rerender } = renderHook(({ id }) => usePickemStandings(id, 2026), { initialProps: { id: 7 } });
  await waitFor(() => expect(result.current.data?.season).toBe(2026));

  rerender({ id: 8 });

  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(true);
});

test('a response that was in flight when the cache was cleared neither repopulates it nor lands over the newer one', async () => {
  let resolveFirst;
  let resolveSecond;
  apiClient.get
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
  const { result, unmount } = renderHook(() => usePickemStandings(7, 2026));
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  // e.g. savePicks resolved while the first standings request was still out:
  // the mounted hook reloads (request 2) and the pre-save response must lose.
  act(() => { clearPickemStandingsCache(7); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  await act(async () => { resolveSecond(standingsResponse({ standings: [{ userId: 1, username: 'alice', points: 4 }] })); });
  expect(result.current.data.standings[0].points).toBe(4);
  await act(async () => { resolveFirst(standingsResponse({ standings: [{ userId: 1, username: 'alice', points: 3 }] })); });
  expect(result.current.data.standings[0].points).toBe(4); // the older response did not land
  unmount();

  const { result: nextResult } = renderHook(() => usePickemStandings(7, 2026));
  expect(nextResult.current.loading).toBe(false); // the cache holds the post-clear response, fresh
  expect(nextResult.current.data.standings[0].points).toBe(4);
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('a stale error from one entry does not survive a switch to a fresh cached entry', async () => {
  apiClient.get.mockImplementation((url) =>
    url.includes('/league/7/') ? Promise.reject({ response: { data: { error: 'database is down' } } }) : Promise.resolve(standingsResponse())
  );
  const { result: warmResult, unmount } = renderHook(() => usePickemStandings(8, 2026));
  await waitFor(() => expect(warmResult.current.loading).toBe(false));
  unmount();

  const { result, rerender } = renderHook(({ id }) => usePickemStandings(id, 2026), { initialProps: { id: 7 } });
  await waitFor(() => expect(result.current.error).toBe('database is down'));

  rerender({ id: 8 });

  expect(result.current.error).toBeNull();
  expect(result.current.data.season).toBe(2026);
});

test('a falsy season that is not null keys and requests the same way (no split entries)', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => usePickemStandings(7, 0));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings?season=0');
});

test('a mounted hook reloads when its league is invalidated, keeping the old table until the new one lands', async () => {
  apiClient.get.mockResolvedValue(standingsResponse({ mode: 'straight' }));
  const { result } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(result.current.loading).toBe(false));

  let resolveNext;
  apiClient.get.mockReturnValueOnce(new Promise((resolve) => { resolveNext = resolve; }));
  act(() => { clearPickemStandingsCache(7); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(result.current.data.mode).toBe('straight'); // stale-while-revalidate
  await act(async () => { resolveNext(standingsResponse({ mode: 'confidence' })); });
  expect(result.current.data.mode).toBe('confidence');

  // Another league's invalidation is not this hook's business.
  act(() => { clearPickemStandingsCache(8); });
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
