import { assignRosterSlots } from '../rosterAssignment';

const DEDICATED_KDEF_POSITIONS = new Set(['K', 'DEF']);

/**
 * How many DEDICATED (single-position) K and DEF starting slots a team still
 * has open, given the picks it has made so far. Reuses assignRosterSlots
 * (which itself reuses expandSlotInstances and the maximum-bipartite-matching
 * matchStarters) rather than re-deriving slot-fill logic here: rosterSlots is
 * commissioner free-text jsonb, and a naive greedy scan over it is exactly
 * the class of bug rosterAssignment.js's docblock walks through.
 */
function unfilledKickerDefenseSlots({ roster, rosterSlots }) {
  const { summary } = assignRosterSlots({
    picks: roster,
    rosterSlots,
    benchCount: 0,
    irCount: 0,
    irDraftable: false,
  });
  return summary.unfilledStarters
    .filter(
      (slot) => slot.eligiblePositions.length === 1
        && DEDICATED_KDEF_POSITIONS.has(slot.eligiblePositions[0])
    )
    .reduce((sum, slot) => sum + slot.count, 0);
}

/**
 * Ruling 6 (issue #784, ADR 0027): "early" for a kicker or defense is
 * relative to the league's own roster shape, never a fixed round number.
 *
 * True while there is still at least as much draft left as the team has
 * unfilled DEDICATED K + DEF starting slots to fill — there's slack, so
 * grabbing one now reads as jumping the gun. It flips to false once fewer
 * rounds remain than that: the exact point ruling 6 names as where waiting
 * any longer stops being an option, i.e. it is no longer early, it is just
 * necessary. A template with no K or DEF slots at all has nothing to be
 * early FOR, so it is always false.
 *
 * @param {object} args
 * @param {Array}  args.rosterSlots  the league's roster_slots shape
 * @param {Array}  args.roster       the team's picks so far ({ pickNumber, position, ... })
 * @param {number} args.round        the round being evaluated
 * @param {number} args.draftRounds  total rounds in the draft
 */
export function earlyKickerOrDefense({
  rosterSlots = [], roster = [], round, draftRounds,
}) {
  const unfilled = unfilledKickerDefenseSlots({ roster, rosterSlots });
  if (unfilled === 0) return false;
  const roundsRemaining = draftRounds - round;
  return roundsRemaining >= unfilled;
}
