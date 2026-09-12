import { useState } from 'react';
import useResilientLineupMutation from '../../../hooks/useResilientLineupMutation';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';
import { readHttpFailure } from '../../../lib/httpFailure';
import { locked } from '../../../entities/roster';

// Slots Best Ball still lets a manager manage manually (BENCH/IR roster
// actions) even though starting-slot assignment is read-only, matching
// LineupScreen.jsx's own BEST_BALL_MANAGED_SLOTS.
const BEST_BALL_MANAGED_SLOTS = new Set(['BENCH', 'IR']);

/**
 * CONTEXT.md's Lineup lock exception: a manager may still move a
 * non-IR-eligible IR occupant to BENCH to resolve the stash - a rule about
 * WHERE a locked player may go, not about whether he is locked, restated
 * here byte-for-byte from LineupScreen.jsx's `canResolveLockedIrStash`.
 * Never applies in best ball, where BENCH participates in scoring.
 */
function canResolveLockedIrStash(entry, targetSlot, bestBall) {
  return !bestBall
    && Boolean(entry)
    && locked(entry)
    && entry.slot === 'IR'
    && !entry.validStash
    && targetSlot === 'BENCH';
}

/**
 * The full "may `selectedEntry` move into `targetSlot`, currently held by
 * `targetEntry` (or empty when null)" rule - exported as one pure function
 * (#1240, formal review round 2, findings r1/r2/r3/r4/r5) so a caller other
 * than a Ledger row click can ask the exact question `onRowClick` answers,
 * rather than keeping its own copy that drifts out of sync with this one.
 * That is precisely what had gone wrong: `player-decision-card`'s own
 * enumerated conditions had already missed a spent starter's Bench button,
 * a spent Start target, and the whole rule while the league is unsettled -
 * three of `onRowClick`'s own early refusals, each added here first and
 * copied there second.
 *
 * It is the union of `onRowClick`'s own early refusals (`leagueUnsettled`;
 * a best-ball-unmanaged slot on EITHER end, not just the target; a spent
 * entry on either end) and this hook's own former `isEligibleTarget` body
 * (the locked-source exception, a locked target, and the reciprocal
 * `eligibleSlots` check). `isEligibleTarget` below is now a thin wrapper
 * that closes over this hook's own `selectedEntry`/`bestBall`/
 * `leagueUnsettled`; nothing about the Ledger's own behaviour changes.
 */
export function isEligibleMove({ selectedEntry, targetEntry, targetSlot, bestBall, leagueUnsettled }) {
  if (leagueUnsettled) return false;
  if (!selectedEntry) return false;
  if (bestBall && !BEST_BALL_MANAGED_SLOTS.has(selectedEntry.slot)) return false;
  if (bestBall && !BEST_BALL_MANAGED_SLOTS.has(targetSlot)) return false;
  if (selectedEntry.spent) return false;
  if (targetEntry?.spent) return false;
  if (locked(selectedEntry) && !canResolveLockedIrStash(selectedEntry, targetSlot, bestBall)) return false;
  if (!targetEntry) return selectedEntry.eligibleSlots.includes(targetSlot);
  if (locked(targetEntry)) return false;
  return (
    selectedEntry.eligibleSlots.includes(targetEntry.slot) &&
    targetEntry.eligibleSlots.includes(selectedEntry.slot)
  );
}

/**
 * swap-players feature (#1237, ADR 0019: Lineup is the sole team management
 * surface): select-then-target swap, slot-first quick pick, and the
 * optimistic PUT with the offline queue, restated from LineupScreen.jsx's
 * own `handleRowClick`/`performMove`/quick-pick handlers behind one hook so
 * the Lineup page and the lineup-ledger widget both stay thin.
 *
 * Takes the page's own mutable lineup state (`raw`, the wire body with
 * `entries[].id`/`.slot`, and `setRaw`) rather than owning a fetch itself:
 * a feature acts, it does not read (ADR 0020's page-composes-widgets/
 * features split). `entries` is the entities/roster-normalized array
 * (locked/eligibleSlots/validStash/spent) the page already built for the
 * ledger widget, read here for the swap rules only.
 *
 * The one announcement (AC6, ADR 0037: "no other live region exists on the
 * page") is the app-wide Snackbar (`useSnackbar`), reused for every
 * feedback - saved, queued offline, refused, and the swap's own result -
 * so this feature never introduces a second aria-live region.
 */
