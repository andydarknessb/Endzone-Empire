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
 * Implements #785's acceptance criteria exactly: false in the final round
 * for a one-K one-DEF template, true two rounds earlier (same template, same
 * empty roster), and false in every round for a template with no K or DEF
 * slots at all. Concretely: true while at least as many rounds remain as the
 * team's unfilled DEDICATED K + DEF starting slots (there's slack, so
 * grabbing one now reads as jumping the gun); false once fewer rounds remain
 * than that. A template with no K or DEF slots has nothing to be early for,
 * so it is always false regardless of rounds remaining.
 *
 * Issue #784 ruling 6's original wording ("early... is relative: fewer
 * rounds remain than the team's unfilled K plus DEF starting slots") read as
 * the INVERSE of the predicate above: taken literally, it would only read as
 * "early" once the team is nearly out of rounds to grab K/DEF, which would
 * roast a kicker or defense pick at precisely the point where taking one is
 * correct. This function follows #785's acceptance criteria. #796 confirmed
 * the acceptance criteria were right, and ruling 6 was amended on 2026-09-03
 * to match this predicate (ADR 0027 carries the same dated amendment); this
 * code does not change.
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
