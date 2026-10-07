import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { clearWeekMatchupsCache } from '../../../entities/matchup';
import {
  LINEUP_MUTATION_REPLAYED_EVENT,
  PENDING_LINEUP_MUTATIONS_KEY,
  readPendingLineupMutations,
} from '../../../lib/pendingLineupMutations';
import { useApplyAdvice } from './useApplyAdvice';
import { useLineupWrite } from './useLineupWrite';
import { useSwapPlayers } from './useSwapPlayers';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { put: jest.fn() },
}));

jest.mock('../../../entities/matchup', () => ({ clearWeekMatchupsCache: jest.fn() }));

const mockNotify = jest.fn();
jest.mock('../../../components/Snackbar/SnackbarProvider', () => ({
  useSnackbar: () => mockNotify,
}));

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.removeItem(PENDING_LINEUP_MUTATIONS_KEY);
});

const RAW = { week: 4, teamId: 9, entries: [{ id: 1, slot: 'BENCH' }, { id: 2, slot: 'WR' }] };
const MOVES = [
  { playerId: 1, slot: 'WR' },
  { playerId: 2, slot: 'BENCH' },
];

function setup(raw = RAW) {
  let currentRaw = raw;
  const setRaw = jest.fn((updater) => {
    currentRaw = typeof updater === 'function' ? updater(currentRaw) : updater;
  });
  const { result } = renderHook(() => useLineupWrite({ leagueId: 7, raw: currentRaw, setRaw }));
  return { result, setRaw, getRaw: () => currentRaw };
}

const refused = (status = 409) => ({ response: { status, data: { error: 'locked' } } });
const offline = () => ({ message: 'Network Error', code: 'ERR_NETWORK' });
const replayed = (detail) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(LINEUP_MUTATION_REPLAYED_EVENT, { detail }));
  });
const LINEUP_REPLAY = { intent: { endpoint: '/api/team/lineup' }, status: 200, data: { undoable: true, irreversible: [] } };

test('sends the moves as one write and patches the slots before it resolves', () => {
  apiClient.put.mockReturnValue(new Promise(() => {}));
  const { result, getRaw } = setup();

  act(() => {
    result.current.submit(MOVES);
  });

  expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', { leagueId: 7, week: 4, moves: MOVES });
  expect(getRaw().entries).toEqual([{ id: 1, slot: 'WR' }, { id: 2, slot: 'BENCH' }]);
});

test('a refused save rolls the optimistic state back to the exact snapshot and shows the server message', async () => {
  apiClient.put.mockRejectedValue(refused());
  const { result, getRaw } = setup();

  await act(async () => {
    await result.current.submit(MOVES);
  });

  expect(getRaw()).toEqual(RAW);
  expect(mockNotify).toHaveBeenCalledWith(expect.any(String), { severity: 'error' });
});

describe('Matchups cache invalidation (#1881)', () => {
  test('a save whose PUT resolves clears the league\'s cache once', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });

    expect(clearWeekMatchupsCache).toHaveBeenCalledTimes(1);
    expect(clearWeekMatchupsCache).toHaveBeenCalledWith(7);
  });

  test('a save refused with an HTTP error never clears it', async () => {
    apiClient.put.mockRejectedValue(refused());
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });

    expect(clearWeekMatchupsCache).not.toHaveBeenCalled();
  });

  test('a save queued offline clears it only once the replay lands', async () => {
    apiClient.put.mockRejectedValue(offline());
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });
    expect(readPendingLineupMutations()).toHaveLength(1);
    expect(clearWeekMatchupsCache).not.toHaveBeenCalled();

    replayed(LINEUP_REPLAY);
    expect(clearWeekMatchupsCache).toHaveBeenCalledTimes(1);
  });
});

// One replay subscriber (spec #2042): the page mounts the write once, with swap
// and apply advice both feeding it, and a replayed save must toast once.
describe('a replayed offline save', () => {
  const mountPage = () => {
    const raw = { ...RAW, rosterSlots: undefined };
    return renderHook(() => {
      const { submit } = useLineupWrite({ leagueId: 7, raw, setRaw: jest.fn() });
      return {
        swap: useSwapPlayers({ submit, raw, entries: [] }),
        advice: useApplyAdvice({ submit }),
      };
    });
  };

  test('with swap and apply advice both mounted, fires one toast and one invalidation', () => {
    mountPage();

    replayed(LINEUP_REPLAY);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith('Lineup saved', { severity: 'success' });
    expect(clearWeekMatchupsCache).toHaveBeenCalledTimes(1);
  });

  test('carries the same disclosures as an online save, and no Undo', () => {
    mountPage();

    replayed({ ...LINEUP_REPLAY, data: { undoable: false, irreversible: ['ir_override', 'called_shot'] } });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(
      'Lineup saved. This move ended a commissioner IR override and voided your called shot. It cannot be undone',
      { severity: 'success' }
    );
  });

  test('a replayed voided shot alone is named and offers no Undo', () => {
    mountPage();

    replayed({ ...LINEUP_REPLAY, data: { undoable: false, irreversible: ['called_shot'] } });

    expect(mockNotify).toHaveBeenCalledWith('Lineup saved. Your called shot was voided', { severity: 'success' });
  });

  test('a replayed /correct-week intent says "Week corrected" and still clears the cache', () => {
    mountPage();

    replayed({ intent: { endpoint: '/api/scoring/league/7/correct-week' }, status: 200, data: {} });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith('Week corrected', { severity: 'success' });
    expect(clearWeekMatchupsCache).toHaveBeenCalledTimes(1);
  });
});

