import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { feedEntryKey } from '../../lib/teamIdentity';
import { stallAnnouncementFor } from './stallAnnouncement';
import { nextAnnouncement } from './announcerRepeat';

/**
 * The Draft room's stall announcer (#636): one persistent, visually hidden
 * polite region that speaks a nothing-draftable stall (#602) when a live
 * stalled entry arrives. It follows the room's established idiom - a Box with
 * role="status" / aria-live="polite", styled visuallyHidden, whose only
 * mutation is its TEXT, as ReadinessAnnouncer (#164), the room-level Pick
 * announcer (PickAnnouncer, #513), the combined-feed announcer (FeedAnnouncer,
 * #445) and ComposerCharacterCount (#486) all do.
 *
 * WHY A DEDICATED REGION, NOT A BRANCH OF THE FEED ANNOUNCER. The combined-feed
 * announcer no-ops ALL draft_activity on purpose: falling through would blank a
 * still-unread "New message from X" every time activity lands, and activity is
 * constant in an active draft. A stall (#602) is categorically different from
 * the picks and lifecycle that stance was written for - it HALTS the draft until
 * a commissioner acts and names a required human action - so it must be spoken.
 * But announcing it THROUGH the shared chat region would overwrite that unread
 * chat announcement: the same defect the feed announcer's early return prevents,
 * in the other direction. So the stall gets its OWN region here; the feed
 * announcer's early return and its unread-chat protection are left exactly as
 * they are, and a stall landing leaves the chat region's current text untouched.
 *
 * ARRIVAL SEMANTICS, following FeedAnnouncer exactly over the same combined
 * `entries` feed (the room-level PickAnnouncer #513 is the model for being a
 * dedicated region with its own high-water gating):
 *  - a monotonic seq high-water mark, seeded silently by the first non-empty
 *    feed, so the opening BACKLOG is never announced - even a backlog whose tail
 *    is a stalled entry (a room opening onto an already-stalled draft is a state
 *    to read, not a live freeze to announce);
 *  - a wholesale `/draft-feed` history REPLACE that drops the tail to an older
 *    seq, and a Load-older PREPEND, both leave the tail at or below the
 *    high-water seq and are silent - neither is a new arrival;
 *  - only a strictly-newer tail is a live arrival. A newer tail that is NOT a
 *    stall (a chat message, a Pick, another lifecycle entry) advances the
 *    high-water mark but leaves this region's text untouched, so a standing
 *    stall announcement is not blanked by ordinary activity landing after it -
 *    the mirror of the feed announcer's own no-op toward activity.
 *
 * Like PickAnnouncer and unlike the chat half of the feed announcer, a stall is
 * NEVER suppressed by viewer identity: it is addressed to whichever commissioner
 * can resolve it, so this takes no viewerTeamId.
 *
 * Two DIFFERENT stalls can describe identically - two stalls on one Team with
 * the same cause, the second arriving after the first was resolved and resumed.
 * The shared nextAnnouncement helper (announcerRepeat.js, extracted at this third
 * consumer) appends a zero-width space on an exact repeat so the node value still
 * changes and the second stall is announced.
 *
 * What a test can show - that the region exists, and that its text changes
 * exactly on a strictly-newer live stall and on nothing else - is asserted in
 * StallAnnouncer.test.jsx and, against the real feed, in DraftRoomChat.test.jsx.
 */
function StallAnnouncer({ entries = [] }) {
  const [announcement, setAnnouncement] = useState('');
  // The tail key already accounted for, and the highest seq announced or seeded.
  // null/-Infinity until the first non-empty feed seeds them silently, so the
  // opening backlog is never announced.
  const lastKeyRef = useRef(null);
  const highWaterSeqRef = useRef(-Infinity);
  const initialisedRef = useRef(false);

  const tail = entries.length ? entries[entries.length - 1] : null;
  const tailKey = tail ? feedEntryKey(tail) : null;
  const tailSeq = tail && Number.isFinite(tail.seq) ? tail.seq : null;

  useEffect(() => {
    if (!initialisedRef.current) {
      // Seed on the first non-empty feed WITHOUT announcing; stay uninitialised
      // while the feed is still empty so a genuine first arrival can seed too.
      if (tailKey == null) return;
      initialisedRef.current = true;
      lastKeyRef.current = tailKey;
      if (tailSeq != null) highWaterSeqRef.current = tailSeq;
      return;
    }
    // An identical-tail rerender is not a new entry: stay silent.
    if (tailKey === lastKeyRef.current) return;
    lastKeyRef.current = tailKey;

    // Only a strictly-newer entry is a live arrival. A tail that is not newer by
    // seq is a backlog REPLACE (a wholesale `/draft-feed` history fetch after a
    // live seed) or a Load-older prepend, and neither is new. Entries without a
    // seq fall back to "the tail key changed", the pre-seq behaviour, since live
    // entries always carry a seq.
    if (tailSeq != null) {
      if (tailSeq <= highWaterSeqRef.current) return;
      highWaterSeqRef.current = tailSeq;
    }

    const text = stallAnnouncementFor(tail);
    // Only a stall speaks here. Every other newer tail (chat, Pick, lifecycle)
    // has advanced the high-water mark above but must leave this region's text
    // untouched - blanking it would wipe a still-relevant stall announcement the
    // instant ordinary activity lands, and activity is constant in a draft. This
    // is the mirror of the feed announcer's draft_activity no-op, in the other
    // direction, and it is why there is no empty-clear branch here at all.
    if (!text) return;
    setAnnouncement((prev) => nextAnnouncement(prev, text));
  }, [tailKey, tailSeq, tail]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default StallAnnouncer;
