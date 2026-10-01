import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import { clearWeekMatchupsCache, useWeekMatchups } from './useWeekMatchups';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Thin on purpose: the caching machinery is pinned in resourceCache.test.js and
// useResource.test.js. What is week-matchups-specific is the null contract, the
// per-week key, the row mapping and the TTL that lets a late mount share the read.
const row = (overrides = {}) => ({ id: 11, season: 2026, week: 4, home_team_id: 3, away_team_id: 7, ...overrides });

beforeEach(() => {
  invalidate(undefined, { reload: false });
  apiClient.get.mockReset();
});

afterEach(() => {
  invalidate(undefined, { reload: false });
  jest.clearAllMocks();
});

test('reads the league week and returns the rows as read models', async () => {
  apiClient.get.mockResolvedValue({ data: [row()] });
  const { result } = renderHook(() => useWeekMatchups(1, 4));

  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/matchups?week=4');
  expect(result.current.matchups).toHaveLength(1);
  expect(result.current.matchups[0]).toMatchObject({ id: 11, week: 4 });
  expect(result.current.error).toBeNull();
});

test.each([
  ['a null leagueId', null, 4],
  ['a null week', 1, null],
])('%s issues no GET and reports not loading', (_name, leagueId, week) => {
  const { result } = renderHook(() => useWeekMatchups(leagueId, week));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
  expect(result.current.matchups).toEqual([]);
});

test('enabled: false issues no GET', () => {
  const { result } = renderHook(() => useWeekMatchups(1, 4, { enabled: false }));

  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.loading).toBe(false);
});

test('a rejected GET sets error and leaves no matchups', async () => {
  apiClient.get.mockRejectedValue(new Error('boom'));
  const { result } = renderHook(() => useWeekMatchups(1, 4));

  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toBeTruthy();
  expect(result.current.matchups).toEqual([]);
});

test('a week change issues a GET of the new URL', async () => {
  apiClient.get.mockResolvedValue({ data: [row()] });
  const { result, rerender } = renderHook(({ week }) => useWeekMatchups(1, week), {
    initialProps: { week: 4 },
  });
  await waitFor(() => expect(result.current.loading).toBe(false));

  rerender({ week: 5 });
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/league/1/matchups?week=5')
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
});

test('a second mount of the same key inside the TTL issues no second GET', async () => {
  apiClient.get.mockResolvedValue({ data: [row()] });
  const { result: firstResult } = renderHook(() => useWeekMatchups(1, 4));
  await waitFor(() => expect(firstResult.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(1);

  const { result: secondResult } = renderHook(() => useWeekMatchups(1, 4));

  expect(secondResult.current.loading).toBe(false);
  expect(secondResult.current.matchups).toHaveLength(1);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

describe('clearWeekMatchupsCache', () => {
  test('reloads a mounted read of that league, and leaves another league alone', async () => {
    apiClient.get.mockResolvedValue({ data: [row()] });
    const { result } = renderHook(() => useWeekMatchups(1, 4));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    act(() => clearWeekMatchupsCache(2));
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    act(() => clearWeekMatchupsCache(1));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(apiClient.get).toHaveBeenLastCalledWith('/api/league/1/matchups?week=4');
  });

  test('with no id it clears every league', async () => {
    apiClient.get.mockResolvedValue({ data: [row()] });
    const { result } = renderHook(() => useWeekMatchups(1, 4));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => clearWeekMatchupsCache());
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });
});
