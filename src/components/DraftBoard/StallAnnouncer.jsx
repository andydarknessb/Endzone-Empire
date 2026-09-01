import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { feedEntryKey } from '../../lib/teamIdentity';
import { stallAnnouncementFor } from './stallAnnouncement';
import { nextAnnouncement } from './announcerRepeat';

// A stall is a STATE, so two lifecycle kinds matter to this announcer: the
// `stalled` entry that ENTERS the stuck state, and the `resume` that LEAVES it
// (a commissioner resolved the stall and resumed the draft). Both are read off
// the combined feed, never changed.
function isStall(entry) {
  return !!entry && entry.type === 'draft_activity' && entry.kind === 'stalled';
}
function isResume(entry) {
  return !!entry && entry.type === 'draft_activity' && entry.kind === 'resume';
}

// The highest seq present, or null when no entry carries one. The feed is kept
// sorted by seq (useDraftRoomFeed), so this is normally the tail, but it is
// computed by scan rather than assumed so a defensive out-of-order entry cannot
// strand the high-water mark.
function maxSeqOf(entries) {
  let max = null;
  for (const entry of entries) {
    if (entry && Number.isFinite(entry.seq) && (max == null || entry.seq > max)) max = entry.seq;
  }
  return max;
}

// The newest stall-or-resume transition strictly above `sinceSeq`, or null when
// the newly-arrived slice carried neither. This is the crux of the state model:
// the feed does not arrive one entry at a time - useDraftRoomFeed commits a whole
// live/reconnect slice in ONE setEntries - so the transition that changed the
// stuck state is NOT necessarily the tail. The NEWEST such transition in the
// slice wins: [stalled, resume] nets to resumed, [resume, stalled] nets to stuck.
function newestTransitionAbove(entries, sinceSeq) {
  let found = null;
  for (const entry of entries) {
    if (!entry || !Number.isFinite(entry.seq) || entry.seq <= sinceSeq) continue;
    if (!isStall(entry) && !isResume(entry)) continue;
    if (found == null || entry.seq > found.seq) found = entry;
  }
  return found;
}

/**
 * The Draft room's stall announcer (#636): a visually hidden polite region that
 * speaks a nothing-draftable stall (#602) when the draft ENTERS the stuck state
 * live, and falls silent when it LEAVES it. It follows the room's construction
 * idiom - a Box with role="status" / aria-live="polite", styled visuallyHidden,
 * whose only mutation is its TEXT, as ReadinessAnnouncer (#164), the room-level
 * Pick announcer (PickAnnouncer, #513), the combined-feed announcer
 * (FeedAnnouncer, #445) and ComposerCharacterCount (#486) all do.
 *
 * NOT PERSISTENT / NOT ROOM-LEVEL, on purpose and with a known cost. It consumes
 * the combined `entries` feed, which lives in useDraftRoomFeed inside
 * DraftRoomChat, so it is mounted there and shares that subtree's lifetime: on a
 * wide container the Chat pane is always mounted for a member (so it is always
 * present), but on a narrow container it unmounts with the Chat tab. It is
 * therefore NOT "persistent" in PickAnnouncer's room-level sense (PickAnnouncer.jsx
 * uses that word for a region mounted in the room chrome, heard on every tab). A
 * stall belongs on the Pick side of #513's test - a sighted user on the Board tab
 * sees the clock stop, so an AT user there should hear it - so room-level is the
 * right end state, but it is mutually exclusive with the seq/backlog gating below
 * (a room-level socket seam has no REST backlog to seed a high-water mark from,
 * and lifting the member-only feed collides with #534 AC1). That gap is tracked
 * as #648, not resolved here.
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
 * STATE, NOT EVENT - and this is why the gating genuinely differs from
 * FeedAnnouncer's tail-only event model rather than copying it. A chat message is
 * an event: the tail is the newest one and a later message supersedes it, so
 * tail-only is correct there. A stall PERSISTS until a commissioner acts, and is
 * NOT superseded by a chat message landing after it. So this announcer, over the
 * same seq high-water discipline, does two things the feed announcer does not:
 *  - it looks at the whole newly-arrived slice (every entry above the OLD
 *    high-water), not just the tail, and speaks the newest `stalled` in it - so a
 *    stall committed in the same setEntries as a trailing chat message (a
 *    reconnect resume slice, useDraftRoomFeed) is still announced rather than
 *    skipped and then stranded below an advanced high-water mark;
 *  - it CLEARS on the newest `resume` in the slice, because the stuck state has
 *    ended - a browse-mode reader should not find "The draft is stuck" lingering
 *    in the accessibility tree after the draft resumed. Clearing to empty mutates
 *    the node value without announcing silence (the FeedAnnouncer empty-clear
 *    idiom). Any other newer entry (a chat message, a Pick, an unrelated
 *    lifecycle transition) advances the high-water mark but leaves the region
 *    untouched, so an ordinary arrival never blanks a standing stall.
 *
 * The seq high-water mark is still seeded SILENTLY by the first non-empty feed,
 * so the opening BACKLOG - even one whose newest transition is a stall (a room
 * opening onto an already-stuck draft is a state to read, not a live freeze) -
 * announces nothing, and a wholesale history REPLACE to an older seq and a
 * Load-older PREPEND stay silent because nothing sits above the high-water mark.
 *
 * Like PickAnnouncer and unlike the chat half of the feed announcer, a stall is
 * NEVER suppressed by viewer identity: it is addressed to whichever commissioner
 * can resolve it, so this takes no viewerTeamId.
 *
 * Two DIFFERENT stalls can describe identically - two stalls on one Team with the
 * same cause, the second after the first was resolved and resumed. The shared
 * nextAnnouncement helper (announcerRepeat.js, extracted at this third consumer)
 * appends a zero-width space on an exact repeat so the node value still changes
 * and the second stall is announced.
 */
