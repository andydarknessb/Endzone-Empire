import React, { useEffect } from 'react';
import { teamNameLabel } from '../../lib/teamIdentity';
import PoliteRegion from './PoliteRegion';
import { useAnnouncement } from './useAnnouncement';

/**
 * The Draft room's ROOM-LEVEL Pick announcer (#513): one persistent, visually
 * hidden polite region (PoliteRegion, #791) that speaks every live committed
 * Pick, wherever the manager is in the room. THIS region is permanently
 * mounted (it sits in the Draft room chrome, never gated), which a live region
 * must be to be observed; some of its siblings mount conditionally
 * (ReadinessAnnouncer returns null when the viewer holds no Team) or clear to
 * empty (StallAnnouncer, FeedAnnouncer) - that gating is this component's own
 * and does not live in the shared leaf (ADR 0028).
 *
 * WHY ROOM-LEVEL, AND WHY THAT IS DIFFERENT FROM CHAT. The combined-feed
 * announcer lives inside DraftRoomChat, so on a narrow container it is mounted
 * only while the Chat tab is selected. That is correct for human MESSAGES -
 * chat a manager cannot see should not be announced or marked read from another
 * tab - but wrong for PICKS: a sighted manager on the Players, Board or Draft
 * tab is watching Picks land in front of them, so an assistive-technology user
 * on the same tab must hear them too. This announcer therefore mounts in the
 * Draft room's chrome, above the tabs and present in both layouts, and speaks
 * Picks alone; the feed announcer no longer speaks Picks, so a Pick is
 * announced exactly once even when Chat is mounted beside it.
 *
 * It is driven by the `pick` prop, the newest live committed Pick (the
 * `draft:picked` payload the room already routes through onPickLanded), or null
 * before any Pick has landed. Only a genuinely NEW Pick object re-fires it: the
 * effect keys on the prop's identity, so an ordinary rerender that hands the
 * same object back (a pool refetch, a clock tick) changes nothing and stays
 * silent. Initial Pick history never reaches here - it arrives on draft:state,
 * not draft:picked - so the room opening is not announced as a run of new Picks.
 *
 * TWO PICKS THAT DESCRIBE IDENTICALLY. Two consecutive autodrafts of a
 * same-named player by one Team read the same string. The repeat-safe update
 * that keeps the second one audible - append a zero-width space when the new
 * text would exactly repeat what is CURRENTLY RENDERED, correct across ANY
 * interleaving such as A, A, B, B - is the shared useAnnouncement hook (#791,
 * folding announcerRepeat.js in): this and FeedAnnouncer (#445) had each
 * carried it inline, both docblocks reading "extract a shared helper at three
 * copies, not two", and StallAnnouncer (#636) was the third copy, so it was
 * extracted (announcerRepeat.js) and all three called it; #791 moved that
 * extraction into a hook so the state and the update travel together. What is
 * NOT shared is WHEN each fires: this one is keyed on a single pick prop, the
 * feed announcer is seq-gated over a chat feed with a clear path and an
 * initialisation guard this one has no need of, and the stall announcer is
 * seq-gated over the same feed for the stalled kind - so the extraction is the
 * two-line repeat idiom only, never the gating, which is the reset-semantics
 * hazard #513 identified (ADR 0028).
 */
function PickAnnouncer({ pick = null }) {
  const [announcement, announce] = useAnnouncement();

  useEffect(() => {
    if (!pick) return;
    const text = pickAnnouncementFor(pick);
    if (!text) return;
    announce(text);
  }, [pick, announce]);

  return <PoliteRegion text={announcement} />;
}

/**
 * The concise polite-region text for one live committed Pick (#513, moved
 * module-private here in #791 - the one caller made the pure-function/component
 * split #791's rulings 4 and 5 ask for unnecessary).
 *
 * It reads the `draft:picked` broadcast shape straight off the wire: the server
 * emits `{ ...outcome, auto }` from both the manual pick handler (draftSocket.js,
 * auto: false) and the Pick clock module's autopick (pickClock.service.js, auto: true), so
 * `teamName`, `player.name`, the top-level `auto` flag and `draftComplete` are
 * the facts this needs. `auto` is the one non-identity fact the room keeps about
 * how a Pick was made; a manual Pick is not an autopick.
 *
 * The text is the same the visible Pick line leads with: "<Team> drafted
 * <player>", or "<Team> autodrafted <player>" for an authoritative automatic
 * Pick. The Team is rendered through teamNameLabel, the one shared helper, so a
 * departed manager reads as a former manager rather than blank or "null" - a
 * Pick's Team cannot really be null (draft_picks.team_id is NOT NULL and
 * cascades), but the rendering rule must never print nothing.
 *
 * THE FINAL PICK (#519). The same `draft:picked` payload that commits the last
 * Pick also carries `draftComplete: true` (the server spreads the pick outcome,
 * pinned in socketPayloadShape.test.js), so completion needs no separate event
 * here. For that one Pick the announcement carries BOTH facts in order - the
 * Team and player FIRST, then ". Draft complete." - as a single polite update,
 * so a reader hears who was picked before hearing the draft is over. The visible
 * "Draft complete!" success Alert in DraftBoard stays on screen but no longer
 * speaks (it is not a live region), so the completion is announced exactly once.
 * A full stop and a space join the two facts: no em dash, no semicolon-dash
 * (house style, guarded copy). Every earlier Pick has draftComplete falsy and is
 * unchanged.
 *
 * Unlike the chat half of feedAnnouncement's former responsibility, a Pick is
 * NEVER suppressed by viewer identity: a committed Pick (and an autopick in
 * particular) is an event worth confirming, the viewer's own included.
 *
 * A null/undefined pick returns the empty string, a real return the announcer
 * keeps its region mounted and silent for rather than unmounting it (the
 * ReadinessAnnouncer #164 lesson).
 */
function pickAnnouncementFor(pick) {
  if (!pick) return '';
  const player = pick.player || {};
  const name = player.name || 'a player';
  const team = teamNameLabel(pick.teamName);
  const base = pick.auto ? `${team} autodrafted ${name}` : `${team} drafted ${name}`;
  if (!pick.draftComplete) return base;
  // The Pick that completes the draft carries draftComplete:true on this same
  // payload (#519): append the completion sentence so the final Pick and the
  // completion are one ordered polite update, Team and player first. A full stop
  // plus a space joins the two facts, never an em dash (guarded copy). When the
  // player's name already ends in a period (a suffix such as "Jr."), reuse that
  // stop rather than adding a second: "Jr.. Draft complete." renders as a double
  // stop in braille output, and suffixed names (Marvin Harrison Jr., Tyrone
  // Tracy Jr.) are an ordinary way for a late final Pick to land.
  return base.endsWith('.') ? `${base} Draft complete.` : `${base}. Draft complete.`;
}

export default PickAnnouncer;
