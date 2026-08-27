import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { feedEntryKey } from '../../lib/teamIdentity';
import { feedAnnouncementFor } from './feedAnnouncement';

// A zero-width space (U+200B): appended to alternate announcements so that two
// different entries which describe with byte-identical text still change the
// live region's text node and are both announced. It is not rendered and not
// spoken. Built from its code point so no invisible literal sits in source.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * The Draft room's combined-feed announcer (#445 AC2): one persistent, visually
 * hidden polite region that speaks a CONCISE summary when a human message
 * arrives live. It follows the room's established idiom exactly - the room's
 * other visually-hidden status regions (ReadinessAnnouncer #164, the countdown
 * #117, ComposerCharacterCount #486) mount a Box with role="status" /
 * aria-live="polite", styled visuallyHidden, and only change its TEXT.
 *
 * IT NO LONGER ANNOUNCES PICKS (#513). Picks moved to the room-level
 * PickAnnouncer, mounted in the Draft room's chrome so a committed Pick is heard
 * on every tab and exactly once; this Chat-scoped announcer speaks human
 * messages only. Do NOT re-add a Pick branch here or route a Pick tail into the
 * empty-clear below - either reintroduces the double-speech #513 exists to
 * prevent (when Chat is mounted) or blanks a still-unread message announcement.
 * If you are here to fix #518 (the parity-flip desync), it is the flip alone;
 * the Pick removal is intentional and must stay.
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
 *  - It carries a DIFFERENT axis: human-message arrival, which neither the
 *    counter nor the banner announces. Folding it into one would make that
 *    region speak two unrelated things.
 *  - It fires on a live arrival, identified by the NEWEST entry advancing the
 *    shared per-league seq past the highest we have announced. A render that does
 *    not change the tail says nothing, and there is no timer and no debounce, so
 *    it cannot chatter the way a per-tick region would.
 *  - It announces PRESENCE, not content, and only human-message arrivals
 *    (feedAnnouncement.js), so it stays terse rather than reading long message
 *    bodies or every lifecycle transition.
 *
 * What a test can show about this region - that it exists, its DOM order, and
 * that its text changes exactly on a strictly-newer entry - is asserted here and
 * in FeedAnnouncer.test.js. Whether a reader actually reaches an announcement
 * before a later one supersedes it is not observable from a test and is verified
 * by a human (#156).
 *
 * WHAT IT DOES NOT ANNOUNCE, on purpose:
 *  - The feed already present when the room opens (backlog, not new): the first
 *    non-empty feed seeds the seq high-water mark silently.
 *  - Older entries paged in by Load older, and a `/draft-feed` history fetch that
 *    resolves wholesale AFTER a live message already seeded us: both leave the
 *    tail at or below the high-water seq, so neither is spoken. Keying on the tail
 *    key alone was not enough here - a hard history replace can move the tail to
 *    an OLDER row with a different key - so the guard is the monotonic seq.
 *  - The viewer's OWN message: the server echoes a send to the whole room
 *    including the sender, and a manager does not need their own line read back.
 *    Suppressed by teamId in feedAnnouncement.
 *
 * TWO ENTRIES THAT DESCRIBE IDENTICALLY. Two messages from the same Team both
 * read "New message from <Team>". React bails on an Object.is-equal state, so a
 * byte-identical string would leave the text node untouched and the second
 * arrival silent. A zero-width space flips on alternate announcements to change
 * the node value - but the parity counter that drives it has a desync defect
 * (#518): a different entry between two repeat-pairs (A, A, B, B) leaves the
 * fourth silent. PickAnnouncer.jsx (#513) fixed the same shape by comparing
 * against the rendered value; this announcer is left for #518. This is distinct
 * from the identical-TAIL rerender above, which is a non-event and stays silent.
 */
function FeedAnnouncer({ entries = [], viewerTeamId = null }) {
  const [announcement, setAnnouncement] = useState('');
  // The tail key we have already accounted for, and the highest seq we have
  // announced or seeded. null/-Infinity until the first non-empty feed seeds
  // them silently, so the opening backlog is never announced.
  const lastKeyRef = useRef(null);
  const highWaterSeqRef = useRef(-Infinity);
  const initialisedRef = useRef(false);
  // The last BASE announcement text (without any marker), and a flip used only
  // when a new announcement would repeat it (see below).
  const lastTextRef = useRef('');
  const nonceRef = useRef(0);

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
    // An identical-tail rerender is not a new entry: stay silent (correct, and
    // the reviewer confirmed it).
    if (tailKey === lastKeyRef.current) return;
    lastKeyRef.current = tailKey;

    // Only a strictly-newer entry is a live arrival. A tail that is not newer by
    // seq is a backlog REPLACE - a `/draft-feed` history fetch that resolves
    // wholesale after a live message already seeded us (useDraftRoomFeed does a
    // hard setEntries) - or a Load-older prepend, and neither is new: do not
    // announce it. Entries without a seq fall back to "the tail key changed",
    // the pre-seq behaviour, since live entries always carry a seq.
    if (tailSeq != null) {
      if (tailSeq <= highWaterSeqRef.current) return;
      highWaterSeqRef.current = tailSeq;
    }

    // ALL Draft activity - a Pick (now the room-level PickAnnouncer's, #513) and
    // every lifecycle entry (draft_start, pause, resume, reset, complete) alike -
    // is a NO-OP here, keyed on the entry type rather than kind=pick so both are
    // covered. Draft activity still advances the seq high-water mark above so a
    // later message is not taken for backlog, but it must NOT fall through to the
    // empty-clear below: that would BLANK a still-unread chat announcement (the
    // previous "New message from X") every time activity lands, and in an active
    // draft that is constant. Leave the region's current text untouched. This is
    // distinct from the deliberate clear for a hidden arrival or the viewer's own
    // message below, which stays exactly as it was (#513 did not change it).
    if (tail && tail.type === 'draft_activity') return;

    const text = feedAnnouncementFor(tail, viewerTeamId);
    if (!text) {
      // A lifecycle entry, a hidden arrival, or the viewer's own message: clear
      // to empty. That mutates the node value rather than removing the node, so
      // there is no announcement of silence.
      setAnnouncement('');
      lastTextRef.current = '';
      return;
    }
    // Two DIFFERENT entries can describe identically - two messages from the same
    // Team both read "New message from <Team>". React bails on an Object.is-equal
    // state, so a byte-identical string would leave the region's text node
    // untouched and a screen reader silent: the first announced, the rest lost.
    // Only when the new text WOULD repeat the last announcement, append a
    // zero-width space that flips, so the node value changes and the repeat is
    // announced; the marker is invisible and unspoken. Distinct messages stay
    // clean. This is not the identical-tail case above - that returns before here
    // and stays deliberately silent.
    // NOTE: this parity-counter flip has a desync defect - a different entry
    // landing between two repeat-pairs (A, A, B, B) leaves the fourth silent,
    // because the global nonce decouples from the currently-rendered value.
    // PickAnnouncer.jsx (#513) DIVERGED from this to compare against the rendered
    // value instead, which has no counter to desync; do not re-merge them. Left
    // as-is here deliberately: #518 owns this fix and its own blast radius (a
    // live message-announcement defect on integration), with its own test.
    let out = text;
    if (text === lastTextRef.current) {
      nonceRef.current += 1;
      out = nonceRef.current % 2 ? text + ZERO_WIDTH_SPACE : text;
    }
    lastTextRef.current = text;
    setAnnouncement(out);
  }, [tailKey, tailSeq, tail, viewerTeamId]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default FeedAnnouncer;
