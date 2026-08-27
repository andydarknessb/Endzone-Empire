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
