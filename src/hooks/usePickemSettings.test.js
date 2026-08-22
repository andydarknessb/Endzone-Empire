import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { invalidate } from '../lib/resourceCache';
import { clearPickemSettingsCache, setPickemSettings, usePickemSettings } from './usePickemSettings';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js
// and useResource.test.js. What is settings-specific is the key, the url, the
// returned shape and the write-through a successful PUT feeds.
const settingsResponse = (overrides = {}) => ({
  data: { league_id: 7, mode: 'straight', lock_policy: 'kickoff', ...overrides },
});

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.clearAllMocks();
});

test('requests /api/pickem/league/:id/settings and returns the row as settings', async () => {
  apiClient.get.mockResolvedValue(settingsResponse());
  const { result } = renderHook(() => usePickemSettings(7));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/pickem/league/7/settings');
  expect(result.current.settings).toEqual({ league_id: 7, mode: 'straight', lock_policy: 'kickoff' });
  expect(result.current.error).toBeNull();
});

test('a null leagueId never requests', () => {
  const { result } = renderHook(() => usePickemSettings(null));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.settings).toBeNull();
});

test('setPickemSettings pushes the saved row to every mount with no request', async () => {
  apiClient.get.mockResolvedValue(settingsResponse());
  const { result: a } = renderHook(() => usePickemSettings(7));
  const { result: b } = renderHook(() => usePickemSettings(7));
  await waitFor(() => expect(a.current.loading).toBe(false));
  await waitFor(() => expect(b.current.loading).toBe(false));
  apiClient.get.mockClear();

  act(() => { setPickemSettings(7, { league_id: 7, mode: 'confidence', lock_policy: 'kickoff' }); });

  expect(a.current.settings.mode).toBe('confidence');
  expect(b.current.settings.mode).toBe('confidence');
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('setPickemSettings ignores an empty row or a missing league', async () => {
  apiClient.get.mockResolvedValue(settingsResponse());
  const { result } = renderHook(() => usePickemSettings(7));
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => { setPickemSettings(7, null); });
  act(() => { setPickemSettings(null, { mode: 'confidence' }); });

  expect(result.current.settings.mode).toBe('straight');
});

test('clearPickemSettingsCache(id) drops that league and leaves the others cached', async () => {
  apiClient.get.mockImplementation((url) => (
    url.includes('/league/7/') ? Promise.resolve(settingsResponse()) : Promise.resolve(settingsResponse({ league_id: 8 }))
  ));
  const { result: seven, unmount: unmountSeven } = renderHook(() => usePickemSettings(7));
  const { result: eight, unmount: unmountEight } = renderHook(() => usePickemSettings(8));
  await waitFor(() => expect(seven.current.loading).toBe(false));
  await waitFor(() => expect(eight.current.loading).toBe(false));
  unmountSeven();
  unmountEight();
  apiClient.get.mockClear();

  clearPickemSettingsCache(7);

  const { result: sevenAgain } = renderHook(() => usePickemSettings(7));
  expect(sevenAgain.current.loading).toBe(true);
  await waitFor(() => expect(sevenAgain.current.loading).toBe(false));
  const { result: eightAgain } = renderHook(() => usePickemSettings(8));
  expect(eightAgain.current.loading).toBe(false);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('clearPickemSettingsCache() with no id clears every league', async () => {
  apiClient.get.mockResolvedValue(settingsResponse());
  const { result, unmount } = renderHook(() => usePickemSettings(7));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();

  clearPickemSettingsCache();
  apiClient.get.mockClear();

  const { result: second } = renderHook(() => usePickemSettings(7));
  expect(second.current.loading).toBe(true);
  await waitFor(() => expect(second.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
