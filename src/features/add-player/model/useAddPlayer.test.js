import { renderHook, act } from '@testing-library/react';
import React from 'react';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import { useAddPlayer, sortRosterForDrop } from './useAddPlayer';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const wrapper = ({ children }) => <SnackbarProvider>{children}</SnackbarProvider>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('sortRosterForDrop', () => {
  test('sorts worst weekly projection first, unprojected last', () => {
    const roster = [
      { id: 1, projected_weekly_points: 15 },
      { id: 2, projected_weekly_points: 3.2 },
      { id: 3, projected_weekly_points: null },
      { id: 4, projected_weekly_points: 8 },
    ];
    expect(sortRosterForDrop(roster).map((p) => p.id)).toEqual([2, 4, 1, 3]);
  });
});

describe('useAddPlayer', () => {
  test('adds a player with no drop: only one POST, then onDone', async () => {
    apiClient.post.mockResolvedValue({});
    const onDone = jest.fn();
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4, onDone }), { wrapper });

    let ok;
    await act(async () => {
      ok = await result.current.addPlayer({ playerId: 9, playerName: 'Josh Palmer' });
    });

    expect(ok).toBe(true);
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/9', { leagueId: 4 });
    expect(onDone).toHaveBeenCalled();
  });

  test('a chosen drop is deleted before the add is posted', async () => {
    apiClient.delete.mockResolvedValue({});
    apiClient.post.mockResolvedValue({});
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4 }), { wrapper });

    await act(async () => {
      await result.current.addPlayer({ playerId: 9, dropPlayerId: 20 });
    });

    const deleteOrder = apiClient.delete.mock.invocationCallOrder[0];
    const postOrder = apiClient.post.mock.invocationCallOrder[0];
    expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/20?leagueId=4');
    expect(deleteOrder).toBeLessThan(postOrder);
  });

  test('a failed add reports the failure and returns false without calling onDone', async () => {
    apiClient.post.mockRejectedValue({ response: { data: { message: 'Roster is full' } } });
    const onDone = jest.fn();
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4, onDone }), { wrapper });

    let ok;
    await act(async () => {
      ok = await result.current.addPlayer({ playerId: 9 });
    });

    expect(ok).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });
});
