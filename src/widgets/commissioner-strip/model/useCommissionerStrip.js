import { useLeague } from '../../../hooks/useLeague';
import { commissionerFacts, useEndpoint } from '../../../shared/lib';
import { isPickemOnly } from '../../../lib/leagueType';

/**
 * Data model for the commissioner-strip widget (League Dashboard, #1108). It
 * reads the same shared league cache (useLeague / ADR 0004) the retired
 * commissioner-panel rail card read, so it costs no extra request, and it
 * derives the same three gating questions useCommissionerPanel does:
 *
 *   - `isCommissioner`: the strip's whole presence gate, read from the league
 *     payload's `is_commissioner` flag - the SAME field the rail card and
 *     useQuickActions gate on. It is never `invite_code`, which answers a
 *     different question (a code being present, not a role); mutating the
 *     gate to read `invite_code` instead collapses it to "render for
 *     nobody", which only a case asserting the tiles' PRESENCE can catch (see
 *     CommissionerStrip.test.jsx's commissioner case).
 *   - `pickemOnly` and `currentWeek`: together decide whether the
 *     advance-week feature shows. A pick'em-only league advances on the NFL
 *     calendar (the scheduler's job), and a league with no current week has
 *     no week to advance from.
 *
 * Unlike the retired panel, this widget mounts no legacy administration tree
 * and no disclosure of its own: "League administration" is a link to
 * `/league/:id/commissioner` (the commissioner-console page), so the model
 * needs no `isOwner` or `teams`/`viewerTeamId` passthrough for that surface.
 *
 * `facts` is trimmed to the five the strip states (Transactions, Teams
 * locked, Trade deadline, Waivers, Trade review): the roster and scoring
 * facts `commissionerFacts` also derives belong to the console page, per the
 * ticket's own scope line.
 */

const STRIP_FACT_KEYS = ['transactions', 'teams-locked', 'trade-deadline', 'waivers', 'trade-review'];

export function useCommissionerStrip(leagueId) {
  const { league, teams, refetch } = useLeague(leagueId);

  // The pending join queue's count only, gated the same way the retired panel
  // gated it. The null URL is load-bearing: this hook runs on every member's
  // dashboard mount (the `isCommissioner` gate returns null in the component,
  // AFTER this hook has already run), so a URL built without the
  // `is_commissioner` clause would fire a read the route answers 403 to on
  // every member's page load. The other two clauses are the pair
  // GeneralSettingsPanel gates its own copy of this queue on: a private
  // league takes no join requests, and a public league that does not screen
  // joins admits them without ever queueing one.
  const showJoinQueue = !!league?.is_commissioner && !!league?.is_public && !!league?.join_approval;
  const joinRequests = useEndpoint(
    showJoinQueue && leagueId != null ? `/api/league/${leagueId}/join-requests` : null
  );
  // Null until the read lands, and null if it fails: "0 pending" is a
  // different statement from "not read yet", and the strip states nothing
  // rather than a zero it cannot stand behind.
  const pendingJoinRequests =
    joinRequests.status === 'ready' && Array.isArray(joinRequests.data)
      ? joinRequests.data.length
      : null;

  return {
    isCommissioner: !!league?.is_commissioner,
    pickemOnly: isPickemOnly(league),
    currentWeek: league?.current_week ?? null,
    facts: commissionerFacts(league, teams).filter((fact) => STRIP_FACT_KEYS.includes(fact.key)),
    pendingJoinRequests,
    // The creator plus every co-commissioner grant. `co_commissioners` rides
    // on the payload for a commissioner (league.router.js), and the creator
    // is named on the league itself rather than flagged inside that list,
    // which is why the count is length + 1.
    commissionerCount:
      (Array.isArray(league?.co_commissioners) ? league.co_commissioners.length : 0) + 1,
    refetch,
  };
}

export default useCommissionerStrip;
