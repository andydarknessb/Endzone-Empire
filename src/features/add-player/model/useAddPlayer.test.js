import { renderHook, act } from '@testing-library/react';
import React from 'react';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import { useAddPlayer } from './useAddPlayer';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const wrapper = ({ children }) => <SnackbarProvider>{children}</SnackbarProvider>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('useAddPlayer', () => {
  test('adds a player with no drop: only one POST, then onDone', async () => {
    apiClient.post.mockResolvedValue({});
    const onDone = jest.fn();
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4, onDone }), { wrapper });

    let outcome;
    await act(async () => {
      outcome = await result.current.addPlayer({ playerId: 9, playerName: 'Josh Palmer' });
    });

    expect(outcome).toEqual({ ok: true });
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

  test('a failed add with no drop reports the failure and returns ok:false without calling onDone', async () => {
    apiClient.post.mockRejectedValue({ response: { data: { message: 'Roster is full' } } });
    const onDone = jest.fn();
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4, onDone }), { wrapper });

    let outcome;
    await act(async () => {
      outcome = await result.current.addPlayer({ playerId: 9 });
    });

    expect(outcome).toEqual({ ok: false, message: 'Roster is full' });
    expect(onDone).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalledWith(expect.stringContaining('undo-drop'), expect.anything());
  });

  // Formal review round 1, f2: the drop already committed by the time the add
  // fails, so the manager must not be left one player down.
  test('a failed add AFTER a successful drop calls undo-drop for the dropped player and still reports the add failure', async () => {
    apiClient.delete.mockResolvedValue({});
    apiClient.post.mockImplementation((url) => {
      if (url === '/api/team/roster/9') return Promise.reject({ response: { data: { message: 'Player already claimed' } } });
      return Promise.resolve({});
    });
    const onDone = jest.fn();
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4, onDone }), { wrapper });

    let outcome;
    await act(async () => {
      outcome = await result.current.addPlayer({ playerId: 9, dropPlayerId: 20 });
    });

    expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/20?leagueId=4');
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/20/undo-drop', { leagueId: 4 });
    expect(outcome).toEqual({ ok: false, message: 'Player already claimed' });
    expect(onDone).not.toHaveBeenCalled();
  });

  // The recovery call's own failure must never mask the original add error.
  test('an undo-drop that itself fails still reports the original add failure', async () => {
    apiClient.delete.mockResolvedValue({});
    apiClient.post.mockImplementation((url) => {
      if (url === '/api/team/roster/9') return Promise.reject({ response: { data: { message: 'Player already claimed' } } });
      if (url === '/api/team/roster/20/undo-drop') return Promise.reject(new Error('undo window expired'));
      return Promise.resolve({});
    });
    const { result } = renderHook(() => useAddPlayer({ leagueId: 4 }), { wrapper });

    let outcome;
    await act(async () => {
      outcome = await result.current.addPlayer({ playerId: 9, dropPlayerId: 20 });
    });

    expect(outcome).toEqual({ ok: false, message: 'Player already claimed' });
  });
});
