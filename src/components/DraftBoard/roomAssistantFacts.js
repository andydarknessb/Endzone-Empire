/**
 * Pure facts-object builders for the Draft ROOM's Draft assistant presenter
 * (issue #787, part of the #784 spec). This is the room-venue half of ruling
 * 13's "pickAnnouncement.js / PickAnnouncer.jsx split": no DOM, no React, so
 * DraftRoomAssistant.jsx stays a thin caller, exactly as simAssistantFacts.js
 * is for the Sim (#786).
 *
 * WHY THIS IS NOT simAssistantFacts.js. The Sim consumes its whole draft state
 * through src/lib/draftSim (userTeam, pickValues), which the room does not
 * have: the room's live state arrives over the socket as the draft:picked
 * payload and the reducer-maintained picks array (useDraftSocket.js), neither
 * of which carries a market ADP or an injury status. So this module takes those
 * two facts from the PLAYER POOL ROW instead (ruling item 3: "injury status
 * from the pool row"), looked up by player id, and computes steal/reach itself
 * over the one shared threshold rather than reading a pre-labelled pick.
 *
 * STEAL/REACH LABELLING mirrors src/lib/draftSim/analysis.js's pickValues()
 * exactly (its lines computing `label` from `draftValueScore` and
 * stealReachThreshold(round)): draftValueScore is `adp - pickNumber`, a pick
 * that landed LATER than its market ADP scores negative (a steal), one that
 * landed EARLIER scores positive (a reach), and a player with no known ADP is
 * 'no-market', never a steal or a reach. Only the THRESHOLD is a shared module
 * (src/lib/stealReach.js, promoted in #785 per ruling 5); the four-line
 * labelling itself analysis.js keeps inline, so this room-side reader replicates
 * it here rather than importing the Sim's sim-shaped pickValues().
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
import { stealReachThreshold } from '../../lib/stealReach';

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
 * The steal/reach label and its draftValueScore for one pick, from the shared
 * threshold. Replicates analysis.js's pickValues() rule (see the module
 * docblock). A null ADP is 'no-market' with a zero score, so it can never be
 * called a steal or a reach and contributes nothing to Net vs ADP.
 */
export function stealReachLabelFor({ adp, pickNumber, round }) {
  if (adp == null) return { label: 'no-market', draftValueScore: 0 };
  const draftValueScore = Number(adp) - Number(pickNumber);
  const threshold = stealReachThreshold(round);
  let label = 'value';
  if (draftValueScore <= -threshold) label = 'steal';
  else if (draftValueScore >= threshold) label = 'reach';
  return { label, draftValueScore };
}

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
 * Misery Meter). `adpForPlayer(playerId)` returns a known market ADP or null;
 * a pick with no known ADP is skipped rather than guessed (see the module
 * docblock). Always derived fresh from the live picks, never accumulated by
 * hand, so it cannot drift.
 */
export function netVsAdpFor({ myPicks, adpForPlayer, teamCount }) {
  return myPicks.reduce((sum, pick) => {
    const adp = adpForPlayer(pick.playerId);
    if (adp == null) return sum;
    const { draftValueScore } = stealReachLabelFor({
      adp, pickNumber: pick.pickNumber, round: roundForPick(pick.pickNumber, teamCount),
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
 * Facts for the viewer SELECTING a player in the pool (TRIGGERS
 * .POOL_PLAYER_SELECTED, ruling 7's "a player selected in the pool (cooldown)").
 * The room takes the selection from its own quick-view state rather than
 * widening PlayerPoolTable's interface (issue #792), so the full row - name,
 * position, ADP, injury status - is already in hand.
 */
export function factsForPoolSelection({
  poolRow, teamCount, draftRounds, netVsAdp,
}) {
  return {
    trigger: TRIGGERS.POOL_PLAYER_SELECTED,
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
