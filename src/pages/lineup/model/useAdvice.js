import { useEndpoint } from '../../../shared/lib';

/**
 * The Lineup page's own Start/sit advice read (#1238, ADR 0037): a plain
 * fetch of `GET /api/team/lineup/advice`, kept at the page level because
 * three slices all need the SAME response - the start-sit-panel widget
 * (per-suggestion display), the apply-advice feature (the move plan to
 * write) and the team-summary-strip widget (the advice tile's gain/swap
 * count) - the same "value two widgets both need is passed down by the
 * page" rule `useLineupData.js` already follows for the lineup itself.
 *
 * Best ball never calls this endpoint at all (ADR 0037: "best ball, which
 * never calls the advice endpoint, is why the [lineup] entry carries
 * [Floor/Ceiling] rather than the advice payload"; the server also refuses a
 * best-ball league's advice with a 409) - `bestBall` gates the URL itself so
 * no request is ever attempted, mirroring the widget's own hidden-in-best-
 * ball requirement (AC1) rather than each consumer re-deriving the gate.
 *
 * `week` is the page's OWN viewed week (`lineup.week`, from PickWeek), not
 * necessarily the league's current week: a manager may be looking ahead at
 * next week's lineup and wants advice for THAT week, matching what Apply
 * would actually write.
 */
export function useAdvice({ leagueId, week, bestBall }) {
  const url =
    !bestBall && leagueId != null && week != null
      ? `/api/team/lineup/advice?leagueId=${leagueId}&week=${week}`
      : null;
  const { status, data } = useEndpoint(url);

  return {
    status: bestBall ? 'hidden' : status,
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
    movePlan: Array.isArray(data?.movePlan) ? data.movePlan : [],
    projectedTotal: data?.projectedTotal ?? null,
    optimalTotal: data?.optimalTotal ?? null,
  };
}

export default useAdvice;
