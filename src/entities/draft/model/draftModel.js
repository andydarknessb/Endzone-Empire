import { deriveOnTheClock } from '../../../shared/lib';

/**
 * The Draft room read model, pure (ADR 0029: the FSD island's entities layer;
 * the Draft feature's first slice). It is the one spelling of the live Draft
 * room state as the client knows it - league, teams, the picks so far, the team
 * on the clock and whether the draft is complete - built from the two wire
 * shapes the server speaks:
 *
 *   - the `draft:state` board SNAPSHOT (per-socket on join and on every
 *     reconnect / lifecycle act), which rebuilds the whole model; and
 *   - the `draft:picked` live EVENT, applied over the model as a landed pick.
 *
 * WHY THIS SLICE EXISTS (#949). The autopick fact used to live ONLY on the live
 * `draft:picked` payload. `draft:state` is broadcast on every lifecycle act and
 * every reconnect and REBUILDS the pick list wholesale, so the first refresh
 * silently un-marked every autopick in the room's history: a manager reviewing
 * the draft could no longer tell a pick they made from one the clock made for
 * them. The rule that lost the flag lived in a reducer inside a React hook,
 * reachable only through a render harness plus a fake socket plus `act`, which
 * is why it was never asserted. The fix carries the autopick fact on the
 * snapshot's pick payload too (server side), and moves the model here as pure
 * functions so the "does a refresh preserve the flag" question is a plain
 * function call. The hook keeps its per-viewer SESSION state (viewerTeamId,
 * isCommissioner, membership); this module is the shared MODEL, not the session.
 *
 * The pick shape - ONE model from BOTH wire shapes:
 *
 *   { pick_number, teamId, teamName,
 *     player_id, name, position, nfl_team, adp, auto, is_keeper }
 *
 * A Pick is attributed by Team, never by account (#113, contract #112): a live
 * pick is never a keeper (keepers are pre-filled at draft start and never travel
 * the live pick path), so its `is_keeper` is false; a snapshot pick carries the
 * server's `is_keeper` and, since #949, the server's `auto`. Carrying both flags
 * on both shapes is what lets a refresh preserve the mark the live event set -
 * the un-marking defect (#949) was exactly the snapshot shape lacking `auto`.
 */

/**
 * A pick from a `draft:state` board-snapshot row (draftRoomSnapshot.readPicks).
 * `auto` reads the server's autopick fact, carried on the snapshot pick payload
 * since #949 (draft_activity.is_autopick, joined in the server snapshot). This
 * line is the defect's own seam: drop `auto` here and a board refresh un-marks
 * every autopicked pick again, which draftModel.test.js pins red.
 */
export function pickFromSnapshotRow(row) {
  const r = row || {};
  return {
    pick_number: r.pick_number ?? null,
    teamId: r.teamId ?? null,
    teamName: r.teamName ?? null,
    player_id: r.player_id ?? null,
    name: r.name ?? null,
    position: r.position ?? null,
    nfl_team: r.nfl_team ?? null,
    // The player's market ADP rides on the pick (#833) so the room's Misery
    // Meter reads it off the pick, never off the windowed pool. Null when absent.
    adp: r.adp ?? null,
    auto: !!r.auto,
    is_keeper: !!r.is_keeper,
  };
}

/**
 * A pick from a `draft:picked` live event. `teamName` and `adp` come straight
 * off the broadcast; the autopick flag rides at the root as `auto` (#435). A
 * live pick is never a keeper, so `is_keeper` is false - the same key the
 * snapshot builder fills, so both wire shapes produce one model shape.
 */
export function pickFromPickedEvent(data) {
  const d = data || {};
  const player = d.player || {};
  return {
    pick_number: d.pickNumber ?? null,
    teamId: d.teamId ?? null,
    teamName: d.teamName ?? null,
    player_id: player.id ?? null,
    name: player.name ?? null,
    position: player.position ?? null,
    nfl_team: player.nfl_team ?? null,
    adp: player.adp ?? null,
    auto: !!d.auto,
    is_keeper: false,
  };
}

/**
 * Epoch-ms deadline for a timed, active, unpaused league, else null. The one
 * place the room derives a deadline from a league snapshot (moved here from the
 * hook so the model owns the on-the-clock derivation, #949 / ADR 0029).
 */
