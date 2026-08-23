import {
  teamsInDraftOrder, draftOrderIsSettled, remainingPickNumbersFor, pickLabelFor,
} from '../../lib/draftTurns';

/**
 * The viewer's own remaining Pick numbers, for the manager's Draft order
 * (issue #124 acceptance criterion 4).
 *
 * A manager's upcoming picks are positions in the league's Draft order, not a
 * separate thing (CONTEXT.md: Draft order), so every rule about snake
 * reversal, linear rotation, per-round overrides and skipped keeper slots
 * comes from src/lib/draftTurns.js - which itself carries the sync obligation
 * against the server's draftOrder.service.js. Nothing here re-derives any of
 * it. The sibling upcomingTeams.js asks the same module the league-wide
 * version of this question ("who picks next, whoever they are"); this asks the
 * viewer-relative one ("which of them are mine").
 *
 * `next` and `all` are produced together rather than left to the caller to
 * slice, because the inline three and the popover's complete list must be the
 * same reading of the same order - two call sites slicing independently is how
 * an inline "next pick 2.07" ends up above a list that starts at 2.06.
 *
 * Returns empty for anything it cannot answer honestly: a pending draft, an
 * order where some Team holds no slot or two share one, a spectator with no
 * Team here. An invented pick number is indistinguishable on screen from a
 * real one, and a manager plans their wait around it.
 */
export function viewerPicksFor({
  league,
  teams = [],
  picks = [],
  rounds = 0,
  viewerTeamId = null,
  previewCount = 3,
} = {}) {
  const empty = { all: [], next: [] };

  const ordered = teamsInDraftOrder(teams);
  if (!draftOrderIsSettled({ league, orderedTeams: ordered, rounds })) return empty;

  const teamIds = ordered.map((team) => team.teamId);

  // No guard here for a null `viewerTeamId` or for an id belonging to no Team
  // in this league. Both already come back empty from remainingPickNumbersFor,
  // which answers only for the Team it is asked about, and a guard that no
  // broken implementation can be caught by is a comment wearing an if.

  const remaining = remainingPickNumbersFor({
    teamId: viewerTeamId,
    teamIds,
    // leagues.current_pick is already 0-based and IS the pick on the clock, so
    // the viewer's own current turn is the first entry of their own list
    // rather than something already behind them.
    fromPick0: Number(league.current_pick) || 0,
    totalPicks: teamIds.length * rounds,
    rotation: league.draft_rotation || 'snake',
    overrides: league.draft_order_overrides || null,
    // Keepers are pre-inserted at future pick numbers and the live draft skips
    // them, so they are not picks this Team still has to make.
    takenPickNumbers: new Set((picks || []).map((pick) => pick.pick_number - 1)),
  });

  const all = remaining.map((pickNumber0) => ({
    // The 1-based number a manager reads off the board
    // (draft_picks.pick_number), converted from the 0-based index exactly once.
    pickNumber: pickNumber0 + 1,
    pickLabel: pickLabelFor(pickNumber0, teamIds.length),
  }));

  return { all, next: all.slice(0, Math.max(0, previewCount)) };
}

export default viewerPicksFor;
