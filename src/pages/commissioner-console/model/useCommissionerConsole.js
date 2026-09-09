import { useLeague } from '../../../hooks/useLeague';
import { commissionerFacts } from '../../../shared/lib';
import { isPickemOnly } from '../../../lib/leagueType';
import { isLeagueCreator } from '../../../lib/teamIdentity';
import { deriveLeaguePhase, isSeasonLive, LEAGUE_PHASE_META } from '../../../lib/leaguePhase';

/**
 * Data model for the `commissioner-console` page slice (ADR 0034, #1107). It
 * reads the shared league cache (useLeague / ADR 0004) - the same entry the
 * League Dashboard warmed, so the hop from there costs no request - and
 * derives what the page's header and facts strip need. `facts` is the one
 * function (`shared/lib` `commissionerFacts`) both this console and the
 * dashboard's commissioner strip read, so the two surfaces cannot state the
 * league's settled facts differently.
 *
 * `isCommissioner` and `isOwner` mirror the pair `useCommissionerPanel`
 * already derives, by the same two fields (`league.is_commissioner`, Team
 * identity via `isLeagueCreator`), so the two commissioner gates in the
 * island do not drift. `showAdvance` mirrors the panel's own gate for the
 * advance-week control: a pick'em-only league advances on the NFL calendar,
 * and a league with no current week has no week to advance from.
 *
 * The phase chip label is the same derivation `LeagueDashboardPage` uses:
 * "Week N · <phase label>" while the season is being played, the bare phase
 * label otherwise, from the client League-phase helper and never a stored
 * status field.
 */
export function useCommissionerConsole(leagueId) {
  const { league, teams, viewerTeamId, loading, error, refetch } = useLeague(leagueId);

  const pickemOnly = isPickemOnly(league);
  const currentWeek = league?.current_week ?? null;
  const phase = league ? deriveLeaguePhase(league) : null;
  const phaseLabel = phase ? LEAGUE_PHASE_META[phase]?.label ?? '' : '';
  const seasonLive = league ? isSeasonLive(league) : false;
  const phaseChipLabel = seasonLive && currentWeek != null ? `Week ${currentWeek} · ${phaseLabel}` : phaseLabel;

  return {
    league,
    teams,
    viewerTeamId,
    loading,
    error,
    refetch,
    isCommissioner: !!league?.is_commissioner,
    isOwner: isLeagueCreator(league, viewerTeamId),
    pickemOnly,
    currentWeek,
    showAdvance: !pickemOnly && currentWeek != null,
    seasonLive,
    phaseChipLabel,
    // The creator plus every co-commissioner grant, the same count
    // `useCommissionerPanel` states in its tail badge.
    commissionerCount: (Array.isArray(league?.co_commissioners) ? league.co_commissioners.length : 0) + 1,
    facts: commissionerFacts(league, teams),
  };
}

export default useCommissionerConsole;
