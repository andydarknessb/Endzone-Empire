import { locked } from '../../../entities/roster';
import { isEligibleMove } from '../../../features/swap-players';

/**
 * The Decision card's own two derived move sets (#1240, ADR 0037 AC2/AC4).
 *
 * Both are built on `isEligibleMove` (formal review round 2, findings
 * r1/r2/r3/r4/r5): the SAME pure legality rule `useSwapPlayers`' own
 * `onRowClick`/`isEligibleTarget` enforce, exported from `swap-players` so
 * this card never keeps its own copy of that rule to fall out of sync with.
 * That is exactly what happened in round 1 - hand-enumerated
 * locked/spent/bestBall conditions here had already missed a spent
 * starter's Bench button, a spent Start target, and the whole rule while
 * the league is unsettled, three of `onRowClick`'s own refusals.
 *
 * `benchOptionsForSlot(entries, slot, { entry, bestBall, leagueUnsettled })`:
 * the bench players who could fill `slot` (AC4, "the bench options for the
 * player's slot"), sorted by projection descending - a null projection
 * sorts last, the same rule `widgets/lineup-ledger/model/
 * buildLedgerSections.js`'s own bench sort applies, restated here rather
 * than imported since that module's export is a full section builder, not
 * this narrower filter. Only a real starting slot has bench options: a card
 * opened on a BENCH or IR row (no starting slot of its own to fill) gets an
 * empty list, which is that section's own null-source hide rule. Each
 * candidate carries its own `swapEligible` (via `isEligibleMove`, covering
 * a locked/spent SELECTED player, a locked/spent CANDIDATE, best ball, and
 * league-unsettled all in one call) alongside `locked` (the candidate's own
 * lock, which AC4's "a locked player's options are disabled with the lock
 * shown" names specifically).
 *
 * `startTargetSlots(entry, entries, { bestBall, leagueUnsettled })` /
 * `movesToStart(entry, targetSlot, entries, { bestBall, leagueUnsettled })`:
 * the header's "start" action for a bench or IR player (AC2's "move to
 * bench or start"). `startTargetSlots` is every starting slot type the
 * player is eligible for (BENCH/IR excluded) that `isEligibleMove` accepts
 * for AT LEAST ONE of that slot type's current occupants (or for the bare
 * slot when nobody occupies it) - checking every occupant rather than just
 * the first one found is itself a round-2 fix (r5): a slot type with more
 * than one instance, one locked and one not, used to disable the whole slot
 * type if the locked instance happened to be found first. `movesToStart`
 * picks the first occupant `isEligibleMove` actually accepts and builds the
 * one or two moves a tap on that slot performs: a swap with that occupant,
 * or - when nobody occupies the slot at all - a bare one-way move.
 *
 * KNOWN SIMPLIFICATION (flagged rather than guessed at further, per the
 * issue's own AC7 margin note): a league configuring more than one instance
 * of the same slot type (two ROSTER RB slots, say) with an open seat this
 * entry list doesn't reveal - only OCCUPIED rows appear in `entries` at
 * all, per `entities/roster`'s `lineupEntries` - is read correctly now as
 * long as at least one occupied instance is eligible (r5's fix), but a
 * genuinely open THIRD seat neither occupied instance can reveal still
 * isn't offered. The fully general fix needs the league's own `rosterSlots`
 * counts, which this card does not otherwise need, so it is left as a
 * follow-up rather than plumbed in for this one action.
 */
export function benchOptionsForSlot(entries, slot, { entry, bestBall, leagueUnsettled } = {}) {
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
    .map((candidate) => ({
      entry: candidate,
      locked: locked(candidate),
      // Formal review round 3 finding s3: a legality helper's default must
      // never be "allowed" - omitting `entry` (or `bestBall`/
      // `leagueUnsettled`, which read as falsy the same way) used to fail
      // OPEN, re-enabling a locked candidate's own Swap for any caller that
      // didn't pass every option. The candidate's own lock is the floor
      // regardless of what the caller supplies.
      swapEligible: entry
        ? isEligibleMove({ selectedEntry: entry, targetEntry: candidate, targetSlot: slot, bestBall, leagueUnsettled })
        : !locked(candidate),
    }));
}

/**
 * Every starting slot type `entry` is eligible for (BENCH/IR excluded)
 * that `isEligibleMove` accepts for at least one current occupant, or for
 * the bare slot when nobody occupies it.
 */
export function startTargetSlots(entry, entries, { bestBall, leagueUnsettled } = {}) {
  if (!entry || !Array.isArray(entry.eligibleSlots)) return [];
  const list = Array.isArray(entries) ? entries : [];
  const slotTypes = entry.eligibleSlots.filter((s) => s !== 'BENCH' && s !== 'IR');
  return slotTypes.filter((s) => {
    const occupants = list.filter((e) => e && e.slot === s && e.playerId !== entry.playerId);
    if (occupants.length === 0) {
      return isEligibleMove({ selectedEntry: entry, targetEntry: null, targetSlot: s, bestBall, leagueUnsettled });
    }
    return occupants.some((occupant) =>
      isEligibleMove({ selectedEntry: entry, targetEntry: occupant, targetSlot: s, bestBall, leagueUnsettled })
    );
  });
}

/** The move(s) tapping `targetSlot` performs for `entry` (see docblock above). */
export function movesToStart(entry, targetSlot, entries, { bestBall, leagueUnsettled } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const occupants = list.filter((e) => e && e.slot === targetSlot && e.playerId !== entry.playerId);
  if (occupants.length === 0) return [{ playerId: entry.playerId, slot: targetSlot }];
  const occupant = occupants.find((candidate) =>
    isEligibleMove({ selectedEntry: entry, targetEntry: candidate, targetSlot, bestBall, leagueUnsettled })
  );
  // Callers build this list from `startTargetSlots`, which only offers a
  // slot with at least one eligible occupant, so this should always find
  // one; an empty array is the refusal for the rare case that invariant is
  // stale (e.g. the menu stayed open across a refetch). Formal review round
  // 3 finding s2: an empty array is a refusal ONLY if the caller treats it
  // as one - `onSwap` is `performMove`, which PUTs `moves: []` and reports
  // success on an empty array just as readily as a real move. Every caller
  // MUST check `.length` before calling `onSwap` with this return value.
  if (!occupant) return [];
  return [
    { playerId: entry.playerId, slot: targetSlot },
    { playerId: occupant.playerId, slot: entry.slot },
  ];
}

export default benchOptionsForSlot;
