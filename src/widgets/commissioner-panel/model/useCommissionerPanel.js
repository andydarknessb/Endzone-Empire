import { useLeague } from '../../../hooks/useLeague';
import { commissionerFacts, useEndpoint } from '../../../shared/lib';
import { isPickemOnly } from '../../../lib/leagueType';
import { isLeagueCreator } from '../../../lib/teamIdentity';

/**
 * Data model for the commissioner-panel widget (League Dashboard rail, ticket
 * #644). It reads the shared league cache (useLeague / ADR 0004) that the page
 * shell already warmed, so it costs no extra request, and derives the three
 * questions the panel asks of the payload:
 *
 *   - `isCommissioner`: the panel's whole presence gate. Read from the league
 *     payload's own `is_commissioner` flag, the SAME field useQuickActions
 *     gates its commissionerOnly card on - not `invite_code`, which the shell's
 *     CopyInvite reads and which answers a different question (a code being
 *     present, not a role). A single spelling keeps the two commissioner gates
 *     on this page from drifting apart.
 *   - `isOwner`: whether the viewer created this league, by Team identity
 *     (isLeagueCreator: `ownerTeamId === viewerTeamId`, never an account id).
 *     Passed straight through to the legacy commissioner tools, which gate the
 *     two owner-only powers (deleting the league, managing co-commissioners) on
 *     it. It defaults FALSE in the tools, so a null-vs-null match is refused.
 *   - `pickemOnly` and `currentWeek`: together decide whether the advance-week
 *     control shows. A pick'em-only league advances on the NFL calendar (the
 *     scheduler's job), and a league with no current week has no week to
 *     advance from, so neither renders the control.
 *
 * `refetch` is the cached league refetch the advance-week feature and the
 * legacy tools both trigger after a successful mutation: it re-reads the league
 * row, which re-keys the week-scoped standings read for the mounted tables.
 */

export function useCommissionerPanel(leagueId) {
  const { league, teams, viewerTeamId, refetch } = useLeague(leagueId);

  // The pending join queue: the panel's ONE request, and the count a
  // commissioner would otherwise have to expand the tools and find on a tab.
  //
  // The null URL is load-bearing, not a formality. This hook runs on every
  // member's dashboard - the panel's `isCommissioner` gate returns null AFTER
  // it - so a URL built without the `is_commissioner` clause would fire a read
  // the route answers 403 to, on every member's page load. The other two
  // clauses are the pair GeneralSettingsPanel gates its own copy of this queue
  // on: a private league takes no join requests, and a public league that does
  // not screen joins admits them without ever queueing one.
  const showJoinQueue = !!league?.is_commissioner && !!league?.is_public && !!league?.join_approval;
  const joinRequests = useEndpoint(
    showJoinQueue && leagueId != null ? `/api/league/${leagueId}/join-requests` : null
  );
  // Null until the read lands, and null if it fails: "0 pending" is a different
  // statement from "not read yet", and the panel states nothing rather than a
  // zero it cannot stand behind.
  const pendingJoinRequests =
    joinRequests.status === 'ready' && Array.isArray(joinRequests.data)
      ? joinRequests.data.length
      : null;

  return {
    league,
    teams,
    viewerTeamId,
    isCommissioner: !!league?.is_commissioner,
    isOwner: isLeagueCreator(league, viewerTeamId),
    pickemOnly: isPickemOnly(league),
    currentWeek: league?.current_week ?? null,
    facts: commissionerFacts(league, teams),
    pendingJoinRequests,
    // The creator plus every co-commissioner grant. `co_commissioners` rides on
    // the payload for a commissioner (league.router.js), and the creator is
    // named on the league itself rather than flagged inside that list, which is
    // why the count is length + 1.
    commissionerCount:
      (Array.isArray(league?.co_commissioners) ? league.co_commissioners.length : 0) + 1,
    refetch,
  };
}

export default useCommissionerPanel;