export function deadlineFromLeague(league, deadlineAtIso) {
  if (
    league?.draft_status === 'active' &&
    league?.pick_time_seconds > 0 &&
    !league?.draft_paused &&
    deadlineAtIso
  ) {
    return Date.parse(deadlineAtIso);
  }
  return null;
}

/** Map a league snapshot plus the team up into the On-the-clock value. */
export function onTheClockFor(league, team, deadlineAt) {
  return deriveOnTheClock({
    team,
    deadlineAt,
    paused: !!league?.draft_paused,
    active: league?.draft_status === 'active',
  });
}

/**
 * The empty model, before any snapshot has landed. Frozen so an accidental
 * in-place write is caught rather than shared across rooms; every applier below
 * returns a new object and never mutates its input.
 */
export const emptyDraftModel = Object.freeze({
  league: null,
  teams: [],
  picks: [],
  // The On-the-clock value (src/shared/lib's onTheClock module): `{ team, state, deadlineAt }`.
  // Holds the DEADLINE and never a per-second field (#754): the seconds are read
  // off `deadlineAt` by the one leaf that ticks (PickClock), so nothing in the
  // model, and so nothing in the room, re-renders per second.
  onTheClock: deriveOnTheClock(),
  draftComplete: false,
});

/**
 * Rebuild the model from a `draft:state` board snapshot. The pick list is
 * rebuilt wholesale (newest-first, as the history renders it), each row through
 * pickFromSnapshotRow so the autopick fact survives the refresh (#949). Session
 * state is not the model's concern and is untouched (it lives in the hook).
 */
export function applyBoardSnapshot(model, data) {
  const { league, teams, picks, onTheClock } = data || {};
  return {
    ...model,
    league: league ?? null,
    teams: teams || [],
    picks: (picks || []).map(pickFromSnapshotRow).reverse(),
    onTheClock: onTheClockFor(league, onTheClock, deadlineFromLeague(league, league?.pick_deadline_at)),
  };
}

/**
 * Apply a `draft:picked` live event over the model, returning a new model with
 * the pick prepended (newest-first) and the shared draft state advanced.
 *
 * The wall clock is INJECTED (`now`) so this is pure: it is read only for the
 * client-side deadline estimate the server's `pickDeadlineAt` normally supplies.
 *
 * current_pick follows the server's `nextPickIndex` - the next OPEN slot, keepers
 * skipped, so NOT current_pick + 1 in a keeper league (#854). It is honoured
 * verbatim. When it is a finite number (or the pick completes the draft) the
 * `league` is a NEW object so memoised readers recompute; when it is absent or
 * null the `league` is left as the SAME reference, keeping a newer client correct
 * against an older server that has not shipped the field yet (#819).
 */
export function applyLandedPick(model, data, { now = Date.now } = {}) {
  const d = data || {};
  const pick = pickFromPickedEvent(d);
  const nextOnTheClock = d.nextTeamId
    ? model.teams.find((t) => t.teamId === d.nextTeamId) || null
    : null;

  // Server sends the new deadline directly; fall back to a client-side estimate
  // (pick_time_seconds from now) only if it is ever omitted.
  let deadlineAt = null;
  if (d.pickDeadlineAt) {
    deadlineAt = Date.parse(d.pickDeadlineAt);
  } else if (model.league?.pick_time_seconds > 0) {
    deadlineAt = now() + model.league.pick_time_seconds * 1000;
  }

  const draftComplete = d.draftComplete ? true : model.draftComplete;
  const advancesPick = Number.isFinite(d.nextPickIndex);
  let league = model.league;
  if (model.league && (d.draftComplete || advancesPick)) {
    league = { ...model.league };
    if (d.draftComplete) league.draft_status = 'complete';
    if (advancesPick) league.current_pick = d.nextPickIndex;
  }

  return {
    ...model,
    picks: [pick, ...model.picks],
    // A completing pick derives `idle` (league is no longer active).
    onTheClock: onTheClockFor(league, nextOnTheClock, deadlineAt),
    draftComplete,
    league,
  };
}

/**
 * Apply a `draft:complete` event: the league is no longer active, so the
 * On-the-clock value derives idle and the ticking leaf unmounts.
 */
export function applyDraftComplete(model) {
  const league = model.league ? { ...model.league, draft_status: 'complete' } : model.league;
  return { ...model, draftComplete: true, league, onTheClock: onTheClockFor(league, null, null) };
}
