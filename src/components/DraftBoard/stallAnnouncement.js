/**
 * A stall is a STATE, not an event, so it has two edges (#648, resolving #653's
 * exit gap): the `stalled` entry that ENTERS the stuck state, and a lifecycle
 * transition that LEAVES it. The room-level announcer (StallAnnouncer.jsx) must
 * react to BOTH - it speaks on entry and CLEARS on exit - or "The draft is stuck
 * on <Team>" stands in the accessibility tree forever, now on every tab (the
 * announcer is room-level since #648, no longer torn down with the Chat tab).
 *
 * This module owns only the entry/exit CLASSIFICATION, shared by its two
 * callers - StallAnnouncer.jsx and DraftBoard.jsx's onDraftActivity, which gates
 * what it records into lastStallActivity by isStallRelevant - and pinned against
 * the server roster by stallAnnouncement.parity.test.js. The stall TEXT
 * (stallAnnouncementFor) has exactly one caller and moved into StallAnnouncer.jsx
 * as a module-private function in #791; it is not part of this shared surface.
 *
 * The exit set is DERIVED from the Draft lifecycle kinds by exclusion, never a
 * hand-written parallel list that could drift: it is every lifecycle kind EXCEPT
 * the ones that do not end a stuck state. LIFECYCLE_KINDS mirrors the server's
 * roster (server/services/draftActivity.js). react-scripts's WEBPACK BUILD
 * confines runtime imports to src/ (ModuleScopePlugin), so the client carries its
 * own copy rather than pulling the server module into the bundle - but jest has
 * no such confinement, so stallAnnouncement.parity.test.js imports the server
 * LIFECYCLE_KINDS and FAILS if the two drift (the house pattern, e.g.
 * chatLimits.parity.test.js). A new lifecycle kind added on the server is an EXIT
 * by default here (it clears) unless it is also added to NON_EXIT_KINDS, which is
 * the safe direction: a stall that lingers is worse than one cleared a beat early.
 *
 * NON_EXIT_KINDS, and why each is here:
 *  - `stalled` is the ENTRY edge, not an exit.
 *  - `pause` does NOT clear: a nothing-draftable stall already implies the draft
 *    is paused (ADR 0018, the paused-then-resumed shape), so a pause that follows
 *    a stall is the same stuck state, not the end of it. Clearing on it would
 *    silence a still-stuck draft.
 *  - `draft_start` is the opening transition, not a stuck-state exit.
 */
// Exported so stallAnnouncement.parity.test.js can pin it to the server roster.
export const LIFECYCLE_KINDS = Object.freeze([
  'draft_start', 'pause', 'resume', 'reset', 'complete', 'stalled',
]);
const STALL_ENTRY_KIND = 'stalled';
const NON_EXIT_KINDS = new Set(['draft_start', 'pause', STALL_ENTRY_KIND]);
export const STALL_EXIT_KINDS = Object.freeze(
  LIFECYCLE_KINDS.filter((kind) => !NON_EXIT_KINDS.has(kind))
); // => resume, reset, complete

/** The stall ENTRY edge: the nothing-draftable stall itself. */
export function isStallEntry(entry) {
  return !!entry && entry.type === 'draft_activity' && entry.kind === STALL_ENTRY_KIND;
}

/** A stall EXIT edge: a lifecycle transition that ends the stuck state. */
export function isStallExit(entry) {
  return !!entry && entry.type === 'draft_activity' && STALL_EXIT_KINDS.includes(entry.kind);
}

/**
 * A stall-relevant lifecycle entry: either edge of the stuck state. The room
 * records exactly these off the live seam and nothing else, so a pick, a
 * correction, a pause or draft_start never reaches the announcer.
 */
export function isStallRelevant(entry) {
  return isStallEntry(entry) || isStallExit(entry);
}
