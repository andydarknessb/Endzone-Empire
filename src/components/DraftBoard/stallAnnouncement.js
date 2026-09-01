import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The concise polite-region text for a nothing-draftable stall (#636), kept a
 * pure function so the string is unit-tested on its own and StallAnnouncer is
 * only responsible for WHEN it changes - the same split feedAnnouncement.js /
 * FeedAnnouncer.jsx (#445) and pickAnnouncement.js / PickAnnouncer.jsx (#513)
 * use.
 *
 * A stall (#602) is the one Draft-activity kind that HALTS the draft until a
 * commissioner acts. Every other draft_activity kind is silent in the
 * COMBINED-FEED announcer on purpose - it no-ops all draft_activity so it never
 * blanks an unread chat announcement (feedAnnouncement.js). (Picks are not
 * silent room-wide: they moved to the room-level PickAnnouncer, #513, which
 * speaks every live Pick - they are just silent in the feed announcer.) A stall
 * halts the room and names a required human action, so it earns a spoken
 * announcement of its own rather than being swallowed by that feed-announcer
 * silence.
 *
 * The text names the CAUSE (no draftable player) and the NEXT STEP (a
 * commissioner must resolve and resume), derived from #620's visible
 * stuck-state line and its caption (DraftActivityEntry.StalledActivityLine) and
 * holding #620's stance: the Team may be NAMED but is never cast as the actor
 * ("stuck on <Team>", never "<Team> stalled the draft"), because the draft
 * stalled ON the Team through no act of its own. This is deliberately SEPARATE
 * copy from #620's visible line - a polite announcement is one sentence, not a
 * line plus a caption - but it must not drift from that stance; #620 owns the
 * visible copy and this must not edit it.
 *
 * A null Team reads as a plain stuck-state line rather than "Former manager": a
 * stall names the Team only to locate the stuck pick, and a scheduler-shaped
 * null actor is a plain state, exactly as the sibling visible line
 * (DraftActivityEntry.StalledActivityLine) treats it. The guard is
 * `teamName != null`, so - matching that sibling line's inherited gap exactly -
 * an empty or whitespace-only teamName does NOT take the plain-line branch; it
 * falls through to teamNameLabel's shared former-manager label, the same as
 * every other line rendered from a Team identity. A real stall carries either a
 * genuine name or a null actor, so this gap is defensive, not a live case.
 *
 * Only a `stalled` draft_activity entry has text here; anything else returns the
 * empty string, the real return StallAnnouncer keeps its region mounted and
 * silent for (the ReadinessAnnouncer #164 lesson).
 */
export function stallAnnouncementFor(entry) {
  if (!entry || entry.type !== 'draft_activity' || entry.kind !== 'stalled') return '';
  // The cause and the next step, mirroring #620's visible line + caption stance
  // (no em-dash, house style). One sentence: a polite region reads it whole.
  const stuck = entry.teamName != null
    ? `The draft is stuck on ${teamNameLabel(entry.teamName)}: no draftable player.`
    : 'The draft is stuck: no draftable player.';
  return `${stuck} A commissioner must resolve and resume.`;
}

/**
 * A stall is a STATE, not an event, so it has two edges (#648, resolving #653's
 * exit gap): the `stalled` entry that ENTERS the stuck state, and a lifecycle
 * transition that LEAVES it. The room-level announcer must react to BOTH - it
 * speaks on entry and CLEARS on exit - or "The draft is stuck on <Team>" stands
 * in the accessibility tree forever, now on every tab (the announcer is room-level
 * since #648, no longer torn down with the Chat tab).
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

export default stallAnnouncementFor;
