import { renderHook, waitFor } from '@testing-library/react';
import { dropSessionCaches } from './sessionCaches';
import { useLeague } from './hooks/useLeague';
import { usePickemStandings } from './hooks/usePickemStandings';
import { invalidate, setResource } from './lib/resourceCache';
import apiClient from './api/apiClient';

jest.mock('./api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Warms the shared league entry the way a visited page would.
const primeLeagueForTest = (leagueId, league) =>
  setResource(['league', leagueId], { league, teams: [] });

beforeEach(() => {
  // A never-settling request is the default here: it keeps the assertions
  // about the emptied caches unambiguous.
  apiClient.get.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  delete global.caches;
  invalidate(undefined, { reload: false });
  jest.clearAllMocks();
});

test('drops the offline API cache and every in-memory resource cache in one call', async () => {
  const deleted = [];
  global.caches = { delete: (name) => { deleted.push(name); return Promise.resolve(true); } };
  primeLeagueForTest(1, { id: 1, name: 'Previous account row', is_commissioner: true });

  dropSessionCaches();

  expect(deleted).toEqual(['api-cache-v1']);
  const { result } = renderHook(() => useLeague(1));
  expect(result.current.league).toBeNull();
  const { result: standings } = renderHook(() => usePickemStandings(1, 2026));
  expect(standings.current.data).toBeNull();
});

// A session drop forgets; it never reloads. login.saga drops caches while the
// outgoing session's token is still installed, so a reload from here would
// refill the store with that account's viewer-scoped rows; on logout the token
// is already cleared, so it would be an unauthenticated request.
test('does not make a mounted hook refetch (a session drop forgets, it never reloads)', async () => {
  apiClient.get.mockResolvedValue({ data: { league: { id: 1, name: 'Signed-in row' }, teams: [] } });
  const { result } = renderHook(() => useLeague(1));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  dropSessionCaches();

  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('is safe where the Cache API does not exist (jsdom, old browsers)', () => {
  expect(() => dropSessionCaches()).not.toThrow();
});
