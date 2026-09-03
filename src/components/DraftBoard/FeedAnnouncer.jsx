import React, { useEffect, useRef } from 'react';
import { feedEntryKey, teamNameLabel } from '../../lib/teamIdentity';
import PoliteRegion from './PoliteRegion';
import { useAnnouncement } from './useAnnouncement';

/**
 * The Draft room's combined-feed announcer (#445 AC2): one persistent, visually
 * hidden polite region (PoliteRegion, #791) that speaks a CONCISE summary when a
 * human message arrives live.
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
 * Draft-schedule countdown (#117) belong to a PENDING draft, while this feed
 * and its active-phase siblings belong to an ACTIVE one, and a draft is one
 * or the other, never both. Do not hand-enumerate this feed's active-phase
 * siblings here - that list has gone stale before (#654):
 * `git grep -nF 'role="status"' src/components/DraftBoard/ src/components/ChatPanel/`
 * (ChatPanel is part of the room - DraftRoomChat.jsx imports ChatConversation
 * from it, which is where ComposerCharacterCount #486 lives) surfaces most of
 * them, but READ WHAT IT RETURNS rather than trusting the count: it also
 * matches ReadinessAnnouncer's source even though that component renders null
 * outside the PENDING phase (railCompositionFor), and it structurally cannot
 * see RosterNeedsStrip (src/components/RosterPanel/, mounted in the ACTIVE
 * rail composition, railComposition.js) - that region carries
 * `aria-live="polite"` WITHOUT `role="status"`; its own docblock is the
 * source of truth for that ruling (#664). Each region is on
 * its own axis, none folding into another (ADR 0028). This one still earns its
 * place rather than folding into any of them:
 *
 *  - It carries a DIFFERENT axis: human-message arrival, which neither
 *    ComposerCharacterCount (#486) nor LiveDraftBanner announces. Folding it
 *    into either would make that region speak two unrelated things.
 *  - It fires on a live arrival, identified by the NEWEST entry advancing the
 *    shared per-league seq past the highest we have announced. A render that does
 *    not change the tail says nothing, and there is no timer and no debounce, so
 *    it cannot chatter the way a per-tick region would.
 *  - It announces PRESENCE, not content, and only human-message arrivals, so it
 *    stays terse rather than reading long message bodies or every lifecycle
 *    transition.
 *
 * What a test can show about this region - that it exists, its DOM order, and
 * that its text changes exactly on a strictly-newer entry - is asserted here and
 * in FeedAnnouncer.test.jsx. Whether a reader actually reaches an announcement
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
 *    Suppressed by teamId below.
 *
 * TWO ENTRIES THAT DESCRIBE IDENTICALLY. Two messages from the same Team both
 * read "New message from <Team>". The repeat-safe update that keeps the second
 * one audible - append a zero-width space on an exact repeat of what is
 * CURRENTLY RENDERED, correct across ANY interleaving such as A, A, B, B - is
 * the shared useAnnouncement hook (#791, folding announcerRepeat.js in). This
 * and PickAnnouncer (#513) had each carried it inline, and this docblock used
 * to say to extract it "at three copies, not two"; StallAnnouncer (#636) was
 * that third copy, so the idiom was extracted (announcerRepeat.js) and all
 * three called it; #791 moved that extraction into a hook so the state and the
 * update travel together. Only the two-line repeat idiom moved; the GATING
 * stays per-component (ADR 0028). It is NOT that all three gate alike - this
 * announcer's effect and StallAnnouncer's share a seq high-water discipline,
 * but they diverge past it: this one is an EVENT announcer, tail-only, because a
 * newer chat message supersedes an older one; StallAnnouncer is a STATE announcer
 * that scans the whole newly-arrived slice for the newest stall (a stall is not
 * superseded by a later chat message) and clears on a resume. PickAnnouncer is
 * different again, keyed on a single pick prop with no feed at all. The reason a
 * shared GATING hook is still refused is not "different lifecycles" alone: it is
 * that folding in a clear/reset path only some of them own is exactly the
 * reset-semantics hazard #513 identified.
 */
