import { renderHook, act, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import useMyRoster from './useMyRoster';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

beforeEach(() => {
  apiClient.get.mockResolvedValue({ data: [] });
});

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches the roster on mount, scoped to the league', async () => {
  apiClient.get.mockResolvedValue({
    data: [{ id: 5, name: 'Travis Kelce', position: 'TE', nfl_team: 'KC', bye_week: 10 }],
  });
  const { result } = renderHook(() => useMyRoster(7));

  await waitFor(() => expect(result.current.roster).toHaveLength(1));
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/roster', { params: { leagueId: 7 } });
  expect(result.current.roster[0].name).toBe('Travis Kelce');
});

test('a non-array response (e.g. a spectator with no team) degrades to an empty roster', async () => {
  apiClient.get.mockResolvedValue({ data: { unexpected: 'shape' } });
  const { result } = renderHook(() => useMyRoster(7));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(result.current.roster).toEqual([]);
});

test('a fetch error degrades to an empty roster rather than throwing', async () => {
  apiClient.get.mockRejectedValue(new Error('network down'));
  const { result } = renderHook(() => useMyRoster(7));

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(result.current.roster).toEqual([]);
});

test('a slower superseded refetch cannot clobber a faster, later one', async () => {
  let resolveFirst;
  apiClient.get
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ data: [{ id: 1, name: 'Fresh Pick', position: 'RB', nfl_team: 'DAL', bye_week: 6 }] });

  const { result } = renderHook(() => useMyRoster(7));
  // The mount fetch is still pending (resolveFirst not yet called) when a
  // second, faster refetch is triggered and resolves first.
  await act(async () => {
    result.current.refetchRoster();
  });
  await waitFor(() => expect(result.current.roster).toHaveLength(1));
  expect(result.current.roster[0].name).toBe('Fresh Pick');

  // The stale mount-time request now resolves late - it must NOT overwrite
  // the fresher roster state already rendered above.
  await act(async () => {
    resolveFirst({ data: [{ id: 99, name: 'Stale Pick', position: 'WR', nfl_team: 'ATL', bye_week: 9 }] });
  });
  expect(result.current.roster).toHaveLength(1);
  expect(result.current.roster[0].name).toBe('Fresh Pick');
});
