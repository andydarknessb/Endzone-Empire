import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { LINEUP_MUTATION_REPLAYED_EVENT, PENDING_LINEUP_MUTATIONS_KEY, readPendingLineupMutations } from '../../../lib/pendingLineupMutations';
import { isEligibleMove, useSwapPlayers } from './useSwapPlayers';

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

// AC9 coverage gap (formal review finding
// ac9-enforcement-refusal-coverage-gaps): a locked, no-longer-eligible IR
// occupant may resolve to BENCH (already covered above) but the same
// exception must NOT extend to a starting slot - the resolution rule is
// "to BENCH", not "anywhere".
test('a locked, invalid-stash IR occupant is refused as a source into a starting slot, only BENCH resolves it', () => {
  const irEntry = entry({ playerId: 3, slot: 'IR', locked: true, validStash: false, eligibleSlots: ['BENCH', 'RB'] });
  const rbEmpty = entry({ playerId: 9, slot: 'RB', locked: false, eligibleSlots: ['BENCH', 'RB'] });
  const { result } = setup({ entries: [irEntry, rbEmpty] });
  act(() => result.current.onRowClick(irEntry, 'IR'));
  expect(result.current.selectedEntry).toEqual(irEntry);
  expect(result.current.isEligibleTarget(null, 'RB')).toBe(false);
  expect(result.current.isEligibleTarget(rbEmpty, 'RB')).toBe(false);
  expect(result.current.isEligibleTarget(null, 'BENCH')).toBe(true);
});

// AC9 coverage gap: quick pick (a slot-first pick with nothing selected).
describe('quick pick', () => {
  test('clicking an empty slot with nothing selected opens the quick pick instead of performing a move', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    const { result } = setup({ entries: [bench] });
    const fakeEvent = { currentTarget: 'anchor-el' };
    act(() => result.current.onRowClick(null, 'QB', fakeEvent));
    expect(result.current.quickPick).toEqual({ anchorEl: 'anchor-el', slotType: 'QB' });
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  test('quickPickEligible only lists players eligible for the target slot and unlocked', () => {
    const eligible = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    const ineligible = entry({ playerId: 3, slot: 'BENCH', eligibleSlots: ['BENCH', 'WR'] });
    const lockedPlayer = entry({ playerId: 4, slot: 'BENCH', locked: true, eligibleSlots: ['BENCH', 'QB'] });
    const { result } = setup({ entries: [eligible, ineligible, lockedPlayer] });
    act(() => result.current.onRowClick(null, 'QB', { currentTarget: null }));
    expect(result.current.quickPickEligible.map((e) => e.playerId)).toEqual([2]);
  });

  test('selecting a quick pick candidate performs the move and closes the menu', async () => {
    apiClient.put.mockResolvedValue({ data: {} });
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    const { result } = setup({ entries: [bench] });
    act(() => result.current.onRowClick(null, 'QB', { currentTarget: null }));
    act(() => result.current.handleQuickPickSelect(2));
    expect(result.current.quickPick).toBeNull();
    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
        leagueId: 7,
        week: 4,
        moves: [{ playerId: 2, slot: 'QB' }],
      })
    );
  });

  test('best ball refuses a click on an empty STARTING slot outright (no quick pick at all)', () => {
    const benchPlayer = entry({ playerId: 6, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    const { result } = setup({ entries: [benchPlayer], bestBall: true });
    act(() => result.current.onRowClick(null, 'QB', { currentTarget: null }));
    expect(result.current.quickPick).toBeNull();
  });

  test('best ball limits an empty BENCH/IR slot\'s quick pick sources to BENCH/IR management, never a starter', () => {
    const starter = entry({ playerId: 5, slot: 'RB', eligibleSlots: ['BENCH', 'IR'] });
    const irPlayer = entry({ playerId: 7, slot: 'IR', eligibleSlots: ['BENCH', 'IR'] });
    const { result } = setup({ entries: [starter, irPlayer], bestBall: true });
    act(() => result.current.onRowClick(null, 'BENCH', { currentTarget: null }));
    expect(result.current.quickPickEligible.map((e) => e.playerId)).toEqual([7]);
  });
});

