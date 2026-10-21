import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { COLLAPSED_ROWS, isSeasonAward, orderAwards, useTrophies } from './TrophyCase';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

const trophy = (id, season, week) => ({
  id, type: 'weekly_high', label: 'Weekly High Score', season, week, team_id: id, team_name: `T${id}`,
});

test('a null or zero week is a season award', () => {
  expect(isSeasonAward({ week: null })).toBe(true);
  expect(isSeasonAward({ week: 0 })).toBe(true);
  expect(isSeasonAward({ week: 4 })).toBe(false);
  expect(COLLAPSED_ROWS).toBe(6);
});

test('season awards come first, then weekly awards newest week first', () => {
  const ordered = orderAwards([trophy(1, 2026, 2), trophy(2, 2026, null), trophy(3, 2026, 4)]);
  expect(ordered.map((t) => t.id)).toEqual([2, 3, 1]);
});

describe('useTrophies', () => {
  test('defaults to the newest season and switches seasons without another request', async () => {
    apiClient.get.mockResolvedValue({ data: [trophy(1, 2025, 1), trophy(2, 2026, 2)] });
    const { result } = renderHook(() => useTrophies(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.season).toBe(2026);
    expect(result.current.seasonOptions).toEqual([2026, 2025]);
    expect(result.current.visibleTrophies.map((t) => t.id)).toEqual([2]);
  });

  test('a fetch error leaves no trophies and reports the message', async () => {
    apiClient.get.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTrophies(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.trophies).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });
});
