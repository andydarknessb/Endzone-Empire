import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate } from '../lib/resourceCache';
import { clearPickemStandingsCache, usePickemStandings } from './usePickemStandings';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js
// and useResource.test.js. What is standings-specific is the two-or-three
// element key, the season query and the league-wide clear.
const standingsResponse = (overrides = {}) => ({
  data: { season: 2026, mode: 'straight', standings: [{ userId: 1, username: 'alice', points: 3 }], ...overrides },
});

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.restoreAllMocks(); // the ttl test spies on Date.now; never let a failure leak it
  jest.clearAllMocks();
});

test('requests the standings for a league and season and returns the payload', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result } = renderHook(() => usePickemStandings(7, 2026));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings?season=2026');
  expect(result.current.data.season).toBe(2026);
  expect(result.current.error).toBeNull();
});

test('standings stay cached for thirty seconds and are recomputed past that', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1000000);
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result, unmount } = renderHook(() => usePickemStandings(7, 2026));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  // The dashboard, then the Standings tab one click later.
  now.mockReturnValue(1000000 + 29000);
  const { result: withinTtl, unmount: unmountWithinTtl } = renderHook(() => usePickemStandings(7, 2026));
  expect(withinTtl.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  unmountWithinTtl();

  now.mockReturnValue(1000000 + 31000);
  const { result: pastTtl } = renderHook(() => usePickemStandings(7, 2026));
  expect(pastTtl.current.loading).toBe(true);
  await waitFor(() => expect(pastTtl.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('omits the season query when none is given, and null is the same request', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result, unmount } = renderHook(() => usePickemStandings(7));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings');
  unmount();

  // An explicit null season is the same key, so it is served from cache.
  const { result: explicitNull } = renderHook(() => usePickemStandings(7, null));
  expect(explicitNull.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a falsy season that is not null keys and requests the same way', async () => {
  apiClient.get.mockResolvedValue(standingsResponse({ season: 0 }));
  const { result } = renderHook(() => usePickemStandings(7, 0));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings?season=0');

  // Season 0 is its own entry, so the league-season request still goes out.
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result: currentSeason } = renderHook(() => usePickemStandings(7));
  await waitFor(() => expect(currentSeason.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenLastCalledWith('/api/pickem/league/7/standings');
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('a null leagueId never requests', () => {
  const { result } = renderHook(() => usePickemStandings(null, 2026));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBeNull();
});

test('clearPickemStandingsCache(id) drops every season of that league and leaves other leagues cached', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const mounts = [
    renderHook(() => usePickemStandings(7, 2026)),
    renderHook(() => usePickemStandings(7, 2025)),
    renderHook(() => usePickemStandings(8, 2026)),
  ];
  await waitFor(() => expect(mounts[2].result.current.loading).toBe(false));
  mounts.forEach((mount) => mount.unmount());
  expect(apiClient.get).toHaveBeenCalledTimes(3);

  clearPickemStandingsCache(7); // a picks save calls this
  apiClient.get.mockClear();

  const { result: sameLeague } = renderHook(() => usePickemStandings(7, 2025));
  expect(sameLeague.current.loading).toBe(true);
  await waitFor(() => expect(sameLeague.current.loading).toBe(false));
  const { result: otherLeague } = renderHook(() => usePickemStandings(8, 2026));
  expect(otherLeague.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/standings?season=2025');
});

test('clearPickemStandingsCache() with no id clears every league', async () => {
  apiClient.get.mockResolvedValue(standingsResponse());
  const { result, unmount } = renderHook(() => usePickemStandings(8, 2026));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  clearPickemStandingsCache();
  apiClient.get.mockClear();

  const { result: second } = renderHook(() => usePickemStandings(8, 2026));
  expect(second.current.loading).toBe(true);
  await waitFor(() => expect(second.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
