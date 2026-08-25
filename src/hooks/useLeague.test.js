import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate } from '../lib/resourceCache';
import { clearLeagueCache, useLeague } from './useLeague';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js
// and useResource.test.js. What is league-specific is the key, the url, the
// returned shape and the write-through.
const TEAMS = [{ teamId: 11, teamName: 'Team One' }];

const leagueResponse = (overrides = {}) => ({
  data: { viewerTeamId: 11, league: { id: 1, name: 'Sunday Ballers', ...overrides }, teams: TEAMS },
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
  expect(result.current.viewerTeamId).toBe(11);
  expect(result.current.error).toBeNull();
});

test('surfaces viewerTeamId from the response root, and keeps it through a write-through', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));

  // The viewer-relative field lives at the root of the response, beside
  // `league` and `teams`, and is how a consumer answers "which of these is
  // me" without holding another manager's account id (#113, contract #112).
  expect(result.current.viewerTeamId).toBe(11);

  // Both write-throughs rebuild the cached value, so either could silently
  // drop a root field that neither of them is about.
  act(() => { result.current.updateLeague({ name: 'Renamed' }); });
  expect(result.current.viewerTeamId).toBe(11);
  act(() => { result.current.updateTeams((teams) => [...teams]); });
  expect(result.current.viewerTeamId).toBe(11);
});

test('a null leagueId never requests and reads as an empty league', () => {
  const { result } = renderHook(() => useLeague(null));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.league).toBeNull();
  expect(result.current.teams).toEqual([]);
  expect(result.current.viewerTeamId).toBeNull();
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
  // setResource replaces the cached entry whole; a write-through that forgot
  // this field would silently null it out for every mount, unguarding the
  // removable-teams filter in CommissionerTools (#185) for the rest of the TTL.
  expect(a.current.viewerTeamId).toBe(11);
  expect(b.current.league.name).toBe('Renamed'); // every mount on the league
  expect(b.current.viewerTeamId).toBe(11);
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

test('updateTeams patches the membership through the updater, keeps the league row, and needs no request', async () => {
  apiClient.get.mockResolvedValue(leagueResponse());
  const { result: a } = renderHook(() => useLeague(1));
  const { result: b } = renderHook(() => useLeague(1));
  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));
  apiClient.get.mockClear();

  // The dashboard's avatar patch: a team-profile event rewrites one row.
  act(() => {
    a.current.updateTeams((teams) => teams.map((team) => ({ ...team, avatar_url: '/a.png' })));
  });

  expect(a.current.teams).toEqual([{ ...TEAMS[0], avatar_url: '/a.png' }]);
  expect(a.current.league).toEqual({ id: 1, name: 'Sunday Ballers' }); // the row survives
  expect(a.current.viewerTeamId).toBe(11); // and so does which team is the viewer's own (#185)
  expect(b.current.teams[0].avatar_url).toBe('/a.png'); // every mount on the league
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('updateTeams stands down while a reload is in flight, so the reload still lands', async () => {
  apiClient.get.mockResolvedValue(leagueResponse({ current_week: 3 }));
  const { result: a } = renderHook(() => useLeague(1));
  const { result: b } = renderHook(() => useLeague(1));
  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));

  // Advance Week refetches, and a team-profile event lands while that GET is
  // still on the wire. A write-through now would bump the generation, the
  // store would refuse the response, and every mount would keep showing the
  // pre-advance row as fresh for the rest of the TTL.
  const reload = pending();
  apiClient.get.mockReturnValue(reload.promise);
  let refetched;
  act(() => { refetched = a.current.refetch(); });
  act(() => {
    a.current.updateTeams((teams) => teams.map((team) => ({ ...team, avatar_url: '/a.png' })));
  });

  await act(async () => {
    reload.resolve(leagueResponse({ current_week: 4 }));
    await refetched;
  });

  expect(a.current.league.current_week).toBe(4);
  expect(b.current.league.current_week).toBe(4); // and no sibling is left behind
  expect(a.current.teams).toEqual(TEAMS); // the write-through stood down, so the reload's membership won
});

test('updateTeams is a no-op before a league is on screen: the load in flight brings the avatars', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useLeague(1));

  act(() => { result.current.updateTeams((teams) => [...teams, { id: 12 }]); });

  expect(result.current.teams).toEqual([]);
  expect(result.current.loading).toBe(true); // still waiting, not answered by a write
});
