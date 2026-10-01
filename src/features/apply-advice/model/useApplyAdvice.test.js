import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import {
  LINEUP_MUTATION_REPLAYED_EVENT,
  PENDING_LINEUP_MUTATIONS_KEY,
  readPendingLineupMutations,
} from '../../../lib/pendingLineupMutations';
import { read, setResource, invalidate } from '../../../lib/resourceCache';
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
  invalidate(undefined, { reload: false });
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

// #1881: the week's Matchups list carries Expected final, which an applied
// plan changes, so a save that lands clears the cached list (30 s TTL, #1877).
describe('matchups list cache after an apply (#1881)', () => {
  const MATCHUPS_KEY = ['league-matchups', 7, 4];
  const PLAN = [{ playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' }];

  test('a save whose PUT resolves clears the cached list', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    setResource(MATCHUPS_KEY, []);
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(read(MATCHUPS_KEY)).toBeUndefined();
  });

  test('a save refused with an HTTP error leaves the cached list', async () => {
    apiClient.put.mockRejectedValue({ response: { status: 409, data: { error: 'locked' } } });
    setResource(MATCHUPS_KEY, []);
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(read(MATCHUPS_KEY)).toBeDefined();
  });

  test('a save queued offline leaves the cached list until the replay lands', async () => {
    apiClient.put.mockRejectedValue({ message: 'Network Error', code: 'ERR_NETWORK' });
    setResource(MATCHUPS_KEY, []);
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(readPendingLineupMutations()).toHaveLength(1);
    expect(read(MATCHUPS_KEY)).toBeDefined();

    act(() => {
      window.dispatchEvent(new CustomEvent(LINEUP_MUTATION_REPLAYED_EVENT, { detail: { queued: 1 } }));
    });
    expect(read(MATCHUPS_KEY)).toBeUndefined();
  });
});
