import {
  teamIdForPick,
  teamsInDraftOrder,
  draftOrderIsSettled,
  remainingPickNumbersFor,
  turnSummaryFor,
  pickLabelFor,
} from '../../lib/draftTurns';
import { draftRounds } from '../../lib/rosterShape';

/**
 * The Draft order, windowed once at the current pick, for everything the room
 * asks of it (issue #793): who picks next (the rail's Upcoming strip), which of
 * those picks are the viewer's own (their My picks group and popover), and the
 * viewer's turn facts (My Roster's remaining count and next label).
 *
 * These three questions were three functions - upcomingTeams.js, viewerPicks.js
 * and rosterViewFor's turn half - each rebuilding the same preamble from the
 * same four inputs: order the teams, take their ids, ask draftOrderIsSettled,
 * assemble the shared pick inputs. Three hand-copies is what let the Upcoming
 * strip and My Roster disagree once (DraftBoard.jsx recorded it). This orders
 * the teams once, evaluates the settled-guard once, and builds the shared
 * inputs once, so the three readings cannot drift.
 *
 * Everything about who holds which slot - snake reversal, linear rotation,
 * per-round overrides, skipped keeper slots - still comes from
 * src/lib/draftTurns.js, the primitive layer shared with the Draft Sim and the
 * Draft order widget. Nothing about order is re-derived here.
 *
 * `rounds` is derived here through draftRounds(league) (ADR 0005: the
 * live-derived roster size while pending, the frozen snapshot once the draft is
 * active or complete), never taken from a caller. Reading league.draft_rounds
 * directly instead would misread a legacy league row that never stored it.
 */

// The Upcoming strip shows at most this many picks after the one on the clock,
// and the viewer's inline preview shows at most this many of their own next
// picks before the popover takes over (issue #124: "the next three").
const UPCOMING_LIMIT = 3;
const INLINE_PREVIEW_COUNT = 3;

export function draftOrderWindowFor({
  league,
  teams = [],
  picks = [],
  viewerTeamId = null,
} = {}) {
  // Order the teams, evaluate the settled-guard, and derive the rounds once.
  const ordered = teamsInDraftOrder(teams);
  const teamIds = ordered.map((team) => team.teamId);
  const nameById = new Map(ordered.map((team) => [team.teamId, team.teamName]));
  const rounds = draftRounds(league);
  const settled = draftOrderIsSettled({ league, orderedTeams: ordered, rounds });

  // Nothing is honestly readable off an unsettled order: no upcoming picks, no
  // viewer picks, no turn. One guard here rather than three at three call sites.
  if (!settled) {
    return {
      settled: false,
      upcoming: [],
      viewerPicks: { all: [], next: [] },
      viewerTurn: null,
    };
  }

  // The shared pick inputs every question below reads, built once.
  // leagues.current_pick is already 0-based and IS the pick on the clock
  // (draft.service.js), so it is both where Upcoming reads forward from and the
  // viewer's own current turn.
  const totalPicks = teamIds.length * rounds;
  const rotation = league.draft_rotation || 'snake';
  const overrides = league.draft_order_overrides || null;
  const onTheClock0 = Number(league.current_pick) || 0;
  // Keepers are pre-inserted at future pick numbers and the live draft skips
  // them, so nobody is ever on the clock for one and they are not picks a Team
  // still has to make. 1-based on the wire (draft_picks.pick_number).
  const takenPickNumbers = new Set((picks || []).map((pick) => pick.pick_number - 1));

  // Upcoming: the next UPCOMING_LIMIT picks strictly AFTER the one on the clock.
  // The current Team is stated persistently above the rail; repeating it here
  // costs a manager a beat working out whether the first name is the current
  // turn or the next. Empty for a complete draft - "settled" stays true for a
  // finished draft so My Roster can read pick labels off it, but nothing is
  // upcoming. A Team holding two picks back to back across a snake turn appears
  // twice, on purpose: collapsing that would say "wait one turn" for a two-turn
  // wait. teamName is passed through untouched (these are current teams, which
  // always have a name); routing it through the former-manager label would
  // disguise a data bug as a departed manager.
  const upcoming = [];
  if (league.draft_status !== 'complete') {
    for (let n = onTheClock0 + 1; n < totalPicks && upcoming.length < UPCOMING_LIMIT; n += 1) {
      if (takenPickNumbers.has(n)) continue;
      const teamId = teamIdForPick(n, teamIds, { rotation, overrides });
      if (teamId == null) continue;
      upcoming.push({
        pickNumber: n + 1,
        pickLabel: pickLabelFor(n, teamIds.length),
        teamId,
        teamName: nameById.get(teamId),
      });
    }
  }

  // The same order read viewer-relatively: which of the picks still to come are
  // the viewer's own. `next` and `all` are produced together, not left to the
  // caller to slice, so the inline three and the popover's full list are the
  // same reading of the same order. A spectator holding no Team here comes back
  // empty naturally - remainingPickNumbersFor answers only for the Team it is
  // asked about, and returns [] for a null or unknown id.
  const remaining = remainingPickNumbersFor({
    teamId: viewerTeamId,
    teamIds,
    fromPick0: onTheClock0,
    totalPicks,
    rotation,
    overrides,
    takenPickNumbers,
  });
  const all = remaining.map((pickNumber0) => ({
    pickNumber: pickNumber0 + 1,
    pickLabel: pickLabelFor(pickNumber0, teamIds.length),
  }));
  const viewerPicks = { all, next: all.slice(0, INLINE_PREVIEW_COUNT) };

  // The viewer's turn facts for My Roster. Null for a spectator holding no Team
  // here: turnSummaryFor would answer 0 remaining / no next pick for an unknown
  // id, which reads on screen as "your draft is done" rather than "not yours".
  const hasTeam = viewerTeamId != null && teamIds.includes(viewerTeamId);
  let viewerTurn = null;
  if (hasTeam) {
    const turn = turnSummaryFor({
      teamId: viewerTeamId,
      teamIds,
      fromPick0: onTheClock0,
      totalPicks,
      rotation,
      overrides,
      takenPickNumbers,
    });
    viewerTurn = {
      remainingPicks: turn.remainingPicks,
      nextPickLabel: turn.nextPick ? turn.nextPick.label : null,
    };
  }

  return { settled: true, upcoming, viewerPicks, viewerTurn };
}
