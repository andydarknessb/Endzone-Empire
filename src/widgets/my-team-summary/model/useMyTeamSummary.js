import { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';
import { ordinal } from '../lib/ordinal';

/**
 * Data model for the my-team summary widget (League Dashboard hero-left,
 * ticket #639). The widget owns its own reads; this hook is where they live so
 * the UI stays a thin presenter.
 *
 * Four sources, each answering "which of these is me" by Team id against the
 * viewer's own team id (`viewerTeamId`), never an account identifier (#112,
 * CONTEXT.md team identity):
 *
 *   - Team identity comes from the shared league cache (useLeague / ADR 0004):
 *     the Team in `teams[]` whose id equals `viewerTeamId`. A repeat read here
 *     is served from the same cache the page shell already warmed, so it costs
 *     no extra request.
 *   - Record and current rank come from the scoring standings read. The
 *     standings read is the widget's SPINE: its loading state drives the card's
 *     skeletons and its failure drives the card's compact error, so a failed
 *     summary never touches the rest of the page. Standings and power-rankings
 *     are both plain reads here rather than shared-cache resources ONLY because
 *     this widget mounts each once (ADR 0004): both endpoints are on the
 *     service-worker allowlist, so the moment a second consumer of either lands
 *     on this page (e.g. #641's standings table) that read must move to
 *     useResource, the way the league read already has.
 *   - Draft grade and roster value come from the league draft-grades read. When
 *     it 404s (grades not generated yet) both tiles degrade to a placeholder
 *     with no number, rather than erroring the card.
 *   - Projected finish is a plain read of the power-rankings endpoint (see the
 *     one-mount trigger above). It 404s until first computed; until then the
 *     tile is simply absent, not a placeholder.
 */

const IDLE = { status: 'loading', data: null };

// One GET bound to a URL, tracking loading -> ready | error. Every failure is
// one 'error' state: the widget degrades the same way whether a read 404s or
// 500s (a missing grade is a placeholder either way, a missing projection an
// absent tile either way), so it does not distinguish the status code. A null
// url never fetches. Cancels on unmount / url change so a late response cannot
// land after the widget has moved on.
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
        if (!cancelled) setState({ status: 'ready', data: res?.data ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

const findById = (rows, teamId) =>
  (Array.isArray(rows) ? rows.find((row) => row && row.teamId === teamId) : null) || null;

// "3-1" with no ties, "3-1-2" when ties have happened.
const formatRecord = (row) => {
  const wins = Number(row.wins) || 0;
  const losses = Number(row.losses) || 0;
  const ties = Number(row.ties) || 0;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
};

const gamesPlayed = (row) =>
  (Number(row.wins) || 0) + (Number(row.losses) || 0) + (Number(row.ties) || 0);

export function useMyTeamSummary(leagueId) {
  const { league, teams, viewerTeamId } = useLeague(leagueId);

  const standings = useEndpoint(leagueId != null ? `/api/scoring/league/${leagueId}/standings` : null);
  const grades = useEndpoint(leagueId != null ? `/api/league/${leagueId}/draft-grades` : null);
  const rankings = useEndpoint(leagueId != null ? `/api/scoring/league/${leagueId}/power-rankings` : null);

  const viewerTeam =
    viewerTeamId != null && Array.isArray(teams)
      ? teams.find((t) => t && t.teamId === viewerTeamId) || null
      : null;

  // `teamName` is the canonical Team-identity field on every league-shared
  // contract (teamIdentity.js: teamId + teamName, camelCase, enforced by
  // TEAM_IDENTITY_FIELDS); the avatar rides as the raw snake_case columns the
  // league-detail route serializes (avatar_url / avatar_static_url).
  const identity = viewerTeam
    ? {
        name: viewerTeam.teamName,
        avatarUrl: viewerTeam.avatar_url ?? null,
        avatarStaticUrl: viewerTeam.avatar_static_url ?? null,
      }
    : null;

  // Record + current rank: only once games have been played (preseason omits
  // the line entirely). Reads from the standings spine, so it is null until the
  // spine is ready.
  let record = null;
  if (standings.status === 'ready') {
    const row = findById(standings.data?.standings, viewerTeamId);
    if (row && gamesPlayed(row) > 0) {
      const rank = ordinal(Number(row.rank));
      record = { text: formatRecord(row), rankText: rank ? rank.toString() : null };
    }
  }

  // Draft grade + roster value share the one draft-grades read. A 404 (or any
  // failure, or a ready read with no row for the viewer) degrades both tiles to
  // a placeholder; a null grade/value degrades just that tile.
  const gradeRow = grades.status === 'ready' ? findById(grades.data?.grades, viewerTeamId) : null;
  const gradesUnavailable = grades.status === 'error' || (grades.status === 'ready' && !gradeRow);
  const rawGrade = gradeRow && gradeRow.grade != null ? String(gradeRow.grade).trim() : '';
  const rawRosterValue = gradeRow ? Number(gradeRow.rosterValue) : NaN;
  const draftGrade = {
    loading: grades.status === 'loading',
    unavailable: gradesUnavailable,
    letter: rawGrade || null,
    // The five real grades map to a legible grade-as-text token; anything else
    // (including a stray 'E', which has no token) falls back to ink.
    gradeKey: /^[ABCDF]$/i.test(rawGrade) ? rawGrade.toUpperCase() : null,
  };
  const rosterValue = {
    loading: grades.status === 'loading',
    unavailable: gradesUnavailable,
    text: Number.isFinite(rawRosterValue) ? rawRosterValue.toLocaleString('en-US') : null,
  };

  // Projected finish: absent until the power-rankings run exists and carries a
  // rank for the viewer. 404 / error / loading all render no tile.
  let proj = null;
  if (rankings.status === 'ready') {
    const row = findById(rankings.data?.data?.rankings, viewerTeamId);
    const rank = row ? ordinal(Number(row.rank)) : null;
    if (rank) proj = { ordinal: rank };
  }

  return {
    league,
    identity,
    // The card's spine: 'loading' -> skeletons, 'error' -> compact error.
    spine: standings.status,
    record,
    draftGrade,
    rosterValue,
    proj,
  };
}

export default useMyTeamSummary;
