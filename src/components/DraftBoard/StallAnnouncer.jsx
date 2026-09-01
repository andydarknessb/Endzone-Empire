import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { stallAnnouncementFor, isStallExit } from './stallAnnouncement';
import { nextAnnouncement } from './announcerRepeat';

/**
 * The Draft room's ROOM-LEVEL stall announcer (#636, made room-level in #648): a
 * visually hidden polite region that speaks a nothing-draftable stall (#602) when
 * the draft ENTERS the stuck state live. It follows the room's construction idiom
 * - a Box with role="status" / aria-live="polite", styled visuallyHidden, whose
 * only mutation is its TEXT, as the room-level Pick announcer (PickAnnouncer,
 * #513), ReadinessAnnouncer (#164), the combined-feed announcer (FeedAnnouncer,
 * #445) and ComposerCharacterCount (#486) all do.
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
 * records from useDraftSocket's draft:activity seam (DraftBoard.lastStall), or
 * null before any stall has landed. This REPLACES the seq high-water gating the
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
 * isStallRelevant): the `stalled` ENTRY edge, or an EXIT edge (resume/reset/
 * complete) that ends the stuck state. On an entry this speaks; on an exit it
 * CLEARS to empty (mutating the node value without announcing silence, the
 * FeedAnnouncer empty-clear idiom), so a browse-mode reader does not find "The
 * draft is stuck" lingering after the draft resumed, was reset, or completed - a
 * regression that would otherwise stand for the life of the room, on every tab,
 * now that the announcer is room-level. `pause` is deliberately NOT an exit (a
 * stall already implies paused, ADR 0018); the exclusion lives in
 * stallAnnouncement.js. Modelling this on PickAnnouncer alone (entry only) is
 * exactly what would drop the exit.
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
 * nextAnnouncement helper (announcerRepeat.js) appends a zero-width space on an
 * exact repeat so the node value still changes and the second stall is announced.
 */
function StallAnnouncer({ stall = null }) {
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!stall) return;
    // The EXIT edge (resume/reset/complete): the stuck state ended, so clear to
    // empty. Checked FIRST so an exit is never mistaken for a silent no-op.
    if (isStallExit(stall)) {
      setAnnouncement('');
      return;
    }
    const text = stallAnnouncementFor(stall);
    if (!text) return; // defensive: a non-stall-relevant entry never reaches here
    // The ENTRY edge: the shared repeat-safe update (announcerRepeat.js). When the
    // new text would exactly repeat what is CURRENTLY RENDERED it appends a
    // zero-width space so the node value still changes and the repeat is
    // announced; otherwise it sets clean. Comparing against `prev` (not a parity
    // counter) keeps this correct across any interleaving - see the helper and
    // PickAnnouncer.
    setAnnouncement((prev) => nextAnnouncement(prev, text));
  }, [stall]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default StallAnnouncer;
