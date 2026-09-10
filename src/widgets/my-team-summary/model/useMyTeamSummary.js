import { useEndpoint } from '../../../shared/lib';
import { useLeague } from '../../../hooks/useLeague';
import { useLeagueStandings, findTeamStanding } from '../../../entities/standings';
import { useTeamLineup } from '../../../entities/roster';
import { isPickemOnly } from '../../../lib/leagueType';
import { lineupAttention } from '../../../lib/lineupAttention';
import { DEFAULT_ROSTER_SLOTS } from '../../../lib/draftSim/templates';
import { ordinal } from '../lib/ordinal';

/**
 * Data model for the my-team summary widget (League Dashboard hero-left,
 * ticket #639, extended by #1101's starters section). The widget owns its own
 * reads; this hook is where they live so the UI stays a thin presenter.
 *
 * Five sources, each answering "which of these is me" by Team id against the
 * viewer's own team id (`viewerTeamId`), never an account identifier (#112,
 * CONTEXT.md team identity):
 *
 *   - Team identity comes from the shared league cache (useLeague / ADR 0004):
 *     the Team in `teams[]` whose id equals `viewerTeamId`. A repeat read here
 *     is served from the same cache the page shell already warmed, so it costs
 *     no extra request.
 *   - Record and current rank come from the STANDINGS ENTITY
 *     (src/entities/standings, #959), which owns the read and computes the
 *     Record once, so this card cannot disagree with the standings table or a
 *     matchup card about it. That read is the widget's SPINE: its loading state drives the card's
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
 *   - The starters section reads the ROSTER ENTITY's lineup
 *     (src/entities/roster, `useTeamLineup`, #1101), keyed by the league's
 *     current week exactly like standings above. It is a plain read (this
 *     widget is its only mount on this page) and is skipped entirely for a
 *     pick'em-only viewer, who has no roster to read: `useTeamLineup`'s own
 *     null-leagueId contract means the request never fires. The section is
 *     independent of the card's SPINE (standings): a slow or failed lineup
 *     read never blocks or errors the tiles above it, and a slow standings
 *     read never blocks the starters section either.
 */

// Both plain reads below use the shared useEndpoint (src/shared/lib, #669) and
// ignore its `httpStatus` field deliberately: every failure is one 'error'
// state here, because the widget degrades the same way whether a read 404s or
// 500s (a missing grade is a placeholder either way, a missing projection an
// absent tile either way). Dropping the status is a decision, not an oversight,
// so a later reader should not wire it in expecting it to matter.

const findById = (rows, teamId) =>
  (Array.isArray(rows) ? rows.find((row) => row && row.teamId === teamId) : null) || null;

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

// The starters section (#1101) shows this many rows before folding the rest
// into the "and N more" note.
const STARTERS_SHOWN = 5;

/**
 * The league's starting-slot config, parsed defensively (`roster_slots` rides
 * on the league row as jsonb - server/routes/league.router.js - so it
 * normally arrives already parsed; a string is tolerated the same way the
 * quick-actions widget's own `rosterSlotsOf` tolerates one, useQuickActions.js),
 * then resolved exactly the way `server/services/decision.service.js:141`
 * resolves the identical absent-config case: `rosterSlots && length > 0 ?
 * rosterSlots : DEFAULT_ROSTER_SLOTS`, never an empty array.
 *
 * This matters beyond a friendlier guess: `totalSlots` is this array's summed
 * `count`, and it is the footer's DENOMINATOR ("Lineup set/incomplete ·
 * <filled> of <this>"). An empty-array default would make `totalSlots` 0, and
 * since "set" is `filled >= totalSlots`, ANY filled count - including a
 * missing-config league nobody has actually set up - clears `9 >= 0` and
 * paints the reassuring "Lineup set" claim with its check mark. A degraded
 * default must never land on the reassuring end of a claim (#1101 formal
 * review, f2), so this falls back to the real 9-slot standard shape instead.
 */
function resolvedRosterSlots(league) {
  const raw = league?.roster_slots;
  let slots;
  if (Array.isArray(raw)) {
    slots = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      slots = Array.isArray(parsed) ? parsed : [];
    } catch {
      slots = [];
    }
  } else {
    slots = [];
  }
  return slots.length > 0 ? slots : DEFAULT_ROSTER_SLOTS;
}

