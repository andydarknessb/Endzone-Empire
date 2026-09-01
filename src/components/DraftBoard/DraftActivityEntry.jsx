import React from 'react';
import { Typography, Box, Chip } from '@mui/material';
import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The one renderer for a Draft-activity feed entry (#435, #437, #439, #540),
 * shared by every surface that shows the feed: the member Draft room
 * (ChatPanel/ChatConversation) and the anonymous presenter feed (DraftPresenter,
 * #438). It was extracted here so the two surfaces render the SAME event line
 * from the SAME entry shape - the lifecycle verb map, the Pick snapshot and the
 * correction line cannot drift between a member's view and a presenter's.
 *
 * Every field it reads is Team-only and public (leagueFeed.activityEntryOf): Team
 * identity, the player snapshot, round, Pick number, the autopick flag and the
 * instant. A correction ALSO carries a `reason` for a member; a presenter entry
 * has no reason key at all (listPresenterDraftActivity strips it at the source),
 * so the same component renders a presenter correction reason-free without a
 * per-surface branch. It carries no chat, no account identity and no moderation
 * surface, so it is safe on the presenter board exactly as it is in the room.
 *
 * REFUSING TO GUESS (#540 AC6). This renderer routes only the kinds it KNOWS how
 * to render; an unknown or internal kind renders NOTHING rather than falling
 * through to a generic "<Team> updated the draft" line. That generic fallthrough
 * is precisely how a correction used to be mis-drawn as an ordinary Team action
 * that dropped the reversed-Pick snapshot and the reason. Rendering nothing is
 * strictly better than impersonating a Team action for a kind nobody taught this
 * component to draw. Both user surfaces already exclude internal kinds upstream
 * (the member feed via USER_VISIBLE_KINDS, the presenter feed via its own
 * independent allowlist); this is the defense-in-depth that holds if one ever
 * does not.
 */

// The past-tense verb each Draft LIFECYCLE kind reads as (#437). A lifecycle
// event is attributed to the acting commissioner's Team ("<Team> started the
// draft") when one is present, or phrased as a plain state transition ("The
// draft is complete") when there is no actor - a scheduler start or a
// completion. Kept as data so a new kind is a one-line addition, not a new
// branch, and so the actor / actor-less split is made in one place. Two of the
// server's six lifecycle kinds are deliberately absent: `complete` (below,
// it has no verb) and `stalled` (#620 - it left this map entirely for its own
// stuck-state render, StalledActivityLine; do NOT restore `stalled` here, that
// would resurrect the actor-ful "<Team> stalled the draft" reading #620 was
// filed to remove).
const LIFECYCLE_VERB = {
  draft_start: 'started',
  pause: 'paused',
  resume: 'resumed',
  reset: 'reset',
};

// The lifecycle kinds LifecycleActivityLine knows how to draw (#437): the verbed
// transitions in LIFECYCLE_VERB plus the actor-less completion (which has no verb
// - it reads as a plain "The draft is complete"). Derived from LIFECYCLE_VERB so
// the verbed kinds are listed in exactly one place. This is the renderer's KNOWN
// set for the lifecycle branch - a kind outside it (a Pick, a correction, the
// cutover boundary, `stalled` (its own stuck-state line, #620), or a kind not
// yet invented) is NOT a lifecycle line and must be routed elsewhere or
// refused, never coerced into "updated the draft".
const LIFECYCLE_RENDER_KINDS = new Set([...Object.keys(LIFECYCLE_VERB), 'complete']);

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
  // Reached only for a known lifecycle kind (DraftActivityEntry routes by
  // LIFECYCLE_RENDER_KINDS), so the verb lookup is total for the non-complete
  // kinds and `complete` is handled before the verb is used. There is
  // deliberately NO generic "updated" fallback here: an unknown kind never
  // reaches this line, so it can never read as "<Team> updated the draft".
  const verb = LIFECYCLE_VERB[entry.kind];
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

// A nothing-draftable stall (#602) as a stuck-state line, NOT an actor-ful
// lifecycle transition (#620). Every OTHER lifecycle kind puts a Team in the
// subject position only when that Team genuinely acted (complete and a
// scheduler-started draft_start are phrased actor-less, above); a stall is the
// one case where a Team is named for something it did NOT do and cannot fix -
// the draft stalled ON the Team because there was no draftable player, and
// only a commissioner can resolve it. Naming that as "<Team> stalled the
// draft" through the shared verb template read as blame with no cause and no
// next step, so this is a dedicated render rather than an entry in
// LIFECYCLE_VERB: the Team is named without being cast as the actor, the
// cause ("no draftable player") is stated, and the caption carries the next
// step. A null Team (the only case this component's test covers) reads as a
// plain stuck-state line rather than "Former manager" - matching the sibling
// LifecycleActivityLine guard exactly, including its inherited gap: an empty
// or whitespace-only teamName still falls through to teamNameLabel's shared
// former-manager label, same as every other line in this file.
function StalledActivityLine({ entry }) {
  const hasActor = entry.teamName != null;
  const text = hasActor
    ? <>The draft is stuck on <strong>{teamNameLabel(entry.teamName)}</strong>: no draftable player</>
    : <>The draft is stuck: no draftable player</>;
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {text}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        A commissioner must resolve and resume {'·'} {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
    </>
  );
}

// A Commissioner correction as an event line (#439, #540). A correction is an
// ADMINISTRATIVE act by the commissioner against a Team's Pick; it is NOT that
// Team acting, so the line names the correction as the event and shows the
// reversed Team only as the OWNER of the reversed Pick ("<Team>'s pick"), never
// as the actor. It shows the snapshotted reversed player, position, NFL team,
// round and overall Pick number so the correction is understandable without
// leaving the feed, and the commissioner's recorded reason WHEN one is present.
// A presenter entry carries no `reason` key at all (stripped at the source), and
// a correction may legitimately have none, so the reason line is conditional -
// its absence is normal, not an error.
function CorrectionActivityLine({ entry }) {
  const player = entry.player || {};
  // House style: middot separators, no em-dashes. Null facts are dropped rather
  // than printed as "null".
  const meta = [player.position, player.nflTeam, `Round ${entry.round}`, `Pick ${entry.pickNumber}`]
    .filter((part) => part != null && part !== '')
    .join(' · ');
  return (
    <>
      <Typography component="div" variant="body2" sx={{ color: 'text.secondary' }}>
        <strong>Commissioner correction</strong>
        {' · '}
        reversed {teamNameLabel(entry.teamName)}{"'s pick of "}{player.name}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {meta} {'·'} {new Date(entry.created_at).toLocaleTimeString()}
      </Typography>
      {entry.reason ? (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          Reason: {entry.reason}
        </Typography>
      ) : null}
    </>
  );
}

// Route a Draft-activity entry to the right event-line renderer by kind. A Pick
// shows its snapshot facts; a correction is an explicit commissioner act; the
// verbed lifecycle transitions plus completion are event lines; a stall is its
// own stuck-state line (#620), not an actor-ful lifecycle transition.
// Any OTHER kind - an internal boundary like cutover, or a kind not yet
// invented - renders NOTHING rather than being coerced into a generic Team
// action (#540 AC6): the component refuses to guess. Returning null means no
// container and no line at all.
function DraftActivityEntry({ entry }) {
  let line = null;
  if (entry.kind === 'pick') {
    line = <PickActivityLine entry={entry} />;
  } else if (entry.kind === 'correction') {
    line = <CorrectionActivityLine entry={entry} />;
  } else if (entry.kind === 'stalled') {
    line = <StalledActivityLine entry={entry} />;
  } else if (LIFECYCLE_RENDER_KINDS.has(entry.kind)) {
    line = <LifecycleActivityLine entry={entry} />;
  } else {
    return null;
  }
  return (
    <Box sx={{ mb: 1 }} data-testid="draft-activity">
      {line}
    </Box>
  );
}

export default DraftActivityEntry;