function StallAnnouncer({ entries = [] }) {
  const [announcement, setAnnouncement] = useState('');
  // The highest seq announced or seeded, and the tail key for the no-seq fallback.
  // -Infinity / null until the first non-empty feed seeds them silently, so the
  // opening backlog is never announced.
  const highWaterSeqRef = useRef(-Infinity);
  const lastKeyRef = useRef(null);
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (!entries.length) return;
    const tail = entries[entries.length - 1];
    const tailKey = feedEntryKey(tail);

    if (!initialisedRef.current) {
      // Seed on the first non-empty feed WITHOUT announcing; stay uninitialised
      // while the feed is still empty so a genuine first arrival can seed too.
      initialisedRef.current = true;
      lastKeyRef.current = tailKey;
      const seeded = maxSeqOf(entries);
      if (seeded != null) highWaterSeqRef.current = seeded;
      return;
    }

    const maxSeq = maxSeqOf(entries);
    if (maxSeq != null) {
      // Nothing strictly newer than the high-water mark: a backlog REPLACE, a
      // Load-older prepend, or an identical rerender. Not a live arrival.
      if (maxSeq <= highWaterSeqRef.current) return;
      const sinceSeq = highWaterSeqRef.current;
      highWaterSeqRef.current = maxSeq;

      // The newest stall/resume transition in the newly-arrived slice decides the
      // stuck state; anything else in the slice leaves the region as it was.
      const transition = newestTransitionAbove(entries, sinceSeq);
      if (!transition) return;
      if (isResume(transition)) {
        setAnnouncement('');
        return;
      }
      const text = stallAnnouncementFor(transition);
      if (text) setAnnouncement((prev) => nextAnnouncement(prev, text));
      return;
    }

    // No-seq fallback (pre-seq shape; live entries always carry a seq): a changed
    // tail key is the only signal, so act on the tail alone.
    if (tailKey === lastKeyRef.current) return;
    lastKeyRef.current = tailKey;
    if (isResume(tail)) {
      setAnnouncement('');
      return;
    }
    const text = stallAnnouncementFor(tail);
    if (text) setAnnouncement((prev) => nextAnnouncement(prev, text));
  }, [entries]);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {announcement}
    </Box>
  );
}

export default StallAnnouncer;
