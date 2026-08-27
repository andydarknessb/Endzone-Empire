import React from 'react';
import { Typography, Box, Chip } from '@mui/material';
import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The one renderer for a Draft-activity feed entry (#435, #437), shared by every
 * surface that shows the feed: the member Draft room (ChatPanel/ChatConversation)
 * and the anonymous presenter feed (DraftPresenter, #438). It was extracted here
 * so the two surfaces render the SAME event line from the SAME entry shape - the
 * lifecycle verb map and the Pick snapshot formatting cannot drift between a
 * member's view and a presenter's.
 *
 * Every field it reads is Team-only and public (leagueFeed.activityEntryOf): Team
 * identity, the player snapshot, round, Pick number, the autopick flag and the
 * instant. It carries no chat, no account identity and no moderation surface, so
 * it is safe on the presenter board exactly as it is in the room.
 */

// The past-tense verb each Draft LIFECYCLE kind reads as (#437). A lifecycle
// event is attributed to the acting commissioner's Team ("<Team> started the
// draft") when one is present, or phrased as a plain state transition ("The
// draft is complete") when there is no actor - a scheduler start or a
// completion. Kept as data so a new kind is a one-line addition, not a new
// branch, and so the actor / actor-less split is made in one place.
const LIFECYCLE_VERB = {
  draft_start: 'started',
  pause: 'paused',
  resume: 'resumed',
  reset: 'reset',
};

// One committed Pick as Draft activity in the combined feed (#435). It is NOT
// drawn as a chat bubble: Draft activity is server-authored, never a manager
// message (ADR 0012), so it reads as an event line and is attributed by Team
// without pretending the Team "said" anything. The snapshot shows player,
// position, NFL team, round and overall Pick number so the event is
// understandable without leaving the feed; an autopick is labeled AUTO.
function PickActivityLine({ entry }) {
  const player = entry.player || {};
  // House style: middot separators, no em-dashes. Null facts are dropped
  // rather than printed as "null".
  const meta = [player.position, player.nflTeam, `Round ${entry.round}`, `Pick ${entry.pickNumber}`]
    .filter((part) => part != null && part !== '')
    .join(' · ');
  return (
    <>
      <Typography component="div" variant="body2" sx={{ color: 'text.secondary' }}>
        <strong>{teamNameLabel(entry.teamName)}</strong> drafted {player.name}
        {entry.isAutopick && (
          <Chip label="AUTO" size="small" sx={{ ml: 1 }} />
        )}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {meta} {'·'} {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
    </>
  );
}

// A Draft lifecycle event (start, pause, resume, reset, completion) as an event
// line (#437). Completion is always actor-less; the others carry the acting
// Team when one is recorded. A null Team means no actor (a scheduler start),
// NOT a departed manager - lifecycle actors are never fabricated and teams are
// only Removable pre-draft - so it reads as a plain transition, not "Former
// manager". It carries no Pick facts, so none are shown.
function LifecycleActivityLine({ entry }) {
  const verb = LIFECYCLE_VERB[entry.kind] || 'updated';
  const hasActor = entry.teamName != null;
  let text;
  if (entry.kind === 'complete') {
    // Completion is always an actor-less state transition (#437).
    text = <>The draft is complete</>;
  } else if (hasActor) {
    text = <><strong>{teamNameLabel(entry.teamName)}</strong> {verb} the draft</>;
  } else {
    // No actor: the scheduler auto-started it (draft_start). Phrase the
    // transition without a Team rather than as "Former manager".
    text = entry.kind === 'draft_start'
      ? <>The draft started</>
      : <>The draft was {verb}</>;
  }
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {text}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
    </>
  );
}

// Route a Draft-activity entry to the right event-line renderer by kind. A Pick
// shows its snapshot facts; every other kind is a lifecycle transition (#437).
function DraftActivityEntry({ entry }) {
  return (
    <Box sx={{ mb: 1 }} data-testid="draft-activity">
      {entry.kind === 'pick'
        ? <PickActivityLine entry={entry} />
        : <LifecycleActivityLine entry={entry} />}
    </Box>
  );
}

export default DraftActivityEntry;
