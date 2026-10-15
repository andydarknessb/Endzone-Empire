import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { PENDING_LINEUP_MUTATIONS_KEY, readPendingLineupMutations } from '../../../lib/pendingLineupMutations';
import { DEFAULT_ROSTER_SLOTS } from '../../../entities/roster';
import { isEligibleMove, useSwapPlayers } from './useSwapPlayers';
import { useLineupWrite } from './useLineupWrite';

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
  position: 'QB',
  locked: false,
  spent: false,
  validStash: false,
  eligibleSlots: ['BENCH', 'QB'],
  ...overrides,
});

// The swap rules read only the server facts on each entry (`eligibleSlots`,
// `locked`, `validStash`, `spent`), so every fixture states its own
// `eligibleSlots`. `raw` is the write hook's wire body, not a rule input.
function setup({ entries, raw, bestBall = false, leagueUnsettled = false, hasEligibleTarget } = {}) {
  let currentRaw =
    raw ?? { week: 4, teamId: 9, rosterSlots: DEFAULT_ROSTER_SLOTS, entries: entries.map((e) => ({ id: e.playerId, slot: e.slot })) };
  const setRaw = jest.fn((updater) => {
    currentRaw = typeof updater === 'function' ? updater(currentRaw) : updater;
  });
  // The page's wiring: one useLineupWrite, its submit handed to the swap hook.
  const { result, rerender } = renderHook((props) => {
    const { submit } = useLineupWrite({ leagueId: 7, raw: currentRaw, setRaw });
    return useSwapPlayers({ submit, entries, bestBall, leagueUnsettled, hasEligibleTarget, ...props });
  });
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

// #1963: Escape cancels a pending move, except one a handler already claimed.
test('Escape cancels the selection, but not an Escape already defaultPrevented (#1963)', () => {
  const qb = entry();
  const { result } = setup({ entries: [qb] });
  act(() => result.current.onRowClick(qb, 'QB'));

  const claimed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  claimed.preventDefault();
  act(() => { document.dispatchEvent(claimed); });
  expect(result.current.selectedEntry).toEqual(qb);

  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(result.current.selectedEntry).toBeNull();
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
  const wr = entry({ playerId: 2, slot: 'WR', position: 'WR', eligibleSlots: ['BENCH', 'WR'] });
  const { result } = setup({ entries: [qb, wr] });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.isEligibleTarget(wr, 'WR')).toBe(false);
  expect(result.current.isEligibleTarget(null, 'BENCH')).toBe(true);
});

// The slot check reads the entry's server `eligibleSlots` and nothing else: no
// league template is threaded through the hook any more.
test('the slot check reads the entry\'s eligibleSlots', () => {
  const qb = entry({ playerId: 1, slot: 'QB', position: 'QB', eligibleSlots: ['BENCH', 'QB'] });
  const { result } = setup({ entries: [qb] });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.isEligibleTarget(null, 'FLEX')).toBe(false);
});

// Formal review f1: a healthy player must never be offered an IR slot, as an
// empty target, a swap with an IR occupant, or in the IR quick-pick list. The
// IR-eligibility fact is built into `eligibleSlots` by `lineupEntries`
// (`slotsFor`), so a healthy entry's list simply lacks IR.
describe('IR gate (formal review f1)', () => {
  test('a healthy entry (no injury designation) is refused at an empty IR slot', () => {
    const healthyWr = entry({ playerId: 1, slot: 'WR', position: 'WR', injuryStatus: null, eligibleSlots: ['BENCH', 'WR'] });
    const { result } = setup({ entries: [healthyWr] });
    act(() => result.current.onRowClick(healthyWr, 'WR'));
    expect(result.current.isEligibleTarget(null, 'IR')).toBe(false);
  });

  test('a healthy entry is refused as a source into an occupied IR slot', () => {
    const healthyWr = entry({ playerId: 1, slot: 'WR', position: 'WR', injuryStatus: null, eligibleSlots: ['BENCH', 'WR'] });
    const irOccupant = entry({ playerId: 2, slot: 'IR', position: 'RB', injuryStatus: 'IR', eligibleSlots: ['BENCH', 'RB', 'IR'] });
    const { result } = setup({ entries: [healthyWr, irOccupant] });
    act(() => result.current.onRowClick(healthyWr, 'WR'));
    expect(result.current.isEligibleTarget(irOccupant, 'IR')).toBe(false);
  });

  test('a healthy entry never appears in an IR-slot quick pick', () => {
    const healthyWr = entry({ playerId: 1, slot: 'BENCH', position: 'WR', injuryStatus: null, eligibleSlots: ['BENCH', 'WR'] });
    const { result } = setup({ entries: [healthyWr] });
    act(() => result.current.onRowClick(null, 'IR', { currentTarget: null }));
    expect(result.current.quickPickEligible.map((e) => e.playerId)).toEqual([]);
  });

  test.each(['O', 'IR'])(
    'an IR-eligible entry (designation %s) is still accepted at an empty IR slot',
    (designation) => {
      const stashable = entry({ playerId: 1, slot: 'BENCH', position: 'RB', injuryStatus: designation, eligibleSlots: ['BENCH', 'RB', 'IR'] });
      const { result } = setup({ entries: [stashable] });
      act(() => result.current.onRowClick(stashable, 'BENCH'));
      expect(result.current.isEligibleTarget(null, 'IR')).toBe(true);
    }
  );
});

