import { useCallback, useRef, useState } from 'react';
import { useEndpoint } from '../../../shared/lib';

/**
 * The Lineup page's own Start/sit advice read (#1238, ADR 0037): a plain
 * fetch of `GET /api/team/lineup/advice`, kept at the page level because
 * two slices need the SAME response - the start-sit-panel widget
 * (per-suggestion display and the move plan to write) and the
 * team-summary-strip widget (the advice tile's gain/swap
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
  // `reload()` re-asks the same endpoint after a called shot is declared or
  // withdrawn (#1856): the server pins or releases the pair, so the suggestions
  // and the plan change with it. The counter rides on the URL so useEndpoint
  // refetches; the first read keeps the plain URL. While a reload is in flight
  // the previous advice stays on screen (same league and week) rather than the
  // card flashing empty.
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const base =
    !bestBall && leagueId != null && week != null
      ? `/api/team/lineup/advice?leagueId=${leagueId}&week=${week}`
      : null;
  const url = base && reloads > 0 ? `${base}&reload=${reloads}` : base;
  const { status, data: fetched } = useEndpoint(url);
  const previous = useRef({ base: null, data: null });
  if (fetched) previous.current = { base, data: fetched };
  const data = fetched ?? (base && previous.current.base === base ? previous.current.data : null);

  return {
    status: bestBall ? 'hidden' : status,
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
    movePlan: Array.isArray(data?.movePlan) ? data.movePlan : [],
    projectedTotal: data?.projectedTotal ?? null,
    optimalTotal: data?.optimalTotal ?? null,
    // The team's called shot for the week, or null (#1856): rendered as the
    // standing "Your called shot" line.
    calledShot: data?.calledShot ?? null,
    reload,
  };
}

export default useAdvice;
