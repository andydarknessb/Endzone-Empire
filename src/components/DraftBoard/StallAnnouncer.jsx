import React, { useEffect } from 'react';
import { teamNameLabel } from '../../lib/teamIdentity';
import { isStallExit } from './stallAnnouncement';
import PoliteRegion from './PoliteRegion';
import { useAnnouncement } from './useAnnouncement';

/**
 * The Draft room's ROOM-LEVEL stall announcer (#636, made room-level in #648): a
 * visually hidden polite region (PoliteRegion, #791) that speaks a
 * nothing-draftable stall (#602) when the draft ENTERS the stuck state live.
 *
 * ROOM-LEVEL, LIKE THE PICK ANNOUNCER (#648). This mounts in the Draft room's
 * chrome, above the tabs and present in both layouts, so a stall is heard on the
 * Players, Board and Draft tabs too - not only while Chat is mounted. That is the
 * gap #648 closed, and it is the same judgement #513 already made for Picks: a
 * sighted manager on the Board tab sees the clock stop and the banner read "Draft
 * paused", so an assistive-technology user on that tab must hear the stall too. A
 * stall lands on the Pick side of #513's test, not the message side. The
 * chat-scoped mount is gone (DraftRoomChat no longer renders this), so a wide
 * container - where the Chat pane is always present for a member - does not speak
 * the same stall twice.
 *
 * FED BY A LIVE-ONLY SOCKET SEAM, NOT THE FEED - AND THAT IS THE BACKLOG GUARD.
 * It is driven by the `stall` prop, the newest live stalled entry the room
 * records from useDraftSocket's draft:activity seam (DraftBoard.lastStallActivity),
 * or null before any stall has landed. This REPLACES the seq high-water gating the
 * feed-driven version needed. When it consumed the combined `entries` feed it had
 * to seed a seq high-water mark from the first non-empty feed so the opening
 * backlog, a history REPLACE and a Load-older prepend all stayed silent; a
 * room-level socket seam has no such backlog to guard against. Feed history
 * reaches the client only on draft:state (the join snapshot) and the feed's REST
 * fetch, neither of which touches the live draft:activity event, so a stall
 * present only in the opening backlog never reaches this prop - a room opening
 * onto an already-stuck draft is a state to READ (still shown in the banner and
 * the feed's stuck-state line), not a live freeze to announce. The one cost, the
 * same trade #513 made for Picks: a stall that landed during a disconnect is not
 * re-spoken on reconnect (the combined feed's after-cursor catch-up would have),
 * but a persisting stall stays visible in the banner and the feed line (#648
 * accepted delta).
 *
 * A STATE HAS TWO EDGES, SO THE PROP CARRIES BOTH (#648, #653). Unlike a Pick -
 * an event PickAnnouncer speaks and never clears - a stall is a STATE: "the draft
 * is stuck" is a standing assertion about the world, so it must be RETRACTED when
 * the world changes. The `stall` prop is therefore the newest stall-RELEVANT
 * lifecycle entry the room records (DraftBoard's onDraftActivity, gated by
 * isStallRelevant, still in stallAnnouncement.js - ADR 0028 keeps the two
 * callers' shared predicates there): the `stalled` ENTRY edge, or an EXIT edge
 * (resume/reset/complete) that ends the stuck state. On an entry this speaks; on
 * an exit it CLEARS to empty via the shared useAnnouncement hook's `announce('')`
 * (mutating the node value without announcing silence, the FeedAnnouncer
 * empty-clear idiom), so a browse-mode reader does not find "The draft is stuck"
 * lingering after the draft resumed, was reset, or completed - a regression that
 * would otherwise stand for the life of the room, on every tab, now that the
 * announcer is room-level. `pause` is deliberately NOT an exit (a stall already
 * implies paused, ADR 0018); the exclusion lives in stallAnnouncement.js.
 * Modelling this on PickAnnouncer alone (entry only) is exactly what would drop
 * the exit.
 *
 * KEYED ON THE PROP'S IDENTITY, LIKE PICKANNOUNCER. Only a genuinely new entry
 * re-fires the region: the effect keys on the prop's identity, so an ordinary
 * rerender that hands the same object back (a pool refetch, a clock tick) changes
 * nothing. Each live transition is a fresh payload object, so its identity
 * changes and the announcer reacts exactly once per transition.
 *
 * WHY A DEDICATED REGION, NOT A BRANCH OF THE FEED ANNOUNCER. The combined-feed
 * announcer no-ops ALL draft_activity on purpose: falling through would blank a
 * still-unread "New message from X" every time activity lands, and activity is
 * constant in an active draft. A stall is categorically different - it HALTS the
 * draft until a commissioner acts and names a required human action - so it must
 * be spoken. But announcing it THROUGH the shared chat region would overwrite
 * that unread chat announcement: the same defect the feed announcer's early
 * return prevents, in the other direction. So the stall gets its OWN region here;
 * the feed announcer's early return and its unread-chat protection are untouched,
 * and a stall landing leaves the chat region's current text exactly as it was.
 *
 * Like PickAnnouncer and unlike the chat half of the feed announcer, a stall is
 * NEVER suppressed by viewer identity: it is addressed to whichever commissioner
 * can resolve it, so this takes no viewerTeamId.
 *
 * Two DIFFERENT stalls can describe identically - two stalls on one Team with the
 * same cause, the second after the first was resolved and resumed. The shared
 * useAnnouncement hook (#791, folding announcerRepeat.js in) appends a zero-width
 * space on an exact repeat so the node value still changes and the second stall
 * is announced. What moved to the hook is that two-line repeat idiom alone; the
 * entry/exit gating above stays here, per ADR 0028 - do not introduce a shared
 * gating hook.
 */
