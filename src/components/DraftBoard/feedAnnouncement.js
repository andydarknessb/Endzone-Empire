import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The concise polite-region text for one combined-feed entry (#445 AC2), kept a
 * pure function so the string is unit-tested on its own and the announcer
 * component is only responsible for WHEN it changes.
 *
 * Two kinds are announced, matching AC2's "new human messages and Picks":
 *  - a human League chat message announces its ARRIVAL by Team ("New message
 *    from <Team>"), not its content. Naming who spoke is concise and lets a
 *    reader navigate the named log to read it; reading arbitrary message text
 *    into a polite region would be unbounded (up to 500 chars), could voice
 *    already-hidden or abusive content, and would compete badly with the room's
 *    other polite regions. A message that arrived already hidden is a tombstone,
 *    not new correspondence, so it is silent.
 *  - a committed Pick announces the Team and the player ("<Team> drafted
 *    <player>", or "autodrafted" when the pick is authoritatively automatic),
 *    the same facts the visible Pick line leads with.
 *
 * Everything else - Draft lifecycle activity (start, pause, resume, reset,
 * complete) and any unknown entry - returns the empty string. AC2 names
 * messages and Picks; live draft-state already has three deliberately-scoped
 * regions (on-the-clock in LiveDraftBanner, the countdown #117, readiness #164),
 * and adding a fourth voice for it here would only add contention. An empty
 * string is a real return, not a gap: the announcer keeps its region mounted and
 * silent rather than unmounting it (the ReadinessAnnouncer #164 lesson).
 *
 * The identity is rendered through teamNameLabel, the one shared helper, so a
 * departed author reads as a former manager rather than blank or "null", exactly
 * as the visible feed renders it.
 *
 * `viewerTeamId`, when given, suppresses the viewer's OWN chat message: the
 * server echoes a send to the whole room including the sender, and a manager who
 * just typed a line does not need it read back to them. This applies to chat
 * only - a Pick still announces whoever made it, the viewer included, because a
 * committed Pick (and an autopick in particular) is an event worth confirming.
 */
export function feedAnnouncementFor(entry, viewerTeamId = null) {
  if (!entry) return '';

  if (entry.type === 'draft_activity') {
    if (entry.kind === 'pick') {
      const player = entry.player || {};
      const name = player.name || 'a player';
      const team = teamNameLabel(entry.teamName);
      return entry.isAutopick ? `${team} autodrafted ${name}` : `${team} drafted ${name}`;
    }
    return '';
  }

  // A human League chat message (type 'league_chat' or an older untyped shape).
  if (entry.hidden) return '';
  if (viewerTeamId != null && entry.teamId != null && entry.teamId === viewerTeamId) return '';
  return `New message from ${teamNameLabel(entry.teamName)}`;
}

export default feedAnnouncementFor;
