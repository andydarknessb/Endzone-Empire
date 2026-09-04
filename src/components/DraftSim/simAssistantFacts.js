/**
 * Pure facts-object builders for the Draft Sim's Draft assistant presenter
 * (issue #786, part of the #784 spec). Everything here is the Sim-venue half
 * of ruling 13's "pickAnnouncement.js / PickAnnouncer.jsx split": no DOM, no
 * React, so SimAssistantPanel.jsx stays a thin caller.
 *
 * THIS MODULE CONSUMES src/lib/draftAssistant AND src/lib/draftSim/analysis,
 * it does not re-derive either. `earlyKickerOrDefense`, `miseryStage` and the
 * trigger table come straight from the library (issue #785); round, label
 * ('steal' | 'reach' | 'value' | 'no-market') and draftValueScore come from
 * analysis.js's pickValues() - the same function analysis.js itself calls
 * from all three of its report paths (overallGrade, rosterConstruction and
 * analyzeDraft), so this module's read of a pick can never disagree with the
 * post-draft report's. (The urgency threshold isn't this module's concern at
 * all: SimAssistantPanel.jsx calls lib/onTheClock.js's isUrgent() directly,
 * the #754 shared threshold SimStatusBar.jsx also imports.)
 *
 * NET VS ADP SIGN. pickValues()'s draftValueScore is `marketAdp - actualPick`
 * (analysis.js): negative means the pick landed LATER than its market ADP (a
 * steal), positive means EARLIER (a reach). miseryStage()'s own docblock
 * defines `netVsAdp` the same way - the sum of draftValueScore, unnegated, so
 * accumulated steals read negative (the best band) and accumulated reaches
 * read positive (the worst band). This is the Draft Sim's "Market delta"
 * convention (CONTEXT.md's Net vs ADP glossary entry negates it the other
 * way around for its own surface); this module feeds miseryStage() the
 * un-negated sum on purpose, to match what #785 shipped.
 */
import { userTeam, currentRound } from '../../lib/draftSim/engine';
import { pickValues } from '../../lib/draftSim/analysis';
import { TRIGGERS, earlyKickerOrDefense } from '../../lib/draftAssistant';

function emptyPlayerFacts() {
  return {
    name: null, position: null, nfl_team: null, injury_status: null,
  };
}

function playerFactsFor(sim, playerId) {
  const player = (sim.players || []).find((p) => p.playerId === playerId);
  if (!player) return emptyPlayerFacts();
  return {
    name: player.name || null,
    position: player.position || null,
    nfl_team: player.nflTeam || null,
    injury_status: player.injuryStatus || null,
  };
}

/** The user's running Net vs ADP (in #785's netVsAdp/miseryStage sense) over
 * every pick THEY have made in `sim` so far. Always current: called fresh off
 * the live `sim`, never accumulated by hand, so it can't drift from a pick the
 * user's own report will show later. */
export function netVsAdpFor(sim) {
  return pickValues(sim)
    .filter((p) => p.isUser)
    .reduce((sum, p) => sum + p.draftValueScore, 0);
}

/**
 * Facts for the user's OWN pick landing (ruling 7's first five triggers plus
 * PICK_AUTO). `rosterSlots` is the league/template's roster_slots shape,
 * exactly what earlyKickerOrDefense() and RosterPanel already read.
 *
 * Trigger priority, per ruling 7 and the library's own docblock: PICK_AUTO
 * wins outright when the pick carries the auto flag (never alongside another
 * trigger); otherwise PICK_STEAL / PICK_REACH win over PICK_EARLY_KDEF /
 * PICK_RB / PICK_GENERIC.
 */
export function factsForUserPick({ sim, pickNumber, rosterSlots }) {
  const values = pickValues(sim);
  const mine = values.find((p) => p.pickNumber === pickNumber);
  if (!mine) return null;

  // The roster BEFORE this pick - earlyKickerOrDefense asks "is taking one now
  // early", which is a question about the roster the pick is landing on, not
  // the roster that results from it (earlyKickerOrDefense.test.js pins this:
  // the roster passed in never includes the pick being evaluated).
  const priorRoster = values
    .filter((p) => p.isUser && p.pickNumber < pickNumber)
    .map((p) => ({ pickNumber: p.pickNumber, position: p.position }));

  const early = (mine.position === 'K' || mine.position === 'DEF')
    ? earlyKickerOrDefense({
      rosterSlots, roster: priorRoster, round: mine.round, draftRounds: sim.rounds,
    })
    : false;

  let trigger;
  if (mine.auto) trigger = TRIGGERS.PICK_AUTO;
  else if (mine.label === 'steal') trigger = TRIGGERS.PICK_STEAL;
  else if (mine.label === 'reach') trigger = TRIGGERS.PICK_REACH;
  else if (early) trigger = TRIGGERS.PICK_EARLY_KDEF;
  else if (mine.position === 'RB') trigger = TRIGGERS.PICK_RB;
  else trigger = TRIGGERS.PICK_GENERIC;

  return {
    trigger,
    player: playerFactsFor(sim, mine.playerId),
    pickNumber: mine.pickNumber,
    round: mine.round,
    draftRounds: sim.rounds,
    adp: mine.adp,
    label: mine.label,
    earlyKickerOrDefense: early,
    auto: mine.auto,
    netVsAdp: netVsAdpFor(sim),
  };
}

/**
 * Facts for a player leaving the pool via ANOTHER team's pick
 * (TRIGGERS.POOL_PLAYER_TAKEN, the Sim half of the #815 split of the old
 * shared pool trigger) - "somebody wanted him more than you did". The Sim has
 * no browse action (a pool row click there IS the pick), so it never emits
 * POOL_PLAYER_BROWSED; that trigger is the Draft room's alone. The user's OWN
 * picks never take this path; factsForUserPick covers those.
 */
export function factsForPoolTaken({ sim, pickNumber }) {
  const values = pickValues(sim);
  const pick = values.find((p) => p.pickNumber === pickNumber);
  if (!pick) return null;
  return {
    trigger: TRIGGERS.POOL_PLAYER_TAKEN,
    player: playerFactsFor(sim, pick.playerId),
    pickNumber: pick.pickNumber,
    round: pick.round,
    draftRounds: sim.rounds,
    adp: pick.adp,
    label: pick.label,
    earlyKickerOrDefense: false,
    auto: pick.auto,
    netVsAdp: netVsAdpFor(sim),
  };
}

/** Shared shape for the two triggers with nothing pick-specific to report:
 * the user's turn starting, and the urgent clock edge inside it. Neither
 * voice template references a placeholder outside this shape (polkHighLegend
 * .test.js pins that every {placeholder} used resolves to a real facts key),
 * so the empty player/null pick fields are never rendered. */
function contextualFacts(trigger, sim) {
  return {
    trigger,
    player: emptyPlayerFacts(),
    pickNumber: sim.currentPick,
    round: currentRound(sim),
    draftRounds: sim.rounds,
    adp: null,
    label: null,
    earlyKickerOrDefense: false,
    auto: false,
    netVsAdp: netVsAdpFor(sim),
  };
}

export function factsForTurnStart({ sim }) {
  return contextualFacts(TRIGGERS.TURN_START, sim);
}

export function factsForClockUrgent({ sim }) {
  return contextualFacts(TRIGGERS.CLOCK_URGENT, sim);
}

/** The Sim's own user team, once per call - callers already need `sim` and
 * this is the one place the "which team is mine" lookup lives for this
 * module, mirroring engine.js's own userTeam() rather than re-scanning teams
 * by hand. */
export function userTeamId(sim) {
  const team = userTeam(sim);
  return team ? team.id : null;
}
