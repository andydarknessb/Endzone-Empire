import {
  teamIdForPick, pickLabelFor, teamsInDraftOrder, draftOrderIsSettled,
} from '../../lib/draftTurns';

/**
 * Who picks next, for the active rail's compact Upcoming strip (issue #123
 * acceptance criterion 2).
 *
 * "Upcoming" is strictly what comes AFTER the Team currently On the clock.
 * That Team is already stated persistently above the rail, and repeating it
 * here would cost a manager a beat working out whether the first name in the
 * strip is the current turn or the next one.
 *
 * The strip is Draft order read forward from the current pick (CONTEXT.md:
 * Draft order - a manager's upcoming picks are positions in this order, not a
 * separate thing), so every rule about who holds which slot comes from
 * src/lib/draftTurns.js, which is itself hand-mirrored from the server's
 * draftOrder.service.js. Nothing about snake reversal or per-round overrides
 * is re-derived here.
 */

/**
 * The next `limit` picks after the one on the clock, each as
 * `{ pickNumber, pickLabel, teamId, teamName }`.
 *
 * `pickNumber` is the 1-based number a manager reads off the board
 * (draft_picks.pick_number), converted here exactly once from the 0-based
 * `leagues.current_pick` this walks forward from.
 *
 * A Team holding two picks back to back across a snake turn appears twice, on
 * purpose: collapsing that to one entry would tell a manager they wait one
 * turn when they wait two. Keeper picks already sitting at future pick
 * numbers are skipped instead, because the live draft skips them too, so
 * nobody is ever on the clock for one.
 *
 * `teamName` is passed through untouched. These are the league's CURRENT
 * teams and a current team always has a name (src/lib/teamIdentity.js);
 * routing them through the former-manager label would disguise a data bug as
 * a departed manager.
 */
export function upcomingTeamsFor({ league, teams = [], picks = [], rounds = 0, limit = 3 } = {}) {
  const ordered = teamsInDraftOrder(teams);
  if (!draftOrderIsSettled({ league, orderedTeams: ordered, rounds })) return [];
  // A finished draft has nothing upcoming, and saying so here rather than in
  // draftOrderIsSettled is deliberate: that predicate must stay true for a
  // complete draft, because My Roster reads pick labels and remaining picks
  // off it to render a finished team. "Settled" and "still being drafted"
  // are different questions and only this one wants the second.
  if (league.draft_status === 'complete') return [];

  const teamIds = ordered.map((team) => team.teamId);
  const nameById = new Map(ordered.map((team) => [team.teamId, team.teamName]));
  const totalPicks = teamIds.length * rounds;
  const taken = new Set(picks.map((pick) => pick.pick_number - 1));
  const rotation = league.draft_rotation || 'snake';
  const overrides = league.draft_order_overrides || null;

  const onTheClock0 = Number(league.current_pick) || 0;
  const out = [];
  for (let n = onTheClock0 + 1; n < totalPicks && out.length < limit; n += 1) {
    if (taken.has(n)) continue;
    const teamId = teamIdForPick(n, teamIds, { rotation, overrides });
    if (teamId == null) continue;
    out.push({
      pickNumber: n + 1,
      pickLabel: pickLabelFor(n, teamIds.length),
      teamId,
      teamName: nameById.get(teamId),
    });
  }
  return out;
}
