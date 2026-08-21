import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate } from '../lib/resourceCache';
import { clearLeagueCache, primeLeagueCache, useLeague } from './useLeague';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js
// and useResource.test.js. What is league-specific is the key, the url, the
// returned shape and the write-through.
const TEAMS = [{ id: 11, user_id: 5, team_name: 'Team One' }];

const leagueResponse = (overrides = {}) => ({
  data: { league: { id: 1, name: 'Sunday Ballers', ...overrides }, teams: TEAMS },
});

const pending = () => {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
};

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.restoreAllMocks(); // the ttl test spies on Date.now; never let a failure leak it
  jest.clearAllMocks();
});

test('requests /api/league/:id and returns the row together with its teams', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result } = renderHook(() => useLeague(1));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1');
  expect(result.current.league).toEqual({ id: 1, name: 'Sunday Ballers' });
  expect(result.current.teams).toEqual(TEAMS);
  expect(result.current.error).toBeNull();
});

test('a null leagueId never requests and reads as an empty league', () => {
  const { result } = renderHook(() => useLeague(null));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.league).toBeNull();
  expect(result.current.teams).toEqual([]);
});

test('a league stays cached for a minute and is fetched again past that', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1000000);
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result, unmount } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  now.mockReturnValue(1000000 + 59000);
  const { result: withinTtl, unmount: unmountWithinTtl } = renderHook(() => useLeague(1));
  expect(withinTtl.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  unmountWithinTtl();

  now.mockReturnValue(1000000 + 61000);
  const { result: pastTtl } = renderHook(() => useLeague(1));
  expect(pastTtl.current.loading).toBe(true);
  await waitFor(() => expect(pastTtl.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

test('clearLeagueCache(id) reloads that league on screen and leaves the others cached', async () => {
  apiClient.get.mockImplementation((url) => (
    url.endsWith('/1') ? Promise.resolve(leagueResponse()) : Promise.resolve(leagueResponse({ id: 2, name: 'League Two' }))
  ));
  const { result: one } = renderHook(() => useLeague(1));
  const { result: two } = renderHook(() => useLeague(2));
  await waitFor(() => expect(one.current.loading).toBe(false));
  await waitFor(() => expect(two.current.loading).toBe(false));
  apiClient.get.mockClear();

  // useDraftAdmin clears after a settings save: the league on screen refreshes.
  apiClient.get.mockImplementation(() => Promise.resolve(leagueResponse({ name: 'Renamed by the commissioner' })));
  await act(async () => { clearLeagueCache(1); });

  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1');
  expect(one.current.league.name).toBe('Renamed by the commissioner');
  expect(two.current.league.name).toBe('League Two');
});

test('clearLeagueCache() with no id clears every league', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result, unmount } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  clearLeagueCache();
  apiClient.get.mockClear();
  const { result: second } = renderHook(() => useLeague(1));

  expect(second.current.loading).toBe(true);
  await waitFor(() => expect(second.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1');
});

test('updateLeague merges the change into the cached row, keeps the teams, and needs no request', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result: a } = renderHook(() => useLeague(1));
  const { result: b } = renderHook(() => useLeague(1));
  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));
  apiClient.get.mockClear();

  act(() => { a.current.updateLeague({ name: 'Renamed', draft_type: 'auction' }); });

  expect(a.current.league).toEqual({ id: 1, name: 'Renamed', draft_type: 'auction' });
  expect(a.current.teams).toEqual(TEAMS);
  expect(b.current.league.name).toBe('Renamed'); // every mount on the league
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('updateLeague merges into the row on screen, not into a store emptied by a reload', async () => {
  apiClient.get.mockResolvedValue(leagueResponse({ is_commissioner: true, pickem_only: false }));
  const { result } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));

  // A reload is out (the Retry button on the settings page, or useDraftAdmin
  // clearing after a save) and the store holds nothing for the key while it
  // is. The PUT lands in the middle of that.
  const reload = pending();
  apiClient.get.mockReturnValue(reload.promise);
  act(() => { clearLeagueCache(1); });

  // PUT /api/league/:id returns the bare leagues row: no is_commissioner.
  act(() => { result.current.updateLeague({ id: 1, name: 'Renamed', owner_id: 99 }); });

  expect(result.current.league).toEqual({
    id: 1,
    name: 'Renamed',
    owner_id: 99,
    is_commissioner: true, // never dropped, or the commissioner is demoted on screen
    pickem_only: false,
  });
  expect(result.current.teams).toEqual(TEAMS);

  // And the reload that was already on the wire cannot undo the write.
  await act(async () => { reload.resolve(leagueResponse({ is_commissioner: true })); });
  expect(result.current.league.name).toBe('Renamed');
});

test('updateLeague is a no-op without a league or without changes', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => { result.current.updateLeague(null); });
  expect(result.current.league).toEqual({ id: 1, name: 'Sunday Ballers' });

  const { result: none } = renderHook(() => useLeague(null));
  act(() => { none.current.updateLeague({ name: 'Nowhere' }); });
  expect(none.current.league).toBeNull();
});

// Deprecated, and kept only until the dashboard reads teams through the hook.
// The commit that migrates the dashboard deletes the function and these three.
test('primeLeagueCache(leagueId, payload) lets a later mount skip the request entirely', () => {
  primeLeagueCache(7, { league: { id: 7, name: 'Office Pool', pickem_only: true }, teams: TEAMS });

  const { result } = renderHook(() => useLeague(7));

  expect(result.current.league).toEqual({ id: 7, name: 'Office Pool', pickem_only: true });
  expect(result.current.teams).toEqual(TEAMS);
  expect(result.current.loading).toBe(false);
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('primeLeagueCache ignores a payload without a league row so a bad prime cannot poison the cache', async () => {
  primeLeagueCache(7, null);
  primeLeagueCache(7, { teams: TEAMS });
  apiClient.get.mockResolvedValue(leagueResponse({ id: 7 }));

  const { result } = renderHook(() => useLeague(7));
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/league/7');
});
