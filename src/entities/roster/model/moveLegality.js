import { locked } from './lineupModel';

// Slots Best Ball still lets a manager manage by hand (BENCH/IR); starting-slot
// assignment is read-only there.
const BEST_BALL_MANAGED_SLOTS = new Set(['BENCH', 'IR']);

const fits = (entry, slot) => Array.isArray(entry?.eligibleSlots) && entry.eligibleSlots.includes(slot);

/**
 * The one client rule for "may `entry` move into `targetSlot`, held by
 * `targetEntry` (null when the slot is empty)": `{ ok }`, or `{ ok: false,
 * reason }` with `reason` one of `unsettled`, `best_ball`, `spent`, `locked`,
 * `stash_only_to_bench`, `ineligible` (spec #2042). The row click, quick pick,
 * has-a-target check and the Decision card's slot actions all ask it.
 *
 * It decides from server facts on the entries and nothing else: `eligibleSlots`
 * (the Roster template's verdict, built once in `lineupEntries`), `locked`,
 * `validStash` and `spent`. CONTEXT.md's Lineup lock exception lives here: a
 * locked IR occupant who is no longer a valid stash may still move to BENCH
 * (never in best ball, where BENCH scores) and nowhere else - the server's
 * `resolvesStaleIrStash` is the authority this mirrors.
 */
export function moveLegality({ entry, targetEntry, targetSlot, bestBall, leagueUnsettled }) {
  const refuse = (reason) => ({ ok: false, reason });
  if (leagueUnsettled) return refuse('unsettled');
  if (!entry) return refuse('ineligible');
  if (bestBall && !(BEST_BALL_MANAGED_SLOTS.has(entry.slot) && BEST_BALL_MANAGED_SLOTS.has(targetSlot))) {
    return refuse('best_ball');
  }
  if (entry.spent || targetEntry?.spent) return refuse('spent');
  if (locked(entry)) {
    const staleStash = !bestBall && entry.slot === 'IR' && !entry.validStash;
    if (!staleStash) return refuse('locked');
    if (targetSlot !== 'BENCH') return refuse('stash_only_to_bench');
  }
  if (locked(targetEntry)) return refuse('locked');
  if (!fits(entry, targetSlot)) return refuse('ineligible');
  if (targetEntry && !fits(targetEntry, entry.slot)) return refuse('ineligible');
  return { ok: true };
}
