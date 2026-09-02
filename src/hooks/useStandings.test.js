import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate } from '../lib/resourceCache';
import { clearStandingsCache, useStandings } from './useStandings';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js and
// useResource.test.js. What is standings-specific is the week-keyed entry (so a
// week advance is a new key and a fresh read), the single scoring-standings URL
// the week rides on, and the league-wide clear.
const standingsResponse = (overrides = {}) => ({
  data: {
    league: { current_week: 3, season_status: 'regular' },
    standings: [{ teamId: 1, wins: 3, losses: 1, ties: 0, pf: 100, pa: 90, rank: 1 }],
    ...overrides,
  },
});

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('requests the scoring standings for a league at a week and returns the payload', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => useStandings(7, 3));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  // The week is the cache key, not a query param: the endpoint is season-scoped
  // and takes no week param, so its URL is identical across weeks and the key is
  // what forces a fresh read when the week advances.
  expect(apiClient.get).toHaveBeenCalledWith('/api/scoring/league/7/standings');
  expect(result.current.data.standings).toHaveLength(1);
  expect(result.current.error).toBeNull();
});

test('a week advance is a new key, so it re-reads rather than serving the old week', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result, rerender } = renderHook(({ week }) => useStandings(7, week), {
    initialProps: { week: 3 },
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  // Same league, next week: the key changes, so a second request goes out.
  rerender({ week: 4 });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
});

test('a repeat mount at the same week inside the ttl is served from cache', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1000000);
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result, unmount } = renderHook(() => useStandings(7, 3));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  now.mockReturnValue(1000000 + 5000);
  const { result: repeat } = renderHook(() => useStandings(7, 3));
  expect(repeat.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a null week keys without it and still requests once the league id is known', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => useStandings(7, null));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/scoring/league/7/standings');
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a null leagueId never requests', () => {
  const { result } = renderHook(() => useStandings(null, 3));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBeNull();
});

test('clearStandingsCache(id) drops every week of that league and leaves other leagues cached', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const mounts = [
    renderHook(() => useStandings(7, 3)),
    renderHook(() => useStandings(7, 4)),
    renderHook(() => useStandings(8, 3)),
  ];
  await waitFor(() => expect(mounts[2].result.current.loading).toBe(false));
  mounts.forEach((mount) => mount.unmount());
  expect(apiClient.get).toHaveBeenCalledTimes(3);

  clearStandingsCache(7);
  apiClient.get.mockClear();

  const { result: sameLeague } = renderHook(() => useStandings(7, 4));
  expect(sameLeague.current.loading).toBe(true);
  await waitFor(() => expect(sameLeague.current.loading).toBe(false));
  const { result: otherLeague } = renderHook(() => useStandings(8, 3));
  expect(otherLeague.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