function StallAnnouncer({ stall = null }) {
  const [announcement, announce] = useAnnouncement();

  useEffect(() => {
    if (!stall) return;
    // The EXIT edge (resume/reset/complete): the stuck state ended, so clear to
    // empty. Checked FIRST so an exit is never mistaken for a silent no-op.
    if (isStallExit(stall)) {
      announce('');
      return;
    }
    const text = stallAnnouncementFor(stall);
    if (!text) return; // defensive: a non-stall-relevant entry never reaches here
    // The ENTRY edge: the shared repeat-safe update (useAnnouncement). When the
    // new text would exactly repeat what is CURRENTLY RENDERED it appends a
    // zero-width space so the node value still changes and the repeat is
    // announced; otherwise it sets clean. Comparing against `prev` (not a parity
    // counter) keeps this correct across any interleaving - see the hook and
    // PickAnnouncer.
    announce(text);
  }, [stall, announce]);

  return <PoliteRegion text={announcement} />;
}

/**
 * The concise polite-region text for a nothing-draftable stall (#636), moved
 * module-private here in #791 - the one caller made the pure-function/component
 * split #791's rulings 4 and 5 ask for unnecessary. The entry/exit
 * predicates (isStallEntry, isStallExit, isStallRelevant) and the lifecycle
 * roster stay in stallAnnouncement.js: they have two callers apiece (this
 * component and DraftBoard.jsx) and stallAnnouncement.parity.test.js pins the
 * roster against the server, so they are not this component's alone to move.
 *
 * A stall (#602) is the one Draft-activity kind that HALTS the draft until a
 * commissioner acts. Every other draft_activity kind is silent in the
 * COMBINED-FEED announcer on purpose - it no-ops all draft_activity so it never
 * blanks an unread chat announcement. (Picks are not silent room-wide: they
 * moved to the room-level PickAnnouncer, #513, which speaks every live Pick -
 * they are just silent in the feed announcer.) A stall halts the room and names
 * a required human action, so it earns a spoken announcement of its own rather
 * than being swallowed by that feed-announcer silence.
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
function stallAnnouncementFor(entry) {
  if (!entry || entry.type !== 'draft_activity' || entry.kind !== 'stalled') return '';
  // The cause and the next step, mirroring #620's visible line + caption stance
  // (no em-dash, house style). One sentence: a polite region reads it whole.
  const stuck = entry.teamName != null
    ? `The draft is stuck on ${teamNameLabel(entry.teamName)}: no draftable player.`
    : 'The draft is stuck: no draftable player.';
  return `${stuck} A commissioner must resolve and resume.`;
}

export default StallAnnouncer;
