import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The concise polite-region text for a nothing-draftable stall (#636), kept a
 * pure function so the string is unit-tested on its own and StallAnnouncer is
 * only responsible for WHEN it changes - the same split feedAnnouncement.js /
 * FeedAnnouncer.jsx (#445) and pickAnnouncement.js / PickAnnouncer.jsx (#513)
 * use.
 *
 * A stall (#602) is the one Draft-activity kind that HALTS the draft until a
 * commissioner acts. Every OTHER draft_activity entry is silent to a screen
 * reader on purpose - Picks moved to the room-level PickAnnouncer (#513), and
 * the combined-feed announcer no-ops all draft_activity so it never blanks an
 * unread chat announcement (feedAnnouncement.js) - but a stall halts the room
 * and names a required human action, so it earns a spoken announcement of its
 * own.
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

export default stallAnnouncementFor;