// AC9 coverage gap: league-unsettled gating (LineupScreen.jsx's #217 rule).
test('leagueUnsettled commits to nothing: no selection, no quick pick, no notify', () => {
  const qb = entry({ playerId: 1, slot: 'QB' });
  const { result } = setup({ entries: [qb], leagueUnsettled: true });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.selectedEntry).toBeNull();
  act(() => result.current.onRowClick(null, 'BENCH', { currentTarget: null }));
  expect(result.current.quickPick).toBeNull();
  expect(mockNotify).not.toHaveBeenCalled();
});

// AC9 coverage gap: the offline queue - a save that fails for connectivity
// (not a server refusal) queues locally and reports it as saved offline,
// rather than as an error.
test('a connectivity failure queues the move locally and notifies "saved offline", not an error', async () => {
  apiClient.put.mockRejectedValue({ message: 'Network Error', code: 'ERR_NETWORK' });
  const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const { result } = setup({ entries: [entry(), bench] });

  act(() => result.current.onRowClick(bench, 'BENCH'));
  act(() => result.current.onRowClick(null, 'BENCH'));

  await waitFor(() =>
    expect(mockNotify).toHaveBeenCalledWith(
      'Lineup change saved offline. It will sync when you reconnect',
      { severity: 'info' }
    )
  );
  expect(readPendingLineupMutations()).toHaveLength(1);
  expect(JSON.stringify(readPendingLineupMutations()[0])).toContain('"playerId":2');
});

// isEligibleMove (#1240, formal review round 2, r1/r2/r3): the exported
// pure rule the player-decision-card widget also calls. `isEligibleTarget`
// above already exercises its reciprocal-eligibility and locked-source/
// locked-target behaviour through the hook; these cover the three
// refusals `isEligibleTarget`'s OLD body did not itself check (leagueUnsettled,
// a spent SELECTED entry, and a best-ball-unmanaged slot on the selected
// entry's own side, not just the target's).
describe('isEligibleMove', () => {
  const qb = entry({ playerId: 1, slot: 'QB', eligibleSlots: ['BENCH', 'QB'] });
  const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });

  test('refuses everything while the league is unsettled', () => {
    expect(isEligibleMove({ selectedEntry: qb, targetEntry: null, targetSlot: 'BENCH', bestBall: false, leagueUnsettled: true })).toBe(false);
  });

  test('refuses a spent selected entry, even into an otherwise-open BENCH', () => {
    const spentQb = entry({ playerId: 1, slot: 'QB', spent: true, eligibleSlots: ['BENCH', 'QB'] });
    expect(isEligibleMove({ selectedEntry: spentQb, targetEntry: null, targetSlot: 'BENCH', bestBall: false, leagueUnsettled: false })).toBe(false);
  });

  test('refuses moving a starting-slot entry at all in best ball, regardless of target', () => {
    expect(isEligibleMove({ selectedEntry: qb, targetEntry: null, targetSlot: 'BENCH', bestBall: true, leagueUnsettled: false })).toBe(false);
  });

  test('allows a BENCH/IR-managed source into BENCH even in best ball', () => {
    expect(isEligibleMove({ selectedEntry: bench, targetEntry: null, targetSlot: 'BENCH', bestBall: true, leagueUnsettled: false })).toBe(true);
  });

  test('allows an ordinary eligible move with nothing unsettled or spent', () => {
    expect(isEligibleMove({ selectedEntry: qb, targetEntry: null, targetSlot: 'BENCH', bestBall: false, leagueUnsettled: false })).toBe(true);
  });
});

// AC9 coverage gap: a queued mutation's later replay (reconnect) notifies
// "Lineup saved" the same way an online save does - the hook wires
// useResilientLineupMutation's onReplaySuccess to the same notify.
test('a queued mutation replaying on reconnect notifies "Lineup saved"', () => {
  setup({ entries: [] });
  act(() => {
    window.dispatchEvent(new CustomEvent(LINEUP_MUTATION_REPLAYED_EVENT, { detail: { queued: 1 } }));
  });
  expect(mockNotify).toHaveBeenCalledWith('Lineup saved');
});
