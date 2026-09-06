import { useEndpoint } from '../../../shared/lib';
import { useLeague } from '../../../hooks/useLeague';
import { useStandings } from '../../../hooks/useStandings';
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
 *     summary never touches the rest of the page. Standings is a SHARED-cache
 *     read (useStandings / ADR 0004): it is on the service-worker allowlist and,
 *     since #641's standings-table landed on this same page, is read by more
 *     than one mount per navigation, so both admission conditions hold and the
 *     two readers dedupe onto one request. It is keyed by the league's current
 *     week, so a week advance is a fresh read for both.
 *   - Power-rankings stays a plain read here: it is on the allowlist too, but
 *     its only reader is this widget's projected-finish tile. It moves to
 *     useResource the moment a second mount on this page reads it, exactly as
 *     standings did.
 *   - Draft grade and roster value come from the league draft-grades read. When
 *     it 404s (grades not generated yet) both tiles degrade to a placeholder
 *     with no number, rather than erroring the card.
 *   - Projected finish, playoff odds and rank movement are all one plain read of
 *     the power-rankings endpoint (see the one-mount trigger above). It 404s
 *     until first computed; until then those tiles are simply absent, not
 *     placeholders.
 *   - The waiver/roster tile reads the league row and the viewer's own `teams[]`
 *     entry, both already in the league cache above, so it costs no request.
 */

// Both plain reads below use the shared useEndpoint (src/shared/lib, #669) and
// ignore its `httpStatus` field deliberately: every failure is one 'error'
// state here, because the widget degrades the same way whether a read 404s or
// 500s (a missing grade is a placeholder either way, a missing projection an
// absent tile either way). Dropping the status is a decision, not an oversight,
// so a later reader should not wire it in expecting it to matter.

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

// A finite number, or null when the field is absent. Every optional numeric
// below goes through this for the same reason `rawRosterValue` does: an absent
// column coerces to 0, and a 0 in one of these tiles ("0/100 FAAB", "held its
// place") reads as a fact rather than as a gap.
const numberOrNull = (raw) => {
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * The fourth tile's fact: the league's waiver currency when it runs FAAB, and
 * otherwise how full the roster is. Both pairs are already on the league-detail
 * payload (league.router.js: `leagues.*` carries waiver_type/faab_budget/
 * roster_limit, the teams[] select carries faab_remaining and a COUNTed
 * roster_count), so this is a reshape of cached data, not a read.
 *
 * Null when either half of the pair is missing, because "24 of nothing" is not
 * a fact worth a tile; the tile is then simply absent, the way the projection
 * tile is.
 */
function capacityFact(league, team) {
  if (!league || !team) return null;
  const [label, have, cap] =
    league.waiver_type === 'faab'
      ? ['FAAB left', numberOrNull(team.faab_remaining), numberOrNull(league.faab_budget)]
      : ['Roster', numberOrNull(team.roster_count), numberOrNull(league.roster_limit)];
  if (have == null || cap == null) return null;
  return { label, text: `${have}/${cap}` };
}

export function useMyTeamSummary(leagueId) {
  const { league, teams, viewerTeamId } = useLeague(leagueId);

  // Standings through the shared week-keyed cache, so the standings-table widget
  // beside this one issues one request between them (ADR 0004). `useResource`'s
  // { data, loading, error } maps to the same three spine states the card reads.
  const standings = useStandings(leagueId, league?.current_week);
  const standingsStatus = standings.loading ? 'loading' : standings.error ? 'error' : 'ready';

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
  if (standingsStatus === 'ready') {
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
  // Null is the server's "no projection for this Team yet" (week 1 of a
  // season); Number(null) is 0, which would print a 0 that looks like data.
  const rawRosterValue = gradeRow && gradeRow.rosterValue != null ? Number(gradeRow.rosterValue) : NaN;
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

  // Projected finish, its movement, and playoff odds: all absent until the
  // power-rankings run exists and carries a row for the viewer. 404 / error /
  // loading all render no tile.
  let proj = null;
  let playoffOdds = null;
  if (rankings.status === 'ready') {
    const row = findById(rankings.data?.data?.rankings, viewerTeamId);
    const rank = row ? ordinal(Number(row.rank)) : null;
    if (rank) {
      // `change` is prevRank - rank (montecarlo.service.js withRankChange), so
      // positive means the Team moved UP the table. It is null when there is no
      // prior stored run, and null must stay null all the way to the UI: 0 is a
      // real value here ("held its place"), so a coercion would turn the first
      // run of a season into every Team claiming it held.
      proj = { ordinal: rank, change: numberOrNull(row.change) };
    }
    // The simulation stores odds as a 0-1 fraction rounded to three places
    // (montecarlo.service.js runSimulation), so the percentage is made here and
    // nowhere else.
    const odds = row ? numberOrNull(row.playoffOdds) : null;
    if (odds != null) playoffOdds = { percent: Math.round(odds * 100) };
  }

  return {
    league,
    identity,
    // The card's spine: 'loading' -> skeletons, 'error' -> compact error.
    spine: standingsStatus,
    record,
    draftGrade,
    rosterValue,
    proj,
    playoffOdds,
    capacity: capacityFact(league, viewerTeam),
  };
}

export default useMyTeamSummary;
