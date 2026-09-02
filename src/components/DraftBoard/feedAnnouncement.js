import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The concise polite-region text for one combined-feed entry (#445 AC2), kept a
 * pure function so the string is unit-tested on its own and the announcer
 * component is only responsible for WHEN it changes.
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
 * lives in pickAnnouncement.js, not here.)
 */
export function feedAnnouncementFor(entry, viewerTeamId = null) {
  if (!entry) return '';

  // Draft activity - Picks (#513, now the room-level PickAnnouncer's job) and
  // lifecycle alike - is not announced by the Chat-scoped feed.
  if (entry.type === 'draft_activity') return '';

  // A human League chat message (type 'league_chat' or an older untyped shape).
  if (entry.hidden) return '';
  if (viewerTeamId != null && entry.teamId != null && entry.teamId === viewerTeamId) return '';
  return `New message from ${teamNameLabel(entry.teamName)}`;
}

export default feedAnnouncementFor;
