import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The concise polite-region text for one live committed Pick (#513), kept a pure
 * function so the string is unit-tested on its own and the room-level announcer
 * component (PickAnnouncer) is only responsible for WHEN it changes - exactly
 * the split feedAnnouncement.js / FeedAnnouncer.jsx use (#445).
 *
 * It reads the `draft:picked` broadcast shape straight off the wire: the server
 * emits `{ ...outcome, auto }` from both the manual pick handler (draftSocket.js,
 * auto: false) and the autopick service (autopick.service.js, auto: true), so
 * `teamName`, `player.name` and the top-level `auto` flag are the three facts
 * this needs. `auto` is the one non-identity fact the room keeps about how a
 * Pick was made; a manual Pick is not an autopick.
 *
 * The text is the same the visible Pick line leads with: "<Team> drafted
 * <player>", or "<Team> autodrafted <player>" for an authoritative automatic
 * Pick. The Team is rendered through teamNameLabel, the one shared helper, so a
 * departed manager reads as a former manager rather than blank or "null" - a
 * Pick's Team cannot really be null (draft_picks.team_id is NOT NULL and
 * cascades), but the rendering rule must never print nothing.
 *
 * Unlike the chat half of feedAnnouncement.js, a Pick is NEVER suppressed by
 * viewer identity: a committed Pick (and an autopick in particular) is an event
 * worth confirming, the viewer's own included.
 *
 * A null/undefined pick returns the empty string, a real return the announcer
 * keeps its region mounted and silent for rather than unmounting it (the
 * ReadinessAnnouncer #164 lesson).
 */
export function pickAnnouncementFor(pick) {
  if (!pick) return '';
  const player = pick.player || {};
  const name = player.name || 'a player';
  const team = teamNameLabel(pick.teamName);
  return pick.auto ? `${team} autodrafted ${name}` : `${team} drafted ${name}`;
}
