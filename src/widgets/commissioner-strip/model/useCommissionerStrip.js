import { useLeague } from '../../../hooks/useLeague';
import { useEndpoint, isPickemOnly, isSeasonLive } from '../../../shared/lib';
import { allWeekSettled, applyScoreEvent, useWeekMatchups } from '../../../entities/matchup';

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
 *     nobody", which only a case asserting the commissioner's controls are
 *     PRESENT can catch (see CommissionerStrip.test.jsx's commissioner case).
 *   - `pickemOnly`, `seasonLive` and `currentWeek`: together decide whether
 *     the advance-week feature shows. A pick'em-only league advances on the
 *     NFL calendar (the scheduler's job), a league with no current week has no
 *     week to advance from, and a fantasy league that is not in season or the
 *     playoffs (pre-draft, drafting, complete) has no week to close: the server
 *     answers that advance with a 409 (#1979 L24).
 *
 * Unlike the retired panel, this widget mounts no legacy administration tree
 * and no disclosure of its own: "League administration" is a link to
 * `/league/:id/commissioner` (the commissioner-console page), so the model
 * needs no `isOwner` or `teams`/`viewerTeamId` passthrough for that surface.
 */

// `scoreEvent` (optional) is the page's last live score event: a game that finishes while the page is
// open opens the Advance control without a reload.
export function useCommissionerStrip(leagueId, { scoreEvent } = {}) {
  const { league, refetch } = useLeague(leagueId);

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

  // Advance week opens when every game of the current week is final (ADR 0067 ruling 7). The week's
  // matchups are the shared cached read, so the strip adds no request the dashboard does not make.
  const currentWeek = league?.current_week ?? null;
  const advanceApplies =
    !!league?.is_commissioner && !isPickemOnly(league) && isSeasonLive(league) && currentWeek != null;
  const weekMatchups = useWeekMatchups(advanceApplies ? leagueId : null, currentWeek);
  const entries = Array.isArray(scoreEvent?.scored) ? scoreEvent.scored : [];
  const settled = weekMatchups.matchups.map((m) => {
    const entry = entries.find((e) => e.matchupId === m.id);
    return entry ? applyScoreEvent(m, entry) : m;
  });
  // A failed read is its own reason with a retry, never a permanent "opens when final".
  const checkFailed = advanceApplies && !weekMatchups.loading && !!weekMatchups.error && settled.length === 0;
  const advanceDisabledReason = !advanceApplies
    ? null
    : checkFailed
      ? `Couldn't check Week ${currentWeek} games`
      : weekMatchups.loading || !allWeekSettled(settled, currentWeek)
        ? `Opens when every Week ${currentWeek} game is final`
        : null;

  return {
    advanceDisabledReason,
    advanceRetry: checkFailed ? weekMatchups.refetch : undefined,
    isCommissioner: !!league?.is_commissioner,
    pickemOnly: isPickemOnly(league),
    seasonLive: isSeasonLive(league),
    currentWeek: league?.current_week ?? null,
    pendingJoinRequests,
    refetch,
  };
}

export default useCommissionerStrip;
