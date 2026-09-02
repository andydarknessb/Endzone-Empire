import { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';

/**
 * Data model for the draft-grades rail widget (League Dashboard rail-top,
 * ticket #642). The widget owns its own read; this hook is where it lives so
 * the UI stays a thin presenter.
 *
 * Team identity (`teamId` + `teamName`) comes from the shared league cache
 * (useLeague / ADR 0004): every row is joined against `teams[]` by Team id, and
 * the viewer's row is the one whose Team id equals `viewerTeamId`, never an
 * account identifier (#112, CONTEXT.md team identity). A repeat read here is
 * served from the same cache the page shell already warmed, so it costs no
 * extra request.
 *
 * The grades themselves are a plain read of `/api/league/:id/draft-grades`,
 * not a `useResource` adapter. This widget is a second consumer of that
 * endpoint (my-team-summary, #639, is the first), which is half of ADR 0004's
 * admission rule, but the other half fails: draft-grades is not on the
 * service worker's `API_ALLOWLIST`. A plain read is correct because of that
 * condition, not as a permanent fact - if draft-grades is ever added to the
 * allowlist while more than one mount still reads it, ADR 0004's rule fires
 * and this read should move to a `useResource` adapter.
 */

const IDLE = { status: 'loading', data: null, httpStatus: null };

// One GET bound to a URL, tracking loading -> ready | error, and unlike
// #639's useEndpoint, also the HTTP status of a failure: this widget's two
// failure modes render differently (a 404 means the draft has not produced
// grades yet, everything else is a real failure), so the caller needs the
// code, not just a pass/fail flag. A null url never fetches. Cancels on
// unmount / url change so a late response cannot land after the widget has
// moved on.
function useEndpoint(url) {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    if (!url) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    setState(IDLE);
    apiClient
      .get(url)
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', data: res?.data ?? null, httpStatus: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: 'error', data: null, httpStatus: err?.response?.status ?? null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

export function useDraftGrades(leagueId) {
  const { teams, viewerTeamId } = useLeague(leagueId);

  const grades = useEndpoint(leagueId != null ? `/api/league/${leagueId}/draft-grades` : null);

  // The card's own spine: 'loading' -> skeleton rows, 'pending' -> the
  // grades-arrive-when-the-draft-completes copy with no error, 'error' -> a
  // compact error, 'ready' -> the graded rows. A 404 is the ordinary
  // "grades not generated yet" case, so it is 'pending', not 'error'; every
  // other failure (a 500, a network error) is 'error'.
  let phase;
  if (grades.status === 'loading') phase = 'loading';
  else if (grades.status === 'error') phase = grades.httpStatus === 404 ? 'pending' : 'error';
  else phase = 'ready';

  const gradeRows = Array.isArray(grades.data?.grades) ? grades.data.grades : [];
  const teamRows = Array.isArray(teams) ? teams : [];

  // Rows preserve the response's own order (the server already ranks
  // best-first), joined against `teams[]` for the Team's canonical name.
  const rows = gradeRows.map((row) => {
    const team = teamRows.find((t) => t && t.teamId === row.teamId) || null;
    return {
      teamId: row.teamId,
      teamName: team ? team.teamName : row.name,
      grade: row.grade,
      rosterValue: Number(row.rosterValue),
    };
  });

  const maxRosterValue = rows.reduce(
    (max, row) => (Number.isFinite(row.rosterValue) && row.rosterValue > max ? row.rosterValue : max),
    0
  );

  return { phase, rows, viewerTeamId, maxRosterValue };
}

export default useDraftGrades;