export function useMyTeamSummary(leagueId) {
  const { league, teams, viewerTeamId } = useLeague(leagueId);

  // Standings through the entity, which reads the same shared week-keyed cache
  // entry, so the standings-table widget beside this one still issues one
  // request between them (ADR 0004). The week is the caller's to supply (#942
  // ruling R4: no League entity slice), and `status` is the same three spine
  // states the card reads.
  const { status: standingsStatus, rows: standingRows } = useLeagueStandings(
    leagueId,
    league?.current_week,
  );

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
    // The Record arrives FORMATTED from the entity and the rank is the server's
    // own, both off one Team standing; nothing here re-derives either.
    const standing = findTeamStanding(standingRows, viewerTeamId);
    if (standing && standing.gamesPlayed > 0) {
      const rank = ordinal(standing.rank);
      record = { text: standing.record, rankText: rank ? rank.toString() : null };
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

  // Starters section (#1101): the first five starters from entities/roster,
  // an "and N more · M questionable" note, and a lineup-completeness footer.
  // A pick'em-only viewer has no roster at all, so the lineup read never fires
  // for one (`useTeamLineup`'s null-leagueId contract) and the section never
  // mounts. `lineup.starters` already excludes bench, IR and spent rows
  // (lineupModel, CONTEXT.md's Lineup entry: a spent slot starts nobody
  // today), so this never re-derives the starter set with its own filter -
  // that is the tested red-tell (a re-derived filter is how the spent-slot
  // rule gets lost).
  const pickemOnly = isPickemOnly(league);
  const { lineup, loading: lineupLoading } = useTeamLineup(
    !pickemOnly && leagueId != null ? leagueId : null,
    league?.current_week ?? null,
  );

  let starters = null;
  if (!pickemOnly) {
    if (lineupLoading) {
      // The week is often already known (the league row landed before the
      // lineup read settles), so the loading header can still read "Starters
      // · Week N" instead of a bare "Starters".
      starters = { status: 'loading', week: league?.current_week ?? null };
    } else if (lineup) {
      const rosterSlots = resolvedRosterSlots(league);
      const totalSlots = rosterSlots.reduce((sum, s) => sum + (Number(s?.count) || 0), 0);
      // "Is this starting slot filled" is shared with the quick-actions widget
      // (src/lib/lineupAttention.js) rather than answered a second way here:
      // that module's own docblock names two independently-derived answers to
      // exactly this question as the failure the extraction exists to prevent
      // (#1101 formal review, f1). Fed `lineup.entries`, not `lineup.starters`:
      // a spent row keeps its ORIGINAL starting slot as its `slot` key
      // (spentStartingSlots), and CONTEXT.md's Lineup entry rule is that a
      // spent slot is settled for the week and "no save ... may seat a
      // replacement beside it" - so it must count as FILLED here, the same
      // way `lineupModel` excludes it from `starters` without treating the
      // exclusion as a hole to fill. (`lineup.starters` alone would undercount
      // by one for every spent slot, which is exactly the false "Lineup
      // incomplete" this rule exists to stop.)
      //
      // Known gap, left as a comment rather than fixed silently: quick-actions
      // reads a DIFFERENT wire for this same rule, `/api/team/roster`, whose
      // query joins from `team_players` and so drops a departed starter's row
      // entirely once he leaves the roster - unlike `/api/team/lineup`, which
      // deliberately keeps the spent record (lineup.service.js's
      // `spentStartingSlots`). The two widgets can still disagree on a spent
      // slot because they read different inputs, even though they now share
      // the same rule. Reconciling the data source is a quick-actions change
      // and is out of this ticket's scope.
      const { emptyStarterSlots } = lineupAttention({
        rosterSlots,
        entries: lineup.entries.map((e) => ({ slot: e.slot })),
      });
      starters = {
        status: 'ready',
        week: league?.current_week ?? null,
        rows: lineup.starters.slice(0, STARTERS_SHOWN),
        moreCount: Math.max(0, lineup.starters.length - STARTERS_SHOWN),
        // The single source of the questionable count: lineupModel computes
        // it once off the starters (CONTEXT.md's "computed in ONE place"
        // pattern), so this note never invents its own answer.
        questionableCount: lineup.questionable,
        filled: Math.max(0, totalSlots - emptyStarterSlots),
        totalSlots,
        lineupHref: leagueId != null ? `/league/${leagueId}/lineup` : null,
      };
    }
    // A failed read (or one that resolved with no lineup at all) leaves
    // `starters` null: the section is simply absent, and the card's tiles
    // above are untouched since they come from an unrelated read.
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
    starters,
  };
}

export default useMyTeamSummary;
