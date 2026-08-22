/**
 * Shared rules for whether a manual Pick control may appear at all, and
 * whether it is only temporarily unavailable - the same question the player
 * pool table, Quick View, and the queue's quick-draft button all need
 * answered the same way (issue #120, parent spec #108).
 *
 * See CONTEXT.md's Draft/Draft type/Draft status/Pick/On the clock entries
 * for the vocabulary this mirrors.
 */

/**
 * Whether a manual Pick action exists in the current draft at all - not
 * merely whether it's clickable right now. Only an active, snake-type draft
 * ever hands a human a turn to act on:
 *  - pending: nothing has been claimed yet, there is nothing to Pick.
 *  - complete: the draft event is over.
 *  - autopick-type: every pick is made by autopick at once; no manual
 *    control ever exists (CONTEXT.md's Autopick entry).
 *  - offline-type: the commissioner enters every pick outside this table;
 *    draft.service.js rejects any other attempt with a 409.
 *  - auction-type: no live auction engine exists yet (never reaches active).
 *
 * `draftType` defaults to 'snake' when missing/null, matching the database
 * column (`leagues.draft_type` is NOT NULL DEFAULT 'snake') - a league row
 * that hasn't specified one is a snake draft, not a state where the field
 * happens to be absent.
 */
export function pickActionExists({ draftStatus, draftType }) {
  return draftStatus === 'active' && (draftType || 'snake') === 'snake';
}

/**
 * Whether an existing manual Pick control is temporarily unavailable: it's
 * not this viewer's turn, or the commissioner has paused the draft.
 */
export function pickTemporarilyUnavailable({ isMyTurn, draftPaused }) {
  return !isMyTurn || !!draftPaused;
}

/**
 * One reusable explanation for every temporarily-unavailable Pick control,
 * regardless of which specific reason applies - not a different string per
 * cause (issue #120 acceptance criterion 5).
 */
export const PICK_UNAVAILABLE_EXPLANATION =
  "You can only Pick when it's your turn and the draft isn't paused.";