// Formal review round 3 finding s1: no prior case exercised isEligibleTarget
// with bestBall true, so 18 passing tests proved nothing about the one
// reachable behaviour change the isEligibleMove extraction introduced - a
// starting-slot target now correctly refused during a BENCH-row selection
// in best ball, where the old body had no bestBall term of its own at all.
test('isEligibleTarget refuses a starting-slot target in best ball, even mid-selection from BENCH', () => {
  const benchPlayer = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
  const starter = entry({ playerId: 1, slot: 'QB', eligibleSlots: ['BENCH', 'QB'] });
  const { result } = setup({ entries: [benchPlayer, starter], bestBall: true });
  // Selecting a BENCH/IR row is allowed in best ball (onRowClick's own gate
  // only blocks a STARTING row); the starting slot must still be refused
  // as a TARGET.
  act(() => result.current.onRowClick(benchPlayer, 'BENCH'));
  expect(result.current.selectedEntry).toEqual(benchPlayer);
  expect(result.current.isEligibleTarget(starter, 'QB')).toBe(false);
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

// The refusal toast reads `moveLegality`'s reason; a refused click makes no write.
describe('refusal toasts', () => {
  test('a locked stale stash clicked onto a starting slot says it can only go to the bench', () => {
    const irEntry = entry({ playerId: 3, slot: 'IR', locked: true, validStash: false, eligibleSlots: ['BENCH', 'RB'] });
    const rb = entry({ playerId: 9, slot: 'RB', eligibleSlots: ['BENCH', 'RB', 'IR'] });
    const { result } = setup({ entries: [irEntry, rb] });
    act(() => result.current.onRowClick(irEntry, 'IR'));
    act(() => result.current.onRowClick(rb, 'RB'));
    expect(mockNotify).toHaveBeenCalledWith('A locked player can only leave IR for the bench', { severity: 'warning' });
    expect(result.current.selectedEntry).toBeNull();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  test('clicking a locked target refuses with the locked copy and no write', () => {
    const bench = entry({ playerId: 2, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    const lockedQb = entry({ playerId: 1, slot: 'QB', locked: true });
    const { result } = setup({ entries: [bench, lockedQb] });
    act(() => result.current.onRowClick(bench, 'BENCH'));
    act(() => result.current.onRowClick(lockedQb, 'QB'));
    expect(mockNotify).toHaveBeenCalledWith("Locked players can't be moved", { severity: 'warning' });
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  test('clicking an ineligible target refuses with no write instead of sending it to the server', () => {
    const qb = entry({ playerId: 1, slot: 'QB', eligibleSlots: ['BENCH', 'QB'] });
    const wr = entry({ playerId: 2, slot: 'WR', position: 'WR', eligibleSlots: ['BENCH', 'WR'] });
    const { result } = setup({ entries: [qb, wr] });
    act(() => result.current.onRowClick(qb, 'QB'));
    act(() => result.current.onRowClick(wr, 'WR'));
    expect(mockNotify).toHaveBeenCalledWith("That player can't fill that slot", { severity: 'warning' });
    expect(apiClient.put).not.toHaveBeenCalled();
  });
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
    const ineligible = entry({ playerId: 3, slot: 'BENCH', position: 'WR', eligibleSlots: ['BENCH', 'WR'] });
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

  test('an empty slot nobody can fill still opens the quick pick, so its empty state speaks (settled, non-best-ball)', () => {
    const wr = entry({ playerId: 6, slot: 'BENCH', position: 'WR', eligibleSlots: ['BENCH', 'WR'] });
    const lockedQb = entry({ playerId: 7, slot: 'BENCH', locked: true, eligibleSlots: ['BENCH', 'QB'] });
    const { result } = setup({ entries: [wr, lockedQb] });
    act(() => result.current.onRowClick(null, 'QB', { currentTarget: 'anchor-el' }));
    expect(result.current.quickPick).toEqual({ anchorEl: 'anchor-el', slotType: 'QB' });
    expect(result.current.quickPickEligible).toEqual([]);
  });

  test('best ball: players already in the empty BENCH seat\'s slot are no quick-pick candidates', () => {
    const benched = entry({ playerId: 6, slot: 'BENCH', eligibleSlots: ['BENCH', 'IR'] });
    const irPlayer = entry({ playerId: 7, slot: 'IR', eligibleSlots: ['BENCH', 'IR'] });
    const { result } = setup({ entries: [benched, irPlayer], bestBall: true });
    act(() => result.current.onRowClick(null, 'BENCH', { currentTarget: null }));
    expect(result.current.quickPickEligible.map((e) => e.playerId)).toEqual([7]);
  });

  test('a player already in a slot type is not offered for an empty seat of that same type', () => {
    const rb1 = entry({ playerId: 6, slot: 'RB', position: 'RB', eligibleSlots: ['BENCH', 'RB'] });
    const { result } = setup({ entries: [rb1] });
    act(() => result.current.onRowClick(null, 'RB', { currentTarget: null }));
    expect(result.current.quickPick).not.toBeNull();
    expect(result.current.quickPickEligible).toEqual([]);
  });

  test('best ball refuses a click on an empty STARTING slot outright (no quick pick at all)', () => {
    const benchPlayer = entry({ playerId: 6, slot: 'BENCH', eligibleSlots: ['BENCH', 'QB'] });
    const { result } = setup({ entries: [benchPlayer], bestBall: true });
    act(() => result.current.onRowClick(null, 'QB', { currentTarget: null }));
    expect(result.current.quickPick).toBeNull();
  });

  // #2086: the seat is closed by the slot, not by its candidates' own slots.
  test.each(['BENCH', 'IR'])('best ball: an empty %s seat with only starters still opens its quick pick (empty state)', (seat) => {
    const starter = entry({ playerId: 1, slot: 'QB', eligibleSlots: ['BENCH', 'IR', 'QB'] });
    const { result } = setup({ entries: [starter], bestBall: true });
    act(() => result.current.onRowClick(null, seat, { currentTarget: 'anchor-el' }));
    expect(result.current.quickPick).toEqual({ anchorEl: 'anchor-el', slotType: seat });
    expect(result.current.quickPickEligible).toEqual([]);
  });

  test('best ball limits an empty BENCH/IR slot\'s quick pick sources to BENCH/IR management, never a starter', () => {
    const starter = entry({ playerId: 5, slot: 'RB', eligibleSlots: ['BENCH', 'IR'] });
    const irPlayer = entry({ playerId: 7, slot: 'IR', eligibleSlots: ['BENCH', 'IR'] });
    const { result } = setup({ entries: [starter, irPlayer], bestBall: true });
    act(() => result.current.onRowClick(null, 'BENCH', { currentTarget: null }));
    expect(result.current.quickPickEligible.map((e) => e.playerId)).toEqual([7]);
  });
});

// AC4 (#1425 ruling): a row with no eligible target anywhere - the caller's
// `hasEligibleTarget` says so - refuses the selection with the Snackbar
// message instead of leaving `selectedEntry` set with nothing to highlight.
test('a row with no eligible target anywhere is refused with a Snackbar, not selected', () => {
  const qb = entry({ name: 'Josh Allen' });
  const { result } = setup({ entries: [qb], hasEligibleTarget: () => false });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.selectedEntry).toBeNull();
  expect(mockNotify).toHaveBeenCalledWith('No eligible players for Josh Allen', { severity: 'warning' });
});

test('hasEligibleTarget is asked about the clicked entry, and a true answer selects it normally', () => {
  const qb = entry();
  const hasEligibleTarget = jest.fn(() => true);
  const { result } = setup({ entries: [qb], hasEligibleTarget });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(hasEligibleTarget).toHaveBeenCalledWith(qb);
  expect(result.current.selectedEntry).toEqual(qb);
  expect(mockNotify).not.toHaveBeenCalled();
});

// Omitting `hasEligibleTarget` entirely (every other test in this file)
// keeps today's behaviour - the refusal is opt-in per caller, not a change
// to the hook's default contract.
test('without hasEligibleTarget, a selection proceeds exactly as before', () => {
  const qb = entry();
  const { result } = setup({ entries: [qb] });
  act(() => result.current.onRowClick(qb, 'QB'));
  expect(result.current.selectedEntry).toEqual(qb);
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

// isEligibleMove (#1240): the boolean face of `moveLegality` that the
// player-decision-card widget calls. The reasons themselves are tabled in
// `moveLegality.test.js`; this only pins the wrapper's argument mapping.
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
