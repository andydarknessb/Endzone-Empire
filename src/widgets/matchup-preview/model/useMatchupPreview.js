import { useEndpoint } from '../../../shared/lib';
import { useLeague } from '../../../hooks/useLeague';
import { teamNameLabel } from '../../../lib/teamIdentity';
import { matchupFromListRow, matchupFromDetailBody } from '../../../entities/matchup';

/**
 * Data model for the matchup-preview widget (League Dashboard hero-right,
 * ticket #640). The widget owns its own reads; this hook is where they live so
 * the UI stays a thin presenter.
 *
 * The pairing is a CHAINED read (carry-over #3 on #640): the week's matchups
 * list names the viewer's matchup, and the widget prefers that row's own
 * projections, falling back to a detail read for THAT matchup only when the
 * list cannot answer (#670: prefer-then-fall-back, never a replace).
 *
 *   - The matchups list is the widget's SPINE. Its URL carries the league's
 *     current week, and it is the widget's only week-scoped request: its loading
 *     state drives the card's skeletons and its failure drives the card's
 *     compact error, so a failed matchup never touches the rest of the page. The
 *     viewer's matchup is the row whose home or away Team id equals
 *     `viewerTeamId` (#112, contract in src/lib/teamIdentity.js: match on Team
 *     id, never an account identifier). That row already carries each side's
 *     Expected final (attachExpectedFinals decorates every row), read off the
 *     row's one Matchup shape (entities/matchup) rather than a database column
 *     name (#864), and the widget renders those directly whenever BOTH sides are
 *     non-null there. The check is a null check, never a truthiness check: a
 *     legitimate `0` is a value the list already has, and must render (and must
 *     not fall back) exactly like any other number.
 *   - The detail read is the FALLBACK, fired only when either side's Expected
 *     final is null on the list row for the viewer's matchup AND the league is
 *     not best-ball (#688: see below, the fallback read cannot help best ball).
 *     Its URL depends on three things together, the selected matchup id, that
 *     null check, and the league's best-ball flag, so it stays null (and never
 *     fetches, the same null-URL-never-fetches convention the list read
 *     already relies on) whenever the list already answered both sides,
 *     whenever the league is best-ball, or until the list has resolved and a
 *     matchup for the viewer exists. When it does fire, it supplies each
 *     side's projected total, `expectedFinal` (the per-side projected total
 *     the matchup detail computes; MatchupDetail.jsx surfaces it as
 *     "Projected N.N" while a game is live, and this card shows it as the
 *     pre-kickoff projection).
 *
 *     The list carries null on either side for more than one reason
 *     (expectedFinal.service.js, and see server/routes/league.router.js:664-668
 *     for the same enumeration from the route's side): a final matchup (the
 *     score is the result, nothing is projected), a best-ball league whose week
 *     has no projection run yet (best ball IS projected once a run has priced
 *     the week - #730 - but the producer marks its status unreliable until then
 *     rather than choosing a lineup, so it reads null in the meantime), no
 *     league context for the read, or a team with no starter rows yet for the
 *     week ("a list GET must not write a dozen teams' rows" - the early-week
 *     case: a team created mid-week, or a league whose week has never
 *     advanced) - plus a failed read, which is best-effort and also leaves
 *     nulls rather than erroring the list. The detail route calls
 *     materializeLineup for both teams inside its own transaction, so for the
 *     no-starter-rows case it returns a real number where the list could not;
 *     that is the fallback's justification for that one cause, and it is why
 *     the two are not interchangeable even though they name the same field.
 *
 *     A best-ball league is the one cause the fallback cannot help with:
 *     the matchup detail route computes its totals through the very same
 *     producer, `expectedFinalsForWeek` (expectedFinal.service.js), and best
 *     ball sets no manager-chosen lineup (it optimises one only once a run has
 *     priced the week), so the detail route's lineup materialization - the very
 *     thing that rescues the standard no-starter-rows case above - buys nothing
 *     here. When the list reads null for a best-ball league (no priced
 *     projection run yet), the detail read, running that same producer over the
 *     same absent run, reads null too; firing it only pays for
 *     a transaction that materializes both lineups and a `liveWhatIf` for the
 *     same null on the one field (`expectedFinal`) this widget reads. (The
 *     detail response also carries starters, bench and `viewerWhatIf`, which
 *     this widget never reads; only `expectedFinal` is at stake here.) The
 *     widget skips the fallback for that case (#688):
 *     the best-ball decision is made the same place and the same way as the
 *     `listHasBothFinals` check below, before `detail.status` is ever
 *     consulted.
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

// Both reads below use the shared useEndpoint (src/shared/lib, #669) and ignore
// its `httpStatus` field deliberately: this widget degrades a failed read to a
// compact error or a placeholder without distinguishing the status code. What
// this widget DOES rely on is the shared hook's null-URL contract: a null url
// never fetches and parks the state on `status: 'loading'` forever. That is
// load-bearing here (the chained detail read below is deliberately gated behind
// a null url on the happy path, and the card short-circuits on its own signal
// BEFORE reading `detail.status`), so the "idles at 'loading'" notes throughout
// this hook refer to that shared contract. See src/shared/lib/useEndpoint.js.

export function useMatchupPreview(leagueId) {
  const { teams, viewerTeamId, league } = useLeague(leagueId);
  const week = league?.current_week ?? null;

  // Read 1 (the spine): the week's matchups. Null until we know the league and
  // the current week, so a league with no current week never fires it.
  const listUrl =
    leagueId != null && week != null ? `/api/league/${leagueId}/matchups?week=${week}` : null;
  const list = useEndpoint(listUrl);

  // Pick the viewer's matchup by Team id (#112). The list is a bare array of the
  // wire's snake_case rows; each is read as the one Matchup shape (entities/
  // matchup) so this widget never names a database column again (#864).
  const rows = Array.isArray(list.data) ? list.data.map(matchupFromListRow) : [];
  const myMatchup =
    viewerTeamId != null
      ? rows.find(
          (m) => m && (m.home.teamId === viewerTeamId || m.away.teamId === viewerTeamId)
        ) || null
      : null;
  const matchupId = myMatchup ? myMatchup.id : null;
  const opponentId = myMatchup
    ? myMatchup.home.teamId === viewerTeamId
      ? myMatchup.away.teamId
      : myMatchup.home.teamId
    : null;

  // #670: does the list row already answer BOTH sides? A null check, not a
  // truthiness check, so a legitimate 0 counts as present. `!= null` excludes
  // both null and undefined (the field's absence on older/other fixtures)
  // without excluding 0 or any other falsy number.
  const listHasBothFinals =
    myMatchup != null &&
    myMatchup.home.expectedFinal != null &&
    myMatchup.away.expectedFinal != null;

  // #688: a best-ball league's detail read can never answer either (same
  // producer, same short-circuit as the list, see the docblock above), so the
  // fallback is skipped outright. Treat a missing flag as false, so a fixture
  // that predates this field keeps its current behavior.
  const isBestBall = !!league?.best_ball;

  // Whether the detail read stands any chance of answering: the list didn't
  // already answer both sides, AND the league isn't best-ball (#688, where
  // neither read ever answers). Named once and reused below (detailUrl,
  // busy) instead of repeating the same two-part check, so the gate stays a
  // single source of truth as more callers of it get added.
  const detailCanAnswer = !listHasBothFinals && !isBestBall;

  // Read 2 (chained fallback): the matchup detail, only once a matchup id
  // exists AND `detailCanAnswer`. This decision is made here, before
  // detail.status is ever consulted (the shared useEndpoint's null-url
  // contract, noted above): a null detailUrl idles at 'loading' forever, so
  // treating that idle status as "still loading" once the list has already
  // answered (or the league is best-ball, where no read will ever answer)
  // would skeleton the card and hold aria-busy forever instead of rendering
  // the list's numbers.
  const detailUrl =
    leagueId != null && matchupId != null && detailCanAnswer
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

  // Each side's projected total, to one decimal. Prefers the list's own value
  // (#670) when the list already answered both sides; otherwise falls back to
  // the chained detail read, loading while that read is in flight (the number
  // is skeletoned, holding layout), null (a placeholder) on a miss or a failed
  // detail read. `listHasBothFinals` is checked FIRST, before detail.status is
  // ever consulted: once the list has answered, detailUrl is null and
  // detail.status idles at 'loading' forever, so consulting it here would
  // skeleton this number forever instead of rendering the list's value (the
  // shared useEndpoint's null-url contract, noted above). `isBestBall` is
  // checked next, for the same reason (#688): detailUrl is null there too, so
  // reaching detail.status would skeleton the number forever instead of
  // resolving straight to the placeholder.
  // The chained detail read, read as the one Matchup shape too (#864), so the
  // fallback names `expectedFinal` on a per-side object and never the detail
  // body's raw fields. Built only when the read is ready.
  const detailModel =
    detail.status === 'ready' && detail.data ? matchupFromDetailBody(detail.data) : null;
  const projectedFor = (teamId) => {
    if (listHasBothFinals) {
      const raw =
        myMatchup.home.teamId === teamId
          ? Number(myMatchup.home.expectedFinal)
          : Number(myMatchup.away.expectedFinal);
      return { loading: false, value: Number.isFinite(raw) ? raw.toFixed(1) : null };
    }
    if (isBestBall) return { loading: false, value: null };
    if (detail.status === 'loading') return { loading: true, value: null };
    const sides = detailModel ? [detailModel.home, detailModel.away] : [];
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

  // aria-busy while a layout-holding read is in flight: the list spine, and
  // (only when `detailCanAnswer`, #670 + #688) the chained detail read whose
  // projected numbers are skeletoned (carry-over #2). Checking
  // `detailCanAnswer` before `detail.status` matters: with the fallback
  // skipped, detailUrl is null and detail.status idles at 'loading' forever,
  // so consulting it unconditionally here would keep aria-busy true forever.
  const busy =
    status === 'loading' || (status === 'ready' && detailCanAnswer && detail.status === 'loading');

  return { week, status, busy, matchupId, viewer, opponent };
}

export default useMatchupPreview;
