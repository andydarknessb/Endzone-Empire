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

const RAW = { week: 4, teamId: 9, entries: [{ id: 1, slot: 'BENCH' }, { id: 2, slot: 'WR' }] };

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

    expect(mockNotify).toHaveBeenCalledWith('Lineup saved', expect.objectContaining({ severity: 'success' }));
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

// #1964: a save that lands right away offers Undo on its toast; the undo
// writes each moved player back to the slot the pre-move snapshot held.
describe('Undo on the Lineup saved toast (#1964)', () => {
  const PLAN = [
    { playerId: 1, fromSlot: 'BENCH', toSlot: 'WR' },
    { playerId: 2, fromSlot: 'WR', toSlot: 'BENCH' },
  ];

  test('a landed save notifies with an Undo action', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(mockNotify).toHaveBeenCalledWith('Lineup saved', {
      severity: 'success',
      actionLabel: 'Undo',
      onAction: expect.any(Function),
    });
  });

  test('invoking Undo saves the inverse moves, then notifies Lineup restored with no Undo', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const onLanded = jest.fn();
    const { result, getRaw } = setup(RAW, onLanded);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    expect(getRaw().entries).toEqual([{ id: 1, slot: 'WR' }, { id: 2, slot: 'BENCH' }]);
    const { onAction } = mockNotify.mock.calls[0][1];

    await act(async () => {
      await onAction();
    });

    expect(apiClient.put).toHaveBeenLastCalledWith('/api/team/lineup', {
      leagueId: 7,
      week: 4,
      moves: [
        { playerId: 1, slot: 'BENCH' },
        { playerId: 2, slot: 'WR' },
      ],
    });
    expect(mockNotify).toHaveBeenLastCalledWith('Lineup restored', { severity: 'success' });
    expect(getRaw().entries).toEqual(RAW.entries);
    expect(onLanded).toHaveBeenCalledTimes(2);
  });

  // #1969: the save's answer says which side effects an Undo cannot reverse.
  test('a save that ended an IR override says so and offers no Undo', async () => {
    apiClient.put.mockResolvedValue({ data: { attestationCleared: [1], calledShotVoided: false } });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(mockNotify).toHaveBeenCalledWith(
      'Lineup saved. This move ended a commissioner IR override and cannot be undone',
      { severity: 'success' }
    );
  });

  // A save that does both names both; neither can be undone, so no Undo.
  test('a save that ended an IR override and voided a called shot names both and offers no Undo', async () => {
    apiClient.put.mockResolvedValue({ data: { attestationCleared: [1], calledShotVoided: true } });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(mockNotify).toHaveBeenCalledWith(
      'Lineup saved. This move ended a commissioner IR override and voided your called shot. It cannot be undone',
      { severity: 'success' }
    );
  });

  test('a save that voided a called shot says so; its Undo restores and says the shot stays void', async () => {
    apiClient.put.mockResolvedValue({ data: { calledShotVoided: true, attestationCleared: [] } });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    expect(mockNotify).toHaveBeenCalledWith('Lineup saved. Your called shot was voided', {
      severity: 'success',
      actionLabel: 'Undo',
      onAction: expect.any(Function),
    });

    await act(async () => {
      await mockNotify.mock.calls[0][1].onAction();
    });

    expect(mockNotify).toHaveBeenLastCalledWith('Lineup restored. Your called shot is still void', { severity: 'success' });
  });

  test('a response with neither key keeps Lineup saved with Undo, and Lineup restored', async () => {
    apiClient.put.mockResolvedValue({ data: { updated: 2 } });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    expect(mockNotify).toHaveBeenCalledWith('Lineup saved', expect.objectContaining({ actionLabel: 'Undo' }));
    await act(async () => {
      await mockNotify.mock.calls[0][1].onAction();
    });

    expect(mockNotify).toHaveBeenLastCalledWith('Lineup restored', { severity: 'success' });
  });

  test('a refused Undo rolls back to the moved lineup and carries no Undo', async () => {
    apiClient.put.mockResolvedValueOnce({ data: {} });
    const { result, getRaw } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    apiClient.put.mockRejectedValue({ response: { status: 409, data: { error: 'locked' } } });

    await act(async () => {
      await onAction();
    });

    expect(mockNotify).toHaveBeenLastCalledWith(expect.any(String), { severity: 'error' });
    expect(getRaw().entries).toEqual([{ id: 1, slot: 'WR' }, { id: 2, slot: 'BENCH' }]);
  });

  // Newer fields a live score tick or silent refetch lands mid-request.
  const refreshed = (prev) => ({
    ...prev,
    entries: prev.entries.map((e) => (e.id === 1 ? { ...e, actualPoints: 12.5, locked: true } : e)),
  });

  test('a refused apply rolls back only the moved slots, keeping newer fields', async () => {
    let reject;
    apiClient.put.mockReturnValue(new Promise((_, rej) => { reject = rej; }));
    const { result, setRaw, getRaw } = setup(RAW);

    let applied;
    act(() => { applied = result.current.apply(PLAN); });
    act(() => setRaw(refreshed));
    await act(async () => {
      reject({ response: { status: 409, data: { error: 'locked' } } });
      await applied;
    });

    expect(getRaw().entries).toEqual([
      { id: 1, slot: 'BENCH', actualPoints: 12.5, locked: true },
      { id: 2, slot: 'WR' },
    ]);
  });

  test('a refused Undo re-applies the moved slots over newer fields', async () => {
    apiClient.put.mockResolvedValueOnce({ data: {} });
    const { result, setRaw, getRaw } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    let reject;
    apiClient.put.mockReturnValue(new Promise((_, rej) => { reject = rej; }));

    let undone;
    act(() => { undone = onAction(); });
    act(() => setRaw(refreshed));
    await act(async () => {
      reject({ response: { status: 409, data: { error: 'locked' } } });
      await undone;
    });

    expect(getRaw().entries).toEqual([
      { id: 1, slot: 'WR', actualPoints: 12.5, locked: true },
      { id: 2, slot: 'BENCH' },
    ]);
  });

  test('Undo never patches or rolls back a different lineup, but still writes to the moved week', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result, setRaw, getRaw } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    const week5 = { week: 5, teamId: 9, entries: [{ id: 1, slot: 'WR' }, { id: 2, slot: 'BENCH' }] };
    act(() => setRaw(() => week5));

    await act(async () => {
      await onAction();
    });

    expect(apiClient.put).toHaveBeenLastCalledWith('/api/team/lineup', expect.objectContaining({ week: 4 }));
    expect(getRaw()).toBe(week5);
  });

  test('Undo never patches a different team lineup in the same week', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result, setRaw, getRaw } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    const otherTeam = { week: 4, teamId: 10, entries: [{ id: 1, slot: 'WR' }, { id: 2, slot: 'BENCH' }] };
    act(() => setRaw(() => otherTeam));

    await act(async () => {
      await onAction();
    });

    expect(getRaw()).toBe(otherTeam);
  });

  test('a refused apply leaves a slot a newer write has since moved, and reverts the rest', async () => {
    let reject;
    apiClient.put.mockReturnValue(new Promise((_, rej) => { reject = rej; }));
    const { result, setRaw, getRaw } = setup(RAW);

    let applied;
    act(() => { applied = result.current.apply(PLAN); });
    act(() => setRaw((prev) => ({ ...prev, entries: prev.entries.map((e) => (e.id === 2 ? { ...e, slot: 'FLEX' } : e)) })));
    await act(async () => {
      reject({ response: { status: 409, data: { error: 'locked' } } });
      await applied;
    });

    expect(getRaw().entries).toEqual([{ id: 1, slot: 'BENCH' }, { id: 2, slot: 'FLEX' }]);
  });

  test('a save queued offline has no Undo', async () => {
    apiClient.put.mockRejectedValue({ message: 'Network Error', code: 'ERR_NETWORK' });
    const { result } = setup(RAW);

    await act(async () => {
      await result.current.apply(PLAN);
    });

    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining('saved offline'), { severity: 'info' });
  });
});