// #1964: a save that lands right away offers Undo on its toast; the undo
// writes each moved player back to the slot the pre-move snapshot held.
describe('Undo on the Lineup saved toast (#1964)', () => {
  test('a landed save notifies with an Undo action', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });

    expect(mockNotify).toHaveBeenCalledWith('Lineup saved', {
      severity: 'success',
      actionLabel: 'Undo',
      onAction: expect.any(Function),
    });
  });

  test('invoking Undo saves the inverse moves, then notifies Lineup restored with no Undo', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result, getRaw } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
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
    expect(clearWeekMatchupsCache).toHaveBeenCalledTimes(2);
  });

  // #1969: the save's answer says which side effects an Undo cannot reverse.
  test('a save that ended an IR override offers no Undo', async () => {
    apiClient.put.mockResolvedValue({ data: { undoable: false, irreversible: ['ir_override'] } });
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });

    expect(mockNotify).toHaveBeenCalledWith(
      'Lineup saved. This move ended a commissioner IR override and cannot be undone',
      { severity: 'success' }
    );
  });

  test('a save that voided a called shot says so; its Undo restores and says the shot stays void', async () => {
    apiClient.put.mockResolvedValue({ data: { undoable: false, irreversible: ['called_shot'] } });
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
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

  test('a refused Undo rolls back to the moved lineup and carries no Undo', async () => {
    apiClient.put.mockResolvedValueOnce({ data: {} });
    const { result, getRaw } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    apiClient.put.mockRejectedValue(refused());

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

  test('a refused save rolls back only the moved slots, keeping newer fields', async () => {
    let reject;
    apiClient.put.mockReturnValue(new Promise((_, rej) => { reject = rej; }));
    const { result, setRaw, getRaw } = setup();

    let submitted;
    act(() => { submitted = result.current.submit(MOVES); });
    act(() => setRaw(refreshed));
    await act(async () => {
      reject(refused());
      await submitted;
    });

    expect(getRaw().entries).toEqual([
      { id: 1, slot: 'BENCH', actualPoints: 12.5, locked: true },
      { id: 2, slot: 'WR' },
    ]);
  });

  test('a refused Undo re-applies the moved slots over newer fields', async () => {
    apiClient.put.mockResolvedValueOnce({ data: {} });
    const { result, setRaw, getRaw } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    let reject;
    apiClient.put.mockReturnValue(new Promise((_, rej) => { reject = rej; }));

    let undone;
    act(() => { undone = onAction(); });
    act(() => setRaw(refreshed));
    await act(async () => {
      reject(refused());
      await undone;
    });

    expect(getRaw().entries).toEqual([
      { id: 1, slot: 'WR', actualPoints: 12.5, locked: true },
      { id: 2, slot: 'BENCH' },
    ]);
  });

  test('Undo never patches or rolls back a different lineup, but still writes to the moved week', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const { result, setRaw, getRaw } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
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
    const { result, setRaw, getRaw } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });
    const { onAction } = mockNotify.mock.calls[0][1];
    const otherTeam = { week: 4, teamId: 10, entries: [{ id: 1, slot: 'WR' }, { id: 2, slot: 'BENCH' }] };
    act(() => setRaw(() => otherTeam));

    await act(async () => {
      await onAction();
    });

    expect(getRaw()).toBe(otherTeam);
  });

  test('a refused save leaves a slot a newer write has since moved, and reverts the rest', async () => {
    let reject;
    apiClient.put.mockReturnValue(new Promise((_, rej) => { reject = rej; }));
    const { result, setRaw, getRaw } = setup();

    let submitted;
    act(() => { submitted = result.current.submit(MOVES); });
    act(() => setRaw((prev) => ({ ...prev, entries: prev.entries.map((e) => (e.id === 2 ? { ...e, slot: 'FLEX' } : e)) })));
    await act(async () => {
      reject(refused());
      await submitted;
    });

    expect(getRaw().entries).toEqual([{ id: 1, slot: 'BENCH' }, { id: 2, slot: 'FLEX' }]);
  });

  test('a save queued offline says so and has no Undo', async () => {
    apiClient.put.mockRejectedValue(offline());
    const { result } = setup();

    await act(async () => {
      await result.current.submit(MOVES);
    });

    await waitFor(() => expect(readPendingLineupMutations()).toHaveLength(1));
    expect(mockNotify).toHaveBeenCalledWith(expect.stringContaining('saved offline'), { severity: 'info' });
  });
});
