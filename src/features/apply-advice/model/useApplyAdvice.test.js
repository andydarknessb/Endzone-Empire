import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { PENDING_LINEUP_MUTATIONS_KEY } from '../../../lib/pendingLineupMutations';
import { useApplyAdvice } from './useApplyAdvice';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { put: jest.fn() },
}));

const mockNotify = jest.fn();
jest.mock('../../../components/Snackbar/SnackbarProvider', () => ({
  useSnackbar: () => mockNotify,
}));

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.removeItem(PENDING_LINEUP_MUTATIONS_KEY);
});

function setup(raw) {
  let currentRaw = raw;
  const setRaw = jest.fn((updater) => {
    currentRaw = typeof updater === 'function' ? updater(currentRaw) : updater;
  });
  const { result } = renderHook(() => useApplyAdvice({ leagueId: 7, raw: currentRaw, setRaw }));
  return { result, setRaw, getRaw: () => currentRaw };
}

const RAW = { week: 4, entries: [{ id: 1, slot: 'BENCH' }, { id: 2, slot: 'WR' }] };

test('sends exactly the named moves as one write, converting fromSlot/toSlot to the moves payload', async () => {
  apiClient.put.mockResolvedValue({ data: {} });
  const { result } = setup(RAW);

  await act(async () => {
    await result.current.apply([
      { playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' },
      { playerId: 2, fromSlot: 'WR', toSlot: 'BENCH' },
    ]);
  });

  expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
    leagueId: 7,
    week: 4,
    moves: [
      { playerId: 1, slot: 'WR' },
      { playerId: 2, slot: 'BENCH' },
    ],
  });
});

test('optimistically patches the slots named before the write resolves', () => {
  apiClient.put.mockReturnValue(new Promise(() => {}));
  const { result, getRaw } = setup(RAW);

  act(() => {
    result.current.apply([{ playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' }]);
  });

  expect(getRaw().entries.find((e) => e.id === 1).slot).toBe('WR');
});

test('an empty move plan writes nothing', async () => {
  const { result } = setup(RAW);
  await act(async () => {
    await result.current.apply([]);
  });
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a refused apply rolls the optimistic state back to the exact snapshot', async () => {
  apiClient.put.mockRejectedValue({ response: { status: 409, data: { error: 'locked' } } });
  const { result, getRaw } = setup(RAW);

  await act(async () => {
    await result.current.apply([{ playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' }]);
  });

  await waitFor(() => expect(getRaw()).toEqual(RAW));
  expect(mockNotify).toHaveBeenCalledWith(expect.any(String), { severity: 'error' });
});
