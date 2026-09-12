import { locked } from '../../../entities/roster';

/**
 * The Decision card's own two derived move sets (#1240, ADR 0037 AC2/AC4).
 *
 * `benchOptionsForSlot(entries, slot)`: the bench players who could fill
 * `slot` (AC4, "the bench options for the player's slot"), sorted by
 * projection descending - a null projection sorts last, the same rule
 * `widgets/lineup-ledger/model/buildLedgerSections.js`'s own bench sort
 * applies, restated here rather than imported since that module's export is
 * a full section builder, not this narrower filter. Only a real starting
 * slot has bench options: a card opened on a BENCH or IR row (no starting
 * slot of its own to fill) gets an empty list, which is that section's own
 * null-source hide rule.
 *
 * `startTargetSlots(entry)` / `movesToStart(entry, targetSlot, entries)`:
 * the header's "start" action for a bench or IR player (AC2's "move to
 * bench or start"). `startTargetSlots` is every starting slot type the
 * player is eligible for (BENCH/IR excluded). `movesToStart` builds the one
 * or two moves a tap on one of those slots performs: a swap with whoever
 * currently occupies that slot type, or - when nobody does - a bare
 * one-way move.
 *
 * KNOWN SIMPLIFICATION (flagged rather than guessed at further, per the
 * issue's own AC7 margin note): a league configuring more than one instance
 * of the same slot type (two ROSTER RB slots, say) with an open seat this
 * entry list doesn't reveal - only OCCUPIED rows appear in `entries` at all,
 * per `entities/roster`'s `lineupEntries` - reads as occupied by whichever
 * instance's row this finds first rather than as the open seat. The fully
 * general fix needs the league's own `rosterSlots` counts, which this card
 * does not otherwise need, so it is left as a follow-up rather than plumbed
 * in for this one action.
 */
export function benchOptionsForSlot(entries, slot) {
  if (slot == null || slot === 'BENCH' || slot === 'IR') return [];
  const list = Array.isArray(entries) ? entries : [];
  const eligible = list.filter(
    (e) => e && e.slot === 'BENCH' && !e.spent && Array.isArray(e.eligibleSlots) && e.eligibleSlots.includes(slot)
  );
  return eligible
    .slice()
    .sort((a, b) => {
      const ap = Number.isFinite(a.projection) ? a.projection : -Infinity;
      const bp = Number.isFinite(b.projection) ? b.projection : -Infinity;
      return bp - ap;
    })
    .map((entry) => ({ entry, locked: locked(entry) }));
}

/** Every starting slot type `entry` is eligible for (BENCH/IR excluded). */
export function startTargetSlots(entry) {
  if (!entry || !Array.isArray(entry.eligibleSlots)) return [];
  return entry.eligibleSlots.filter((s) => s !== 'BENCH' && s !== 'IR');
}

/** The move(s) tapping `targetSlot` performs for `entry` (see docblock above). */
export function movesToStart(entry, targetSlot, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const occupant = list.find((e) => e && e.slot === targetSlot && e.playerId !== entry.playerId);
  if (!occupant) return [{ playerId: entry.playerId, slot: targetSlot }];
  return [
    { playerId: entry.playerId, slot: targetSlot },
    { playerId: occupant.playerId, slot: entry.slot },
  ];
}

export default benchOptionsForSlot;
