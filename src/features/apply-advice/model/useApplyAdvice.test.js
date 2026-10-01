import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import {
  LINEUP_MUTATION_REPLAYED_EVENT,
  PENDING_LINEUP_MUTATIONS_KEY,
  readPendingLineupMutations,
} from '../../../lib/pendingLineupMutations';
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

function setup(raw, onLanded) {
  let currentRaw = raw;
  const setRaw = jest.fn((updater) => {
    currentRaw = typeof updater === 'function' ? updater(currentRaw) : updater;
  });
  const { result } = renderHook(() => useApplyAdvice({ leagueId: 7, raw: currentRaw, setRaw, onLanded }));
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

// #1881: a save that lands changes Expected final, so the page's `onLanded`
// runs once it has (now, or when a queued write replays), never otherwise.
describe('onLanded after an apply (#1881)', () => {
  const PLAN = [{ playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' }];

  test('a save whose PUT resolves calls it once', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const onLanded = jest.fn();
    const { result } = setup(RAW, onLanded);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  test('a resolved save with no onLanded passed does not throw', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(mockNotify).toHaveBeenCalledWith('Lineup saved', { severity: 'success' });
  });

  test('a save refused with an HTTP error never calls it', async () => {
    apiClient.put.mockRejectedValue({ response: { status: 409, data: { error: 'locked' } } });
    const onLanded = jest.fn();
    const { result } = setup(RAW, onLanded);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(onLanded).not.toHaveBeenCalled();
  });

  test('a save queued offline calls it only once the replay lands', async () => {
    apiClient.put.mockRejectedValue({ message: 'Network Error', code: 'ERR_NETWORK' });
    const onLanded = jest.fn();
    const { result } = setup(RAW, onLanded);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(readPendingLineupMutations()).toHaveLength(1);
    expect(onLanded).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new CustomEvent(LINEUP_MUTATION_REPLAYED_EVENT, { detail: { queued: 1 } }));
    });
    expect(onLanded).toHaveBeenCalledTimes(1);
  });
});
