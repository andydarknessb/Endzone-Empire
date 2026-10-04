import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import { useTeamLineup } from './useTeamLineup';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The read is a shared cached resource (ADR 0004), module state that outlives a
// test, so it is cleared whole.
beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const body = {
  leagueId: 7,
  teamId: 3,
  season: 2026,
  week: 4,
  currentWeek: 4,
  entries: [
    { id: 1, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', slot: 'QB', projected_points: 24.3, injury_status: null },
  ],
};

test('fetches GET /api/team/lineup with leagueId and week, mapped through lineupModel', async () => {
  apiClient.get.mockResolvedValue({ data: body });

  const { result } = renderHook(() => useTeamLineup(7, 4));

  await waitFor(() => expect(result.current.lineup).not.toBeNull());
  expect(apiClient.get).toHaveBeenCalledWith('/api/team/lineup?leagueId=7&week=4');
  expect(result.current.lineup.starters).toHaveLength(1);
  expect(result.current.lineup.week).toBe(4);
});

test('a null leagueId binds no URL: the apiClient mock is never called', async () => {
  renderHook(() => useTeamLineup(null, 4));
  // There is nothing to await for (a null url idles forever), so a microtask
  // flush is enough to prove no fetch was ever scheduled.
  await Promise.resolve();
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('a null week binds no URL: the apiClient mock is never called', async () => {
  renderHook(() => useTeamLineup(7, null));
  await Promise.resolve();
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('two mounts of the same league and week share one GET', async () => {
  apiClient.get.mockResolvedValue({ data: body });

  const first = renderHook(() => useTeamLineup(7, 4));
  const second = renderHook(() => useTeamLineup(7, 4));

  await waitFor(() => expect(first.result.current.lineup).not.toBeNull());
  await waitFor(() => expect(second.result.current.lineup).not.toBeNull());
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});

test('a failed read reports error and no lineup', async () => {
  apiClient.get.mockRejectedValue({ response: { status: 500, data: { error: 'boom' } } });

  const { result } = renderHook(() => useTeamLineup(7, 4));

  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.lineup).toBeNull();
  expect(result.current.loading).toBe(false);
});

test('a settled read is not served to a later mount: it reads again (a saved lineup must show)', async () => {
  apiClient.get.mockResolvedValue({ data: body });

  const first = renderHook(() => useTeamLineup(7, 4));
  await waitFor(() => expect(first.result.current.lineup).not.toBeNull());
  first.unmount();

  const second = renderHook(() => useTeamLineup(7, 4));
  // The cached copy may paint, but the lineup is withheld while it reloads.
  expect(second.result.current.lineup).toBeNull();
  expect(second.result.current.loading).toBe(true);
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
