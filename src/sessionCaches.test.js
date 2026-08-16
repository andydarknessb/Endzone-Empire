import { renderHook } from '@testing-library/react';
import { dropSessionCaches } from './sessionCaches';
import { primeLeagueCache, useLeague } from './hooks/useLeague';
import { clearPickemStandingsCache, usePickemStandings } from './hooks/usePickemStandings';
import apiClient from './api/apiClient';

jest.mock('./api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

beforeEach(() => {
  // The hooks refetch after a drop; a never-settling request keeps the
  // assertions about the emptied caches unambiguous.
  apiClient.get.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  delete global.caches;
  clearPickemStandingsCache();
});

test('drops the offline API cache and every in-memory league cache in one call', async () => {
  const deleted = [];
  global.caches = { delete: (name) => { deleted.push(name); return Promise.resolve(true); } };
  primeLeagueCache(1, { id: 1, name: 'Previous account row', is_commissioner: true });

  dropSessionCaches();

  expect(deleted).toEqual(['api-cache-v1']);
  const { result } = renderHook(() => useLeague(1));
  expect(result.current.league).toBeNull();
  const { result: standings } = renderHook(() => usePickemStandings(1, 2026));
  expect(standings.current.data).toBeNull();
});

test('is safe where the Cache API does not exist (jsdom, old browsers)', () => {
  expect(() => dropSessionCaches()).not.toThrow();
});
