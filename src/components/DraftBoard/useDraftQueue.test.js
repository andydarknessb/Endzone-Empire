import { renderHook, act } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import useDraftQueue from './useDraftQueue';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn() },
}));

jest.mock('../Snackbar/SnackbarProvider', () => ({
  useSnackbar: () => () => {},
}));

const player = (id) => ({ id, name: `Player ${id}` });

afterEach(() => jest.clearAllMocks());

test('a queue read issued before a write does not revert that write when it lands late (#2765 4)', async () => {
  let resolveRead;
  apiClient.get.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
  apiClient.put.mockResolvedValue({ data: {} });
  const { result } = renderHook(() => useDraftQueue(3));

  act(() => result.current.handleQueuePlayer(player(1)));
  expect(result.current.queue.map((p) => p.id)).toEqual([1]);

  // The mount read was issued before the write; it answers with the old, empty queue.
  await act(async () => resolveRead({ data: [] }));

  expect(result.current.queue.map((p) => p.id)).toEqual([1]);
  expect(result.current.loading).toBe(false);
});
