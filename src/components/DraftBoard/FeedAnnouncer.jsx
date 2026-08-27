import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { feedEntryKey } from '../../lib/teamIdentity';
import { feedAnnouncementFor } from './feedAnnouncement';

/**
 * The Draft room's combined-feed announcer (#445 AC2): one persistent, visually
 * hidden polite region that speaks a CONCISE summary when a human message or a
 * Pick arrives live. It follows the room's established idiom exactly -
 * ReadinessAnnouncer (#164), CountdownAnnouncer (#117) and ComposerCharacterCount
 * (#486) all mount one permanently-present Box with role="status" /
 * aria-live="polite", styled visuallyHidden, and only change its TEXT.
 *
 * WHY A SEPARATE POLITE REGION, AND WHO IT ACTUALLY SHARES A PHASE WITH. The
 * room's other polite regions are phase-separated: readiness (#164) and the
 * Draft-schedule countdown (#117) belong to a PENDING draft, while this feed and
 * the On-the-clock banner belong to an ACTIVE one, and a draft is one or the
 * other, never both. So the only regions this announcer genuinely coexists with,
 * during the active phase, are the composer character counter (#486) and the
 * On-the-clock banner (LiveDraftBanner) - two, not a crowd. It still earns its
 * place rather than folding into either:
 *
 *  - It carries a DIFFERENT axis: message/Pick arrival, which neither the
 *    counter nor the banner announces. Folding it into one would make that
 *    region speak two unrelated things.
 *  - Its text is derived purely from the NEWEST entry's identity (feedEntryKey),
 *    the same "state that matters" shape as #486's per-band counter and the
 *    banner's on-the-clock text: a render that does not change the tail renders
 *    the identical text node and assistive tech says nothing between renders.
 *    There is no timer and no debounce, so it cannot chatter the way a per-tick
 *    region would.
 *  - It announces PRESENCE, not content, and only two kinds (feedAnnouncement.js),
 *    so it stays terse rather than reading long message bodies or every
 *    lifecycle transition.
 *
 * What a test can show about this region - that it exists, its DOM order, and
 * that its text only changes on a new tail - is asserted here and in
 * FeedAnnouncer.test.js. Whether a reader actually reaches an announcement before
 * a later one supersedes it is not observable from a test and is verified by a
 * human (#156).
 *
 * WHAT IT DOES NOT ANNOUNCE, on purpose: the feed that is already present when
 * the room opens (that is backlog, not new), and older entries paged in by Load
 * older (those grow the HEAD; the tail the reader follows is unchanged). Both
 * fall out of keying on the tail entry alone. The very first entry to land in a
 * room that opened EMPTY is treated as that opening state and is also not
 * announced - a deliberate bias against ever voicing something the reader did not
 * just receive live, at the cost of the single first message in an empty room.
 */
function FeedAnnouncer({ entries = [] }) {
  const [announcement, setAnnouncement] = useState('');
  // The tail entry we have already accounted for. null until the first non-empty
  // feed seeds it silently, so the opening backlog is never announced.
  const seededKeyRef = useRef(null);
  const initialisedRef = useRef(false);

  const tail = entries.length ? entries[entries.length - 1] : null;
  const tailKey = tail ? feedEntryKey(tail) : null;

  useEffect(() => {
    if (!initialisedRef.current) {
      // Seed on the first non-empty feed WITHOUT announcing; stay uninitialised
      // while the feed is still empty so a genuine first arrival can seed too.
      if (tailKey == null) return;
      initialisedRef.current = true;
      seededKeyRef.current = tailKey;
      return;
    }
    if (tailKey !== seededKeyRef.current) {
      seededKeyRef.current = tailKey;
      // An empty string is a valid, silent announcement (lifecycle or a hidden
      // arrival): the region stays mounted and simply says nothing.
      setAnnouncement(feedAnnouncementFor(tail));
    }
  }, [tailKey, tail]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default FeedAnnouncer;
