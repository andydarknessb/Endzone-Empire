/**
 * Pure facts-object builders for the Draft ROOM's Draft assistant presenter
 * (issue #787, part of the #784 spec). This is the room-venue half of ruling
 * 13's builder / presenter split (the shape PickAnnouncer.jsx keeps in-file
 * since #791): no DOM, no React, so DraftRoomAssistant.jsx stays a thin
 * caller, exactly as simAssistantFacts.js is for the Sim (#786).
 *
 * WHY THIS IS NOT simAssistantFacts.js. The Sim consumes its whole draft state
 * through src/lib/draftSim (userTeam, pickValues), which the room does not
 * have: the room's live state arrives over the socket as the draft:picked
 * payload and the reducer-maintained picks array (useDraftSocket.js), neither
 * of which carries a market ADP or an injury status. So this module takes those
 * two facts from the PLAYER POOL ROW instead (ruling item 3: "injury status
 * from the pool row"), looked up by player id, and labels each pick with the
 * shared steal/reach rule (src/lib/stealReach.js) rather than reading a
 * pre-labelled pick off draft state the room never receives.
 *
 * STEAL/REACH LABELLING is the shared rule in src/lib/stealReach.js
 * (stealReachLabel, promoted in issue #817): draftValueScore is
 * `round2(adp - pickNumber)`, a pick that landed LATER than its market ADP
 * scores negative (a steal), one that landed EARLIER scores positive (a
 * reach), and an ADP that is not finite and positive is 'no-market', never a
 * steal or a reach. The Sim's post-draft report (analysis.js's draftPickValue
 * and pickValues) reads the same function, and
 * stealReachThreshold.parity.test.js drives both venues through it, so the
 * room and the Sim can no longer disagree about one pick the way they did
 * before #817. stealReachLabelFor below is that shared function under the
 * room's local name, not a second copy.
 *
 * NET VS ADP SIGN matches miseryStage()'s own docblock and simAssistantFacts.js:
 * the running sum of draftValueScore, un-negated, so accumulated steals read
 * negative (the best Misery band) and accumulated reaches read positive (the
 * worst). Picks whose ADP the room never loaded contribute nothing rather than
 * a guess: the pool is windowed (usePlayerPool.js), so a player drafted before
 * the viewer ever scrolled to their row has no client-side ADP, and counting
 * them as 0 is the honest reading, not a fabricated one.
 */
import { TRIGGERS, earlyKickerOrDefense } from '../../lib/draftAssistant';
import { stealReachLabel } from '../../lib/stealReach';

/** 1-based draft round for an overall (1-based) pick number, given the number
 * of teams. Mirrors the round arithmetic draftSim/engine and draft.service.js
 * use: every team picks once per round, so pick N sits in round
 * floor((N-1)/teamCount)+1. teamCount <= 0 (a room with no teams yet) has no
 * meaningful round, so it falls back to round 1. */
export function roundForPick(pickNumber, teamCount) {
  if (!teamCount || teamCount <= 0) return 1;
  return Math.floor((Number(pickNumber) - 1) / teamCount) + 1;
}

/**
 * The steal/reach label and its draftValueScore for one pick. This is the
 * shared rule from src/lib/stealReach.js (issue #817), re-exported under the
 * room's local name so the room and the Draft Sim's report can never disagree
 * about one pick. A non-positive, non-numeric or missing ADP is 'no-market'
 * with a zero score and adpFallback true, so it can never read as a steal or a
 * reach and contributes nothing to Net vs ADP.
 */
export const stealReachLabelFor = stealReachLabel;

const EMPTY_PLAYER = { name: null, position: null, nfl_team: null, injury_status: null };

/** Player facts from a pool row (the room's source for ADP and injury status).
 * A row the room has not loaded is undefined; the empty shape keeps every facts
 * field present, and the voice templates simply do not reference a field their
 * trigger has no use for (lineFor.js's designed empty-render). */
function playerFactsFromRow(row) {
  if (!row) return { ...EMPTY_PLAYER };
  return {
    name: row.name || null,
    position: row.position || null,
    nfl_team: row.nfl_team || null,
    injury_status: row.injury_status || null,
  };
}

/** Player facts for a landed pick: identity from the draft:picked payload,
 * which carries name/position/nfl_team but no injury status, and injury status
 * from the pool row if the room has it. */
function playerFactsFromPick(pick, row) {
  const player = pick.player || {};
  return {
    name: player.name || null,
    position: player.position || null,
    nfl_team: player.nfl_team || null,
    injury_status: row?.injury_status || null,
  };
}

/**
 * The viewer's running Net vs ADP over their OWN picks so far (ruling 8, the
 * Misery Meter). Each pick carries its own market ADP as `pick.adp` (a number or
 * null), delivered from the server on the pick itself (#833: the draft:state pick
 * rows and the draft:picked outcome both carry `players.adp`), so the sum never
 * depends on the windowed player pool. That is what makes the meter correct in a
 * keeper league, where a keeper is pre-filled into the roster and so is never
 * delivered to the available-player pool.
 *
 * A pick whose `adp` is null contributes 0 through the shared rule's no-market
 * path (src/lib/stealReach.js), exactly as Draft grades treat a pick with no
 * market ADP (server/services/draftgrade.service.js `draftPickValue`: a
 * missing/non-numeric ADP is neutral at the actual pick, so its score is 0).
 * Keepers are NOT exempted: a keeper with a null ADP simply contributes 0 like
 * any other no-market pick, which keeps the Misery Meter and the Draft grade the
 * same measure of the same picks (ADR 0027). The market guard is spelled once, in
 * the shared module, and never re-spelled here. Always derived fresh from the
 * live picks, never accumulated by hand, so it cannot drift.
 */