function FeedAnnouncer({ entries = [], viewerTeamId = null }) {
  const [announcement, announce] = useAnnouncement();
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
    // alike. The authoritative kind set is ALL_KINDS in the server draft-activity
    // module (server/services/draftActivity.js); the router in
    // DraftActivityEntry.jsx (LIFECYCLE_RENDER_KINDS plus its pick, correction
    // and stalled branches) is only the RENDERABLE subset of it - it deliberately
    // refuses 'cutover' (#540 AC6). This guard deliberately does not re-list
    // either set by kind, so it cannot fall out of date the way an inline
    // enumeration here once did. Draft activity still
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
      // to empty via the shared hook. This CAN land with `prev` already empty -
      // the room opens onto backlog silently, so the first live entry a manager
      // sends themselves reaches here with nothing yet rendered - and
      // useAnnouncement's `announce('')` is exempt from the repeat check
      // specifically for that reason: the empty string never gains a trailing
      // zero-width space, so two clears in a row (or a clear while already
      // silent) still read as genuine silence, not an invisible character.
      announce('');
      return;
    }
    // Two DIFFERENT entries can describe identically - two messages from the same
    // Team both read "New message from <Team>". The shared useAnnouncement hook
    // appends a zero-width space on an exact repeat of what is CURRENTLY
    // RENDERED so the node value still changes and the repeat is announced. This
    // is not the identical-tail case above - that returns before here and stays
    // deliberately silent.
    announce(text);
  }, [tailKey, tailSeq, tail, viewerTeamId, announce]);

  return <PoliteRegion text={announcement} />;
}

/**
 * The concise polite-region text for one combined-feed entry (#445 AC2), moved
 * module-private here in #791 - the one caller made the pure-function/component
 * split ADR 0028's rulings 4 and 5 ask for unnecessary.
 *
 * Only ONE kind is announced here now (#513 moved Picks to the room-level
 * PickAnnouncer): the human League chat message.
 *  - a human League chat message announces its ARRIVAL by Team ("New message
 *    from <Team>"), not its content. Naming who spoke is concise and lets a
 *    reader navigate the named log to read it; reading arbitrary message text
 *    into a polite region would be unbounded (up to 500 chars), could voice
 *    already-hidden or abusive content, and would compete badly with the room's
 *    other polite regions. A message that arrived already hidden is a tombstone,
 *    not new correspondence, so it is silent.
 * Picks are NO LONGER announced here (#513). They moved to a room-level
 * announcer (PickAnnouncer) mounted in the Draft room's chrome, above the tabs
 * and present in both layouts, so a Pick is heard on every tab - not only while
 * Chat is mounted. If this feed announcer also spoke Picks, a screen-reader user
 * with Chat mounted beside the board would hear each Pick TWICE; leaving Picks to
 * the room-level announcer is what keeps it exactly once. Human messages stay
 * scoped here on purpose: chat a manager cannot see should not be announced or
 * marked read from another tab, and a Pick is different because a sighted manager
 * on any tab is watching Picks land.
 *
 * So EVERY Draft activity entry - Picks and every lifecycle kind alike (the
 * roster is stallAnnouncement.js's LIFECYCLE_KINDS, pinned to the server's by
 * stallAnnouncement.parity.test.js) - and any unknown entry returns the empty
 * string here. An empty string is a real return, not a gap: the announcer keeps
 * its region mounted and silent rather than unmounting it (the ReadinessAnnouncer
 * #164 lesson).
 *
 * The identity is rendered through teamNameLabel, the one shared helper, so a
 * departed author reads as a former manager rather than blank or "null", exactly
 * as the visible feed renders it.
 *
 * `viewerTeamId`, when given, suppresses the viewer's OWN chat message: the
 * server echoes a send to the whole room including the sender, and a manager who
 * just typed a line does not need it read back to them. That is the only
 * suppression; a hidden arrival and any Draft activity already return the empty
 * string above. (The room-level PickAnnouncer, which now owns Picks, announces a
 * Pick regardless of who made it - the viewer's own included - but that rule
 * lives in PickAnnouncer.jsx, not here.)
 */
function feedAnnouncementFor(entry, viewerTeamId = null) {
  if (!entry) return '';

  // Draft activity - Picks (#513, now the room-level PickAnnouncer's job) and
  // lifecycle alike - is not announced by the Chat-scoped feed.
  if (entry.type === 'draft_activity') return '';

  // A human League chat message (type 'league_chat' or an older untyped shape).
  if (entry.hidden) return '';
  if (viewerTeamId != null && entry.teamId != null && entry.teamId === viewerTeamId) return '';
  return `New message from ${teamNameLabel(entry.teamName)}`;
}

export default FeedAnnouncer;
