import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { feedEntryKey } from '../../lib/teamIdentity';
import { feedAnnouncementFor } from './feedAnnouncement';
import { nextAnnouncement } from './announcerRepeat';

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
 * The Pick removal is intentional and must stay: do not re-add a Pick branch.
 *
 * WHY A SEPARATE POLITE REGION, AND WHO IT ACTUALLY SHARES A PHASE WITH. The
 * room's other polite regions are phase-separated: readiness (#164) and the
 * Draft-schedule countdown (#117) belong to a PENDING draft, while this feed and
 * the On-the-clock banner belong to an ACTIVE one, and a draft is one or the
 * other, never both. So the only regions this announcer genuinely coexists with,
 * during the active phase, are the composer character counter (#486), the
 * On-the-clock banner (LiveDraftBanner) and, since #636, the stall announcer
 * (StallAnnouncer) - which shares this chat subtree because it reads the same
 * feed. A small, fixed set, each on its own axis, not a crowd. This one still
 * earns its place rather than folding into any of them:
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
 * arrival silent. So when the new text would exactly repeat the CURRENTLY
 * RENDERED announcement, a zero-width space is appended - invisible and unspoken -
 * so the node value still changes and the repeat is announced. Comparing against
 * the rendered value (the functional setState `prev`), not a separate last-text
 * ref or a parity counter, is what makes this hold for ANY interleaving: a
 * different entry landing between two repeats (A, A, B, B) cannot desync a counter
 * from what is on screen, because there is no counter (#518 fixed the earlier
 * parity-flip that had exactly that desync). This is distinct from the
 * identical-TAIL rerender above, which is a non-event and stays silent.
 *
 * The repeat-safe update itself - compare the new text against the rendered
 * value and append a zero-width space on an exact repeat - is now the shared
 * nextAnnouncement helper (announcerRepeat.js). This and PickAnnouncer (#513)
 * had each carried it inline, and this docblock used to say to extract it "at
 * three copies, not two"; StallAnnouncer (#636) was that third copy, so the
 * idiom was extracted and all three now call it. Only the two-line repeat idiom
 * moved; the GATING stays per-component. It is NOT that all three gate alike -
 * this announcer's effect and StallAnnouncer's share a seq high-water discipline,
 * but they diverge past it: this one is an EVENT announcer, tail-only, because a
 * newer chat message supersedes an older one; StallAnnouncer is a STATE announcer
 * that scans the whole newly-arrived slice for the newest stall (a stall is not
 * superseded by a later chat message) and clears on a resume. PickAnnouncer is
 * different again, keyed on a single pick prop with no feed at all. The reason a
 * shared GATING hook is still refused is not "different lifecycles" alone: it is
 * that folding in a clear/reset path only some of them own is exactly the
 * reset-semantics hazard #513 identified. (The 22-line similarity an earlier
 * review flagged between this effect and StallAnnouncer's was the pre-state-model
 * StallAnnouncer; the #636 state-model fix diverged them.)
 */
function FeedAnnouncer({ entries = [], viewerTeamId = null }) {
  const [announcement, setAnnouncement] = useState('');
  // The tail key we have already accounted for, and the highest seq we have
  // announced or seeded. null/-Infinity until the first non-empty feed seeds
  // them silently, so the opening backlog is never announced.
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

    // ALL Draft activity is a NO-OP here, keyed on the entry TYPE
    // ('draft_activity') rather than any one kind, so the whole set is covered
    // however it grows - the Pick (now the room-level PickAnnouncer's, #513), the
    // stall (now the room's StallAnnouncer, #636) and every lifecycle transition
    // alike. The authoritative kind set is the router in DraftActivityEntry.jsx
    // (LIFECYCLE_RENDER_KINDS plus its pick, correction and stalled branches);
    // this guard deliberately does not re-list it by kind, so it cannot fall out
    // of date the way an inline enumeration here once did. Draft activity still
    // advances the seq high-water mark above so a later message is not taken for
    // backlog, but it must NOT fall through to the empty-clear below: that would
    // BLANK a still-unread chat announcement (the previous "New message from X")
    // every time activity lands, and in an active draft that is constant. Leave
    // the region's current text untouched. This is distinct from the deliberate
    // clear for a hidden arrival or the viewer's own message below, which stays
    // exactly as it was (#513 did not change it).
    if (tail && tail.type === 'draft_activity') return;

    const text = feedAnnouncementFor(tail, viewerTeamId);
    if (!text) {
      // A lifecycle entry, a hidden arrival, or the viewer's own message: clear
      // to empty. That mutates the node value rather than removing the node, so
      // there is no announcement of silence.
      setAnnouncement('');
      return;
    }
    // Two DIFFERENT entries can describe identically - two messages from the same
    // Team both read "New message from <Team>". React bails on an Object.is-equal
    // state, so a byte-identical string would leave the region's text node
    // untouched and a screen reader silent: the first announced, the rest lost.
    // When the new text would exactly repeat what is CURRENTLY RENDERED, append a
    // zero-width space so the node value still changes and the repeat is
    // announced; otherwise set it clean. The marker is invisible and unspoken.
    // Comparing against `prev` (the rendered value in the functional setState),
    // not a separate last-text ref or a parity counter, is what keeps this correct
    // across ANY interleaving such as A, A, B, B: a different entry landing between
    // two repeat-pairs cannot desync from what is on screen, because there is no
    // counter. This is not the identical-tail case above - that returns before
    // here and stays deliberately silent. The append-on-exact-repeat itself is
    // the shared nextAnnouncement helper (announcerRepeat.js).
    setAnnouncement((prev) => nextAnnouncement(prev, text));
  }, [tailKey, tailSeq, tail, viewerTeamId]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default FeedAnnouncer;
