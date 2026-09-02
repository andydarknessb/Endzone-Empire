/**
 * Lineup attention signals, lifted out of LineupScreen (#643) so the lineup
 * screen's warning banner and the League Dashboard quick-actions widget read
 * ONE implementation of the rule. Two copies of "which starting slots need
 * attention" that drift is the failure this extraction exists to prevent: the
 * banner and the dashboard would then disagree about whether a manager is set.
 *
 * Two signals, from a set of lineup entries grouped into the league's starting
 * slots:
 *   - emptyStarterSlots: how many required starting-slot INSTANCES have no
 *     player (a 2-count slot with one player is 1 empty).
 *   - startersOnBye: the starter entries flagged on this week's bye. The CALLER
 *     decides what "on bye" means and sets `onBye` per entry: LineupScreen reads
 *     the server's per-entry `onBye`, and the dashboard widget derives it from
 *     `bye_week === current_week`. Keeping the predicate in the caller is what
 *     lets one helper serve both read shapes without knowing either.
 *
 * Only the league's configured starting slots define starters. Bench and IR
 * entries carry slot keys that are not in `rosterSlots`, so they contribute to
 * neither signal: a benched player on bye never counts, which is the intended
 * rule (you are not penalized for a backup's bye).
 */

// The standard 7-slot starter order (9 starter instances). Used ONLY to pick and
// order starting slots when a league carries no explicit `roster_slots` yet (a
// league still loading, or a legacy row). Mirrors the starter keys of the
// server's lineup.service DEFAULT_ROSTER_SLOTS; keep the two in step if the
// standard roster shape ever changes. (LineupScreen no longer keeps its own copy
// - it imports this one.)
export const DEFAULT_STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

export function lineupAttention({ rosterSlots = [], entries = [] } = {}) {
  const slots = Array.isArray(rosterSlots) ? rosterSlots : [];

  // Group entries by their assigned slot key. An entry with no slot is skipped
  // (it belongs to no slot, so it is neither a fill nor a starter on bye).
  const bySlot = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.slot == null) continue;
    (bySlot[entry.slot] = bySlot[entry.slot] || []).push(entry);
  }

  // The starting slots to inspect: the league's own keys, or the standard order
  // when none are configured. When there are no configured slots the empty-slot
  // reduce below finds a count of 0 for every default key, so emptyStarterSlots
  // is 0 there while byes are still read off the default starter keys.
  const starterSlotOrder = slots.length > 0 ? slots.map((s) => s.key) : DEFAULT_STARTER_SLOT_ORDER;

  const emptyStarterSlots = starterSlotOrder.reduce((acc, type) => {
    const count = slots.find((s) => s.key === type)?.count || 0;
    const filled = (bySlot[type] || []).length;
    return acc + Math.max(0, count - filled);
  }, 0);

  const startersOnBye = starterSlotOrder
    .flatMap((type) => bySlot[type] || [])
    .filter((e) => e.onBye);

  return { emptyStarterSlots, startersOnBye };
}

export default lineupAttention;
