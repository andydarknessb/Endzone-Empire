import { useEndpoint } from '../../../shared/lib';
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
 *
 * The number each row carries is `adpNet`, the figure the grade is actually
 * ranked on (draftgrade.service: the negated sum of ADP minus pick across the
 * Team's picks, higher is better), with the Team's best `steal` and worst
 * `reach` alongside so the card can say how the grade was earned. Projected
 * roster value is deliberately not read here: the grade is not based on it,
 * and at week 1 of a season it is null (no projections exist yet).
 */

export function useDraftGrades(leagueId) {
  const { teams, viewerTeamId } = useLeague(leagueId);

  // draft-grades is the ONE consumer of the shared useEndpoint (src/shared/lib,
  // #669) that reads `httpStatus`. Its two failure modes render differently: a
  // 404 means the draft has not produced grades yet (rendered as 'pending', not
  // an error), everything else is a real failure. The other dashboard readers
  // ignore `httpStatus` because their failures all degrade identically; this
  // widget is why the shared hook reports it at all.
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

  const pickSummary = (pick) =>
    pick && pick.name
      ? {
          name: pick.name,
          pickNumber: Number(pick.pickNumber),
          marketAdp: Number(pick.marketAdp),
        }
      : null;

  // Rows preserve the response's own order (the server already ranks
  // best-first), joined against `teams[]` for the Team's canonical name.
  const rows = gradeRows.map((row) => {
    const team = teamRows.find((t) => t && t.teamId === row.teamId) || null;
    return {
      teamId: row.teamId,
      teamName: team ? team.teamName : row.name,
      grade: row.grade,
      adpNet: Number(row.adpNet),
      steal: pickSummary(row.steal),
      reach: pickSummary(row.reach),
    };
  });

  return { phase, rows, viewerTeamId };
}

export default useDraftGrades;