export function netVsAdpFor({ myPicks, teamCount }) {
  return myPicks.reduce((sum, pick) => {
    const { draftValueScore } = stealReachLabelFor({
      adp: pick.adp,
      pickNumber: pick.pickNumber,
      round: roundForPick(pick.pickNumber, teamCount),
    });
    return sum + draftValueScore;
  }, 0);
}

/**
 * Facts for the viewer's OWN pick landing (ruling 7's first five triggers plus
 * PICK_AUTO). Trigger priority, per ruling 7 and the library's own docblock:
 * PICK_AUTO wins outright when the pick carries the auto flag (never alongside
 * another trigger); otherwise PICK_STEAL / PICK_REACH win over PICK_EARLY_KDEF
 * / PICK_RB / PICK_GENERIC.
 *
 * `priorMyPicks` is the viewer's roster BEFORE this pick ({ pickNumber,
 * position }), because earlyKickerOrDefense asks "is taking one now early",
 * a question about the roster the pick lands on, not the roster it produces
 * (earlyKickerOrDefense.test.js pins this).
 */
export function factsForOwnPick({
  pick, priorMyPicks, rosterSlots, teamCount, draftRounds, poolRow, netVsAdp,
}) {
  const pickNumber = pick.pickNumber;
  const round = roundForPick(pickNumber, teamCount);
  const adp = poolRow?.adp ?? null;
  const player = playerFactsFromPick(pick, poolRow);
  const { label } = stealReachLabelFor({ adp, pickNumber, round });

  const early = (player.position === 'K' || player.position === 'DEF')
    ? earlyKickerOrDefense({
      rosterSlots, roster: priorMyPicks, round, draftRounds,
    })
    : false;

  let trigger;
  if (pick.auto) trigger = TRIGGERS.PICK_AUTO;
  else if (label === 'steal') trigger = TRIGGERS.PICK_STEAL;
  else if (label === 'reach') trigger = TRIGGERS.PICK_REACH;
  else if (early) trigger = TRIGGERS.PICK_EARLY_KDEF;
  else if (player.position === 'RB') trigger = TRIGGERS.PICK_RB;
  else trigger = TRIGGERS.PICK_GENERIC;

  return {
    trigger,
    player,
    pickNumber,
    round,
    draftRounds,
    adp,
    label,
    earlyKickerOrDefense: early,
    auto: !!pick.auto,
    netVsAdp,
  };
}

/**
 * Facts for another team drafting a player who was on the VIEWER'S Queue
 * (TRIGGERS.QUEUE_PICKED_BY_OTHER, the Draft-room-only snipe of ruling 7). The
 * player identity comes off the same draft:picked payload; the templates for
 * this trigger reference only {player}, so a missing pool row (ADP/injury) is
 * never rendered.
 */
export function factsForQueueSnipe({
  pick, teamCount, draftRounds, poolRow, netVsAdp,
}) {
  const pickNumber = pick.pickNumber;
  return {
    trigger: TRIGGERS.QUEUE_PICKED_BY_OTHER,
    player: playerFactsFromPick(pick, poolRow),
    pickNumber,
    round: roundForPick(pickNumber, teamCount),
    draftRounds,
    adp: poolRow?.adp ?? null,
    label: null,
    earlyKickerOrDefense: false,
    auto: !!pick.auto,
    netVsAdp,
  };
}

/**
 * Facts for the viewer BROWSING a player in the pool (TRIGGERS
 * .POOL_PLAYER_BROWSED, the Draft-room half of the #815 split of the old
 * shared pool trigger). The viewer opened this still-available player's quick
 * view from the pool table; the copy is scouting, never departure. The room
 * takes the selection from its own quick-view state rather than widening
 * PlayerPoolTable's interface (issue #792), so the full row - name, position,
 * ADP, injury status - is already in hand. pickNumber and round are null by
 * construction (a browse is not a pick), and adp/injury_status may be null (the
 * pool is windowed, a healthy player has no status); the browsed voice pool
 * references none of those, so a null field is never rendered.
 */
export function factsForPoolBrowse({
  poolRow, teamCount, draftRounds, netVsAdp,
}) {
  return {
    trigger: TRIGGERS.POOL_PLAYER_BROWSED,
    player: playerFactsFromRow(poolRow),
    pickNumber: null,
    round: null,
    draftRounds,
    adp: poolRow?.adp ?? null,
    label: null,
    earlyKickerOrDefense: false,
    auto: false,
    netVsAdp,
  };
}

/** Shared shape for the two triggers with nothing pick-specific to report: the
 * viewer's turn starting, and the urgent clock edge inside it. Neither voice
 * template references a placeholder outside this shape, so the empty player and
 * null pick fields are never rendered. */
function contextualFacts(trigger, { pickNumber, round, draftRounds, netVsAdp }) {
  return {
    trigger,
    player: { ...EMPTY_PLAYER },
    pickNumber: pickNumber ?? null,
    round: round ?? null,
    draftRounds,
    adp: null,
    label: null,
    earlyKickerOrDefense: false,
    auto: false,
    netVsAdp,
  };
}

export function factsForTurnStart(context) {
  return contextualFacts(TRIGGERS.TURN_START, context);
}

export function factsForClockUrgent(context) {
  return contextualFacts(TRIGGERS.CLOCK_URGENT, context);
}
