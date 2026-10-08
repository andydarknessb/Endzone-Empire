import { useEffect, useState } from 'react';
import { useSnackbar } from '../../../components/Snackbar/SnackbarProvider';
import { moveLegality } from '../../../entities/roster';

/**
 * The boolean face of `moveLegality` (`entities/roster`, the one client rule
 * for "may `selectedEntry` move into `targetSlot`, held by `targetEntry`, or
 * empty when null"), for callers that need only yes or no: the Ledger's
 * highlighting, `hasEligibleTarget`, and `widgets/player-decision-card`'s slot
 * actions. The rule decides from the server facts on the entries
 * (`eligibleSlots`, `locked`, `validStash`, `spent`) and takes no template.
 */
export function isEligibleMove({ selectedEntry, ...rest }) {
  return moveLegality({ entry: selectedEntry, ...rest }).ok;
}

// What the refusal toast says per `moveLegality` reason. A reason with no copy
// here (unsettled, best_ball, spent) is refused silently: the Ledger already
// shows those rows as unavailable.
const REFUSAL_COPY = {
  locked: "Locked players can't be moved",
  stash_only_to_bench: 'A locked player can only leave IR for the bench',
  ineligible: "That player can't fill that slot",
};

/**
 * swap-players feature (#1237, ADR 0019: Lineup is the sole team management
 * surface): select-then-target swap, slot-first quick pick, and the
 * optimistic PUT with the offline queue, restated from LineupScreen.jsx's
 * own `handleRowClick`/`performMove`/quick-pick handlers behind one hook so
 * the Lineup page and the lineup-ledger widget both stay thin.
 *
 * Takes the page's own `entries` (the entities/roster-normalized array the
 * page already built for the ledger widget) rather than owning a fetch: a
 * feature acts, it does not read (ADR 0020's page-composes-widgets/features
 * split). Every legality question goes through `moveLegality`; this hook owns
 * no rule of its own, only what to do with the answer.
 *
 * The one announcement (AC6, ADR 0037: "no other live region exists on the
 * page") is the app-wide Snackbar (`useSnackbar`), reused for every
 * feedback - saved, queued offline, refused, and the swap's own result -
 * so this feature never introduces a second aria-live region.
 *
 * `hasEligibleTarget` (#1425, optional): "does this candidate have a legal
 * target ANYWHERE in the lineup, filled or empty slot" - a whole-lineup
 * question `entries` alone cannot answer (it carries occupied rows only, no
 * empty-slot capacity), so the page supplies it, built from the Ledger
 * widget's own row enumeration (`buildLedgerSections`) over `isEligibleMove`
 * above. Consulted only at the moment a fresh selection would begin.
 *
 * `submit` (spec #2042): `useLineupWrite`'s one write, which this hook feeds a
 * move plan. The optimistic patch, rollback, Undo, toast copy, replay and
 * Matchups cache invalidation all live there, not here.
 */
export function useSwapPlayers({ submit, entries, bestBall, leagueUnsettled, hasEligibleTarget }) {
  const notify = useSnackbar();
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [quickPick, setQuickPick] = useState(null); // { anchorEl, slotType }

  // #1963: Escape cancels a pending move, so a keyboard user need not Tab to the
  // strip's Cancel button. Listens only while a selection exists. An Escape a
  // handler already marked defaultPrevented is left alone; MUI dialogs and menus
  // stop propagation, so theirs never reaches this document listener.
  const hasSelection = selectedEntry !== null;
  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setSelectedEntry(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasSelection]);

  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map(list.map((e) => [e.playerId, e]));

  // The single entry point every move goes through. Takes no second argument
  // on purpose: `onSwap={performMove}` callers must never reach `submit`'s Undo.
  const performMove = (moves) => submit(moves);

  // Whether `targetEntry` (or an empty slot when null) is a legal landing
  // spot for the currently selected player.
  const isEligibleTarget = (targetEntry, slotType) =>
    isEligibleMove({ selectedEntry, targetEntry, targetSlot: slotType, bestBall, leagueUnsettled });

  const closeQuickPick = () => setQuickPick(null);

  // A refusal says why when it has copy, and drops the selection that led to it.
  const refuse = (reason) => {
    const copy = REFUSAL_COPY[reason];
    if (!copy) return;
    notify(copy, { severity: 'warning' });
    setSelectedEntry(null);
  };

  const onRowClick = (entry, slotType, event) => {
    if (!selectedEntry) {
      if (!entry) {
        // An empty slot opens its quick pick only when someone could fill it.
        if (!list.some((e) => isEligibleMove({ selectedEntry: e, targetEntry: null, targetSlot: slotType, bestBall, leagueUnsettled }))) return;
        setQuickPick({ anchorEl: event?.currentTarget, slotType });
        return;
      }
      // Selecting a row asks the rule about the move a selected row can always
      // make, to BENCH; only a refusal about the row itself ends the click.
      const { reason } = moveLegality({ entry, targetEntry: null, targetSlot: 'BENCH', bestBall, leagueUnsettled });
      if (reason && reason !== 'ineligible') return refuse(reason);
      // #1425 ruling: a row with no legal target anywhere in the lineup -
      // filled or empty, Starters, Bench or IR - never becomes a live
      // selection with nothing to highlight. Refused here, before
      // `setSelectedEntry` runs, so nothing is ever painted only to be
      // cleared a moment later. `hasEligibleTarget` is optional so a caller
      // that has not wired the whole-lineup row enumeration (every hook
      // test below) keeps today's behaviour.
      if (typeof hasEligibleTarget === 'function' && !hasEligibleTarget(entry)) {
        notify(`No eligible players for ${entry.name}`, { severity: 'warning' });
        return;
      }
      setSelectedEntry(entry);
      return;
    }

    if (entry && entry.playerId === selectedEntry.playerId) {
      setSelectedEntry(null);
      return;
    }

    const { ok, reason } = moveLegality({ entry: selectedEntry, targetEntry: entry, targetSlot: slotType, bestBall, leagueUnsettled });
    if (!ok) return refuse(reason);

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
    ? list.filter((e) => isEligibleMove({ selectedEntry: e, targetEntry: null, targetSlot: quickPick.slotType, bestBall, leagueUnsettled }))
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
