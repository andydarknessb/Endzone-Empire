import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useSwapPlayers } from './useSwapPlayers';

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
});

const entry = (overrides = {}) => ({
  playerId: 1,
  slot: 'QB',
  locked: false,
  spent: false,
  validStash: false,
  eligibleSlots: ['BENCH', 'QB'],
  ...overrides,
});

function setup({ entries, raw, bestBall = false, leagueUnsettled = false } = {}) {
  let currentRaw = raw ?? { week: 4, entries: entries.map((e) => ({ id: e.playerId, slot: e.slot })) };
  const setRaw = jest.fn((updater) => {
    currentRaw = typeof updater === 'function' ? updater(currentRaw) : updater;
  });
  const { result, rerender } = renderHook(
    (props) => useSwapPlayers({ leagueId: 7, raw: currentRaw, setRaw, entries, bestBall, leagueUnsettled, ...props })
  );
  return { result, rerender, setRaw, getRaw: () => currentRaw };
}

test('selecting a player then an empty eligible slot performs a one-move swap', async () => {
  apiClient.put.mockResolvedValue({ data: {} });
  const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const { result } = setup({ entries: [entry(), bench] });

  act(() => result.current.onRowClick(bench, 'BENCH'));
  expect(result.current.selectedEntry).toEqual(bench);

  act(() => result.current.onRowClick(null, 'BENCH'));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
    leagueId: 7,
    week: 4,
    moves: [{ playerId: 2, slot: 'BENCH' }],
  }));
  expect(result.current.selectedEntry).toBeNull();
});

test('selecting two occupied rows swaps their slots both ways', async () => {
  apiClient.put.mockResolvedValue({ data: {} });
  const qb = entry({ playerId: 1, slot: 'QB', eligibleSlots: ['BENCH', 'QB'] });
  const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const { result } = setup({ entries: [qb, bench] });

  act(() => result.current.onRowClick(qb, 'QB'));
  act(() => result.current.onRowClick(bench, 'BENCH'));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 7,
      week: 4,
      moves: [
        { playerId: 1, slot: 'BENCH' },
        { playerId: 2, slot: 'QB' },
      ],
    })
  );
});

test('clicking the selected row again cancels the selection without saving', () => {
  const qb = entry();
  const { result } = setup({ entries: [qb] });
  act(() => result.current.onRowClick(qb, 'QB'));
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.selectedEntry).toBeNull();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('a locked player cannot be selected: a warning is shown and no move is made', () => {
  const lockedQb = entry({ locked: true });
  const { result } = setup({ entries: [lockedQb] });
  act(() => result.current.onRowClick(lockedQb, 'QB'));
  expect(result.current.selectedEntry).toBeNull();
  expect(mockNotify).toHaveBeenCalledWith("Locked players can't be moved", { severity: 'warning' });
});

test('a locked, no-longer-eligible IR occupant may still resolve to BENCH', () => {
  const irEntry = entry({ playerId: 3, slot: 'IR', locked: true, validStash: false, eligibleSlots: ['BENCH', 'IR'] });
  const { result } = setup({ entries: [irEntry] });
  act(() => result.current.onRowClick(irEntry, 'IR'));
  expect(result.current.selectedEntry).toEqual(irEntry);
});

test('best ball refuses a click on a starting slot but allows BENCH/IR management', () => {
  const starter = entry({ playerId: 1, slot: 'QB' });
  const { result } = setup({ entries: [starter], bestBall: true });
  act(() => result.current.onRowClick(starter, 'QB'));
  expect(result.current.selectedEntry).toBeNull();

  const benchEntry = entry({ playerId: 2, slot: 'BENCH' });
  act(() => result.current.onRowClick(benchEntry, 'BENCH'));
  expect(result.current.selectedEntry).toEqual(benchEntry);
});

test('a spent row can never be selected', () => {
  const spent = entry({ spent: true });
  const { result } = setup({ entries: [spent] });
  act(() => result.current.onRowClick(spent, 'QB'));
  expect(result.current.selectedEntry).toBeNull();
});

test('a failed save rolls back the optimistic move and notifies the error', async () => {
  apiClient.put.mockRejectedValue({ response: { status: 500, data: { error: 'nope' } } });
  const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const { result, getRaw } = setup({ entries: [entry(), bench] });
  const snapshotBefore = getRaw();

  act(() => result.current.onRowClick(bench, 'BENCH'));
  act(() => result.current.onRowClick(null, 'BENCH'));

  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith(expect.any(String), { severity: 'error' }));
  expect(getRaw()).toEqual(snapshotBefore);
});

test('isEligibleTarget refuses an ineligible slot pairing and allows a matching one', () => {
  const qb = entry({ playerId: 1, slot: 'QB', eligibleSlots: ['BENCH', 'QB'] });
  const wr = entry({ playerId: 2, slot: 'WR', eligibleSlots: ['BENCH', 'WR'] });
  const { result } = setup({ entries: [qb, wr] });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.isEligibleTarget(wr, 'WR')).toBe(false);
  expect(result.current.isEligibleTarget(null, 'BENCH')).toBe(true);
});
