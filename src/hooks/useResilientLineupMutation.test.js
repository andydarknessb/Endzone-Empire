import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../api/apiClient';
import { readPendingLineupMutations } from '../lib/pendingLineupMutations';
import useResilientLineupMutation from './useResilientLineupMutation';

jest.mock('../api/apiClient', () => ({
  __esModule: true,
  default: { put: jest.fn(), request: jest.fn() },
}));

function setOnline(value) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

const payload = { leagueId: 7, week: 3, moves: [{ playerId: 11, slot: 'WR' }] };
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
  apiClient.put.mockReset();
  apiClient.request.mockReset();
});

afterAll(() => setOnline(true));

test('online: a save that fails with no response rejects, queues nothing and fires no offline event', async () => {
  apiClient.put.mockRejectedValueOnce(networkError());
  const offline = jest.fn();
  window.addEventListener('offline', offline);
  const { result } = renderHook(() => useResilientLineupMutation());

  await expect(result.current.saveLineup(payload)).rejects.toThrow('Network Error');

  window.removeEventListener('offline', offline);
  expect(readPendingLineupMutations()).toEqual([]);
  expect(offline).not.toHaveBeenCalled();
  expect(result.current.online).toBe(true);
});

test('online: the save after a failed one issues a request', async () => {
  apiClient.put
    .mockRejectedValueOnce(networkError())
    .mockResolvedValueOnce({ status: 200, data: {} });
  const { result } = renderHook(() => useResilientLineupMutation());

  await expect(result.current.saveLineup(payload)).rejects.toThrow('Network Error');
  await expect(result.current.saveLineup(payload)).resolves.toEqual({
    queued: false,
    response: { status: 200, data: {} },
  });

  expect(apiClient.put).toHaveBeenCalledTimes(2);
});

test('offline: a save queues without a request and replays on the online event', async () => {
  setOnline(false);
  apiClient.request.mockResolvedValue({ status: 200, data: {} });
  const { result } = renderHook(() => useResilientLineupMutation());

  let outcome;
  await act(async () => {
    outcome = await result.current.saveLineup(payload);
  });

  expect(outcome).toEqual({ queued: true, intent: expect.any(Object) });
  expect(apiClient.put).not.toHaveBeenCalled();
  expect(readPendingLineupMutations()).toHaveLength(1);

  setOnline(true);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });

  await waitFor(() => expect(readPendingLineupMutations()).toEqual([]));
  expect(apiClient.request).toHaveBeenCalledTimes(1);
});
