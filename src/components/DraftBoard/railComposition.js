/**
 * What the Draft rail is made of, and in what order, for each draft status
 * (issue #123 acceptance criteria 1-4, parent spec #108).
 *
 * The rail used to be one permanently stacked list - queue, readiness, Draft
 * order, roster, the whole Pick history - rendered identically whether the
 * draft had not started, was live, or had finished months ago. Each status is
 * a different job, so each gets a deliberate composition, and this module is
 * the single statement of what those are. A panel's own render conditions
 * (does this viewer hold a Team? has the order been settled?) stay with the
 * panel; what is asked here is only "which panels does this status compose,
 * and in which order".
 *
 * Two absences are load-bearing rather than oversights:
 *
 *   - Readiness composes into `pending` alone. It is a fact of the pending
 *     lobby and has no meaning once the draft starts (CONTEXT.md: Readiness).
 *
 *   - Pick history composes into no status at all. It is the chronological
 *     view of the same committed Picks the Draft board already holds
 *     (CONTEXT.md: Draft board), so it is a collapsible view inside Board and
 *     never a second rail panel competing with live decisions.
 *
 * On the clock is the fourth member of the active composition and is likewise
 * not listed here, for the opposite reason: it is persistent. It is the banner
 * that sits above the rail's own bounded scrolling region (issue #122) and
 * stays visible across every mobile tab. A copy inside the rail would scroll
 * out of view, which is the one thing it must not do.
 */

/** The panels a composition can name. */
export const RAIL_PANELS = {
  READINESS: 'readiness',
  ORDER: 'order',
  QUEUE: 'queue',
  ROSTER: 'roster',
  UPCOMING: 'upcoming',
  ASSISTANT: 'assistant',
};

// Assistant composes into `active` alone (issue #787 ruling item 1). It is the
// private, opt-in Draft assistant voice (spec #784), which comments only on a
// LIVE draft's own picks, Queue and Pick clock; it has nothing to say in the
// pending lobby or over a finished record. It is listed here UNCONDITIONALLY,
// toggle on or off: composition answers "does this status want this panel", and
// the panel itself answers "do I have anything to say" - the assistant panel
// renders nothing while the toggle is off (DraftRoomAssistant.jsx), the same
// decline-to-render contract Readiness/Roster/Upcoming already use.
const PENDING = [RAIL_PANELS.READINESS, RAIL_PANELS.ORDER, RAIL_PANELS.QUEUE];
const ACTIVE = [RAIL_PANELS.QUEUE, RAIL_PANELS.ROSTER, RAIL_PANELS.UPCOMING, RAIL_PANELS.ASSISTANT];
const COMPLETE = [RAIL_PANELS.ROSTER];

/**
 * The ordered panel keys for one draft status.
 *
 * An unrecognised status - including the `undefined` every render sees before
 * the first draft:state frame lands - composes as active. That is the status
 * a live draft room is opened in overwhelmingly often, and it keeps My Queue
 * (the one panel that needs no draft state to be useful) on screen instead of
 * leaving the rail blank while the socket connects.
 */
export function railCompositionFor(draftStatus) {
  if (draftStatus === 'pending') return PENDING;
  if (draftStatus === 'complete') return COMPLETE;
  return ACTIVE;
}
