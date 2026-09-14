import React from 'react';
import { renderHook, act } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { SnackbarProvider } from '../../../components/Snackbar/SnackbarProvider';
import { useWatchPlayer } from './useWatchPlayer';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { put: jest.fn(), delete: jest.fn() },
}));

const wrapper = ({ children }) => <SnackbarProvider>{children}</SnackbarProvider>;

afterEach(() => jest.clearAllMocks());

test('toggling from not-watching PUTs the watch and reports watching: true', async () => {
  apiClient.put.mockResolvedValue({});
  const onDone = jest.fn();
  const { result } = renderHook(() => useWatchPlayer({ leagueId: 1, onDone }), { wrapper });

  let outcome;
  await act(async () => {
    outcome = await result.current.toggleWatch({ playerId: 7, watching: false });
  });

  expect(outcome).toEqual({ ok: true, watching: true });
  expect(apiClient.put).toHaveBeenCalledWith('/api/players/7/watch', null, { params: { leagueId: 1 } });
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalled();
});

test('toggling from watching DELETEs the watch and reports watching: false', async () => {
  apiClient.delete.mockResolvedValue({});
  const { result } = renderHook(() => useWatchPlayer({ leagueId: 1 }), { wrapper });

  let outcome;
  await act(async () => {
    outcome = await result.current.toggleWatch({ playerId: 7, watching: true });
  });

  expect(outcome).toEqual({ ok: true, watching: false });
  expect(apiClient.delete).toHaveBeenCalledWith('/api/players/7/watch', { params: { leagueId: 1 } });
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a failed toggle reports the failure and returns ok:false with the message, never calling onDone', async () => {
  apiClient.put.mockRejectedValue({ response: { data: { message: 'Player not found' } } });
  const onDone = jest.fn();
  const { result } = renderHook(() => useWatchPlayer({ leagueId: 1, onDone }), { wrapper });

  let outcome;
  await act(async () => {
    outcome = await result.current.toggleWatch({ playerId: 7, watching: false });
  });

  expect(outcome).toEqual({ ok: false, message: 'Player not found' });
  expect(onDone).not.toHaveBeenCalled();
});