export function useSwapPlayers({ leagueId, raw, setRaw, entries, bestBall, leagueUnsettled }) {
  const notify = useSnackbar();
  const { saveLineup } = useResilientLineupMutation({ onReplaySuccess: () => notify('Lineup saved') });
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [quickPick, setQuickPick] = useState(null); // { anchorEl, slotType }

  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map(list.map((e) => [e.playerId, e]));

  const performMove = async (moves) => {
    const snapshot = raw;
    const slotByPlayer = new Map(moves.map((m) => [m.playerId, m.slot]));
    setRaw((prev) =>
      prev
        ? { ...prev, entries: prev.entries.map((e) => (slotByPlayer.has(e.id) ? { ...e, slot: slotByPlayer.get(e.id) } : e)) }
        : prev
    );
    try {
      const result = await saveLineup({ leagueId: Number(leagueId), week: raw?.week, moves });
      notify(
        result.queued ? 'Lineup change saved offline. It will sync when you reconnect' : 'Lineup saved',
        { severity: result.queued ? 'info' : 'success' }
      );
    } catch (err) {
      setRaw(snapshot);
      notify(readHttpFailure(err).message || err.message, { severity: 'error' });
    }
  };

  // Whether `targetEntry` (or an empty slot when null) is a legal landing
  // spot for the currently selected player - a thin wrapper closing over
  // this hook's own state/props around the exported `isEligibleMove` (#1240
  // round 2), which used to be this function's entire body inline.
  const isEligibleTarget = (targetEntry, slotType) =>
    isEligibleMove({ selectedEntry, targetEntry, targetSlot: slotType, bestBall, leagueUnsettled });

  const closeQuickPick = () => setQuickPick(null);

  const onRowClick = (entry, slotType, event) => {
    if (leagueUnsettled) return;
    if (bestBall && !BEST_BALL_MANAGED_SLOTS.has(slotType)) return;
    if (entry?.spent) return;

    if (entry && locked(entry) && !canResolveLockedIrStash(entry, 'BENCH', bestBall)) {
      notify("Locked players can't be moved", { severity: 'warning' });
      setSelectedEntry(null);
      return;
    }

    if (!selectedEntry) {
      if (!entry) {
        setQuickPick({ anchorEl: event?.currentTarget, slotType });
        return;
      }
      setSelectedEntry(entry);
      return;
    }

    if (entry && entry.playerId === selectedEntry.playerId) {
      setSelectedEntry(null);
      return;
    }

    setSelectedEntry(null);
    if (!entry) {
      performMove([{ playerId: selectedEntry.playerId, slot: slotType }]);
      return;
    }
    performMove([
      { playerId: selectedEntry.playerId, slot: entry.slot },
      { playerId: entry.playerId, slot: selectedEntry.slot },
    ]);
  };

  const quickPickEligible = quickPick
    ? list.filter((e) => {
        const bestBallSourceAllowed =
          !bestBall || (BEST_BALL_MANAGED_SLOTS.has(e.slot) && e.slot !== quickPick.slotType);
        const lockAllowsMove = !locked(e) || (!bestBall && canResolveLockedIrStash(e, quickPick.slotType, bestBall));
        return bestBallSourceAllowed && lockAllowsMove && e.eligibleSlots.includes(quickPick.slotType);
      })
    : [];

  const handleQuickPickSelect = (chosenPlayerId) => {
    const slotType = quickPick?.slotType;
    closeQuickPick();
    const chosen = byId.get(chosenPlayerId);
    if (!slotType || !chosen) return;
    performMove([{ playerId: chosen.playerId, slot: slotType }]);
  };

  return {
    selectedEntry,
    cancelSelection: () => setSelectedEntry(null),
    quickPick,
    quickPickEligible,
    closeQuickPick,
    handleQuickPickSelect,
    onRowClick,
    isEligibleTarget,
    performMove,
  };
}

export default useSwapPlayers;
