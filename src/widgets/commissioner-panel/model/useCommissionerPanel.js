import { useLeague } from '../../../hooks/useLeague';
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

  return {
    league,
    teams,
    viewerTeamId,
    isCommissioner: !!league?.is_commissioner,
    isOwner: isLeagueCreator(league, viewerTeamId),
    pickemOnly: isPickemOnly(league),
    currentWeek: league?.current_week ?? null,
    refetch,
  };
}

export default useCommissionerPanel;
