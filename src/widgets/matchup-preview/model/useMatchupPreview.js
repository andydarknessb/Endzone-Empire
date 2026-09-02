import { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';
import { teamNameLabel } from '../../../lib/teamIdentity';

/**
 * Data model for the matchup-preview widget (League Dashboard hero-right,
 * ticket #640). The widget owns its own reads; this hook is where they live so
 * the UI stays a thin presenter.
 *
 * The pairing is a CHAINED read (carry-over #3 on #640): the week's matchups
 * list names the viewer's matchup, and a detail read for THAT matchup carries
 * each side's projection.
 *
 *   - The matchups list is the widget's SPINE. Its URL carries the league's
 *     current week, and it is the widget's only week-scoped request: its loading
 *     state drives the card's skeletons and its failure drives the card's
 *     compact error, so a failed matchup never touches the rest of the page. The
 *     viewer's matchup is the row whose home or away Team id equals
 *     `viewerTeamId` (#112, contract in src/lib/teamIdentity.js: match on Team
 *     id, never an account identifier).
 *   - The detail read is chained off the list: its URL depends on the selected
 *     matchup id, so it stays null (and never fetches) until the list has
 *     resolved and a matchup for the viewer exists. It supplies each side's
 *     projected total, `expectedFinal` (the per-side projected total the matchup
 *     detail computes; MatchupDetail.jsx surfaces it as "Projected N.N" while a
 *     game is live, and this card shows it as the pre-kickoff projection).
 *
 *     This second read is LOAD-BEARING and must not be collapsed into the list.
 *     The list row already carries `home_expected_final` / `away_expected_final`
 *     (attachExpectedFinals decorates every row), so reading those instead looks
 *     equivalent and is not: attachExpectedFinals materializes no lineups on
 *     purpose ("a list GET must not write a dozen teams' rows",
 *     expectedFinal.service.js), so a team with no starter rows yet answers
 *     null there. The detail route calls materializeLineup for both teams inside
 *     its own transaction, so it returns a real number for a manager who has not
 *     opened their lineup, which is the common early-week case. Delete the detail
 *     read and that manager sees a placeholder instead of a projection.
 *
 *     A miss or a failed detail read degrades just the number to a placeholder
 *     rather than erroring the card, the way the spine/degrade split works in
 *     the sibling my-team widget.
 *   - Team names and avatars come from the shared league cache (useLeague /
 *     ADR 0004): the Team in `teams[]` whose id equals each side's id, read as
 *     `teamName` (the canonical identity field, teamIdentity.js), never the raw
 *     `name` column that the matchup routes also leak.
 *
 * Both reads are on the service-worker API allowlist
 * (public/service-worker.js: /api/league/N/matchups(/M)?). They are plain
 * useEndpoint reads rather than shared useResource resources ONLY because this
 * widget is the single mount of either URL on this page (ADR 0004: cache through
 * useResource when the GET is on the allowlist AND read by more than one mount
 * per typical navigation). The moment a second consumer of the week's matchups
 * or of a matchup detail lands on this page, that read must move to useResource,
 * the way the league read already has.
 */

const IDLE = { status: 'loading', data: null };

// One GET bound to a URL, tracking loading -> ready | error. A null url never
// fetches, which is what keeps the chained detail read from firing with an
// undefined matchup id while the list is still loading. Cancels on unmount /
// url change so a late response cannot land after the widget has moved on.
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

export function useMatchupPreview(leagueId) {
  const { teams, viewerTeamId, league } = useLeague(leagueId);
  const week = league?.current_week ?? null;

  // Read 1 (the spine): the week's matchups. Null until we know the league and
  // the current week, so a league with no current week never fires it.
  const listUrl =
    leagueId != null && week != null ? `/api/league/${leagueId}/matchups?week=${week}` : null;
  const list = useEndpoint(listUrl);

  // Pick the viewer's matchup by Team id (#112). The list is a bare array.
  const rows = Array.isArray(list.data) ? list.data : [];
  const myMatchup =
    viewerTeamId != null
      ? rows.find(
          (m) => m && (m.home_team_id === viewerTeamId || m.away_team_id === viewerTeamId)
        ) || null
      : null;
  const matchupId = myMatchup ? myMatchup.id : null;
  const opponentId = myMatchup
    ? myMatchup.home_team_id === viewerTeamId
      ? myMatchup.away_team_id
      : myMatchup.home_team_id
    : null;

  // Read 2 (chained): the matchup detail, only once a matchup id exists.
  const detailUrl =
    leagueId != null && matchupId != null
      ? `/api/league/${leagueId}/matchups/${matchupId}`
      : null;
  const detail = useEndpoint(detailUrl);

  // Identity + avatar for one Team id, from the cached league resource. Reads
  // `teamName` (never the leaked `name` column); a name that is absent reads as
  // the former-manager label the whole app shares (teamIdentity.js).
  const identityFor = (teamId) => {
    const row =
      teamId != null && Array.isArray(teams) ? teams.find((t) => t && t.teamId === teamId) : null;
    return {
      name: teamNameLabel(row ? row.teamName : null),
      avatarUrl: row ? row.avatar_url ?? null : null,
      avatarStaticUrl: row ? row.avatar_static_url ?? null : null,
    };
  };

  // Each side's projected total, to one decimal. Loading while the detail read
  // is in flight (the number is skeletoned, holding layout); null (a
  // placeholder) on a miss or a failed detail read.
  const projectedFor = (teamId) => {
    if (detail.status === 'loading') return { loading: true, value: null };
    const sides = detail.status === 'ready' && detail.data ? [detail.data.home, detail.data.away] : [];
    const side = sides.find((s) => s && s.teamId === teamId) || null;
    const raw = side ? Number(side.expectedFinal) : NaN;
    return { loading: false, value: Number.isFinite(raw) ? raw.toFixed(1) : null };
  };

  // Card status: the list is the spine. A null list URL means there is nothing
  // to fetch (no current week), which is an empty card, NOT a loading one: with
  // no url useEndpoint idles at 'loading' forever, so this case is handled
  // before the read's status is consulted.
  let status;
  if (listUrl == null) status = 'empty';
  else if (list.status === 'loading') status = 'loading';
  else if (list.status === 'error') status = 'error';
  else if (!myMatchup) status = 'empty';
  else status = 'ready';

  const viewer =
    status === 'ready'
      ? { ...identityFor(viewerTeamId), projected: projectedFor(viewerTeamId) }
      : null;
  const opponent =
    status === 'ready' ? { ...identityFor(opponentId), projected: projectedFor(opponentId) } : null;

  // aria-busy while a layout-holding read is in flight: the list spine, and the
  // chained detail read whose projected numbers are skeletoned (carry-over #2).
  const busy = status === 'loading' || (status === 'ready' && detail.status === 'loading');

  return { week, status, busy, matchupId, viewer, opponent };
}

export default useMatchupPreview;
