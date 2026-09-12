import { useMemo, useState } from 'react';
import { standingsModel, usePickemStandings } from '../../../entities/pickem-standings';
import { heatStrip } from '../lib/heatBuckets';

/**
 * Data model for the pickem-standings widget (#1266, ADR 0038). The widget
 * owns this read the way my-team-summary and standings-table own theirs
 * (src/widgets/standings-table/model/useStandingsTable.js): this hook calls
 * the PICKEM STANDINGS ENTITY (`usePickemStandings`,
 * entities/pickem-standings) and shapes its response for the table. Nothing
 * here fetches on its own - the entity is the widget's only network edge
 * (AC1: "renders from the standings entity only; no fetch inside the
 * widget").
 *
 * Per-row derivation (`accuracy`, `bestWeek`, `trend`, tie marking) is the
 * entity's own `standingsModel`, read here and never recomputed - the scope
 * fence's ruling on AC1/AC2: use `accuracy`, `bestWeek` and `trend` as the
 * entity computes them, never re-derive them in the widget. This hook adds
 * only two things the entity does not model, because both are this widget's
 * own presentation judgment, not a domain fact the entity should carry:
 *
 *   - the viewer flag: row.teamId === the entity's own `viewerTeamId`
 *     (CONTEXT.md's Team-identity rule - "which of these is me" is answered
 *     by comparing Team ids, never an account id);
 *   - the weekly heat strip (`lib/heatBuckets.js`): which bucket a week's
 *     points falls into is a UI bucketing choice, not something the entity
 *     states.
 *
 * Season: the entity already accepts one (`usePickemStandings(leagueId,
 * season)`); this widget owns WHICH season is selected. `seasons` is the
 * list of choices a composing page can offer as the season switch (the page
 * is the one that knows a league's season history - out of this ticket's
 * scope, ADR 0038's page slice); the selected season is this widget's own
 * state, so switching it calls the SAME entity hook again with a different
 * season rather than opening a second read.
 */
export function usePickemStandingsTable(leagueId, { seasons } = {}) {
  const seasonOptions = Array.isArray(seasons) ? seasons : [];
  const [season, setSeason] = useState(() => (seasonOptions.length > 0 ? seasonOptions[0] : undefined));

  const { data, loading, error } = usePickemStandings(leagueId, season);

  const rows = useMemo(() => {
    const viewerTeamId = data?.viewerTeamId ?? null;
    return standingsModel(data?.standings).map((row) => ({
      ...row,
      isViewer: viewerTeamId != null && row.teamId === viewerTeamId,
      heat: heatStrip(row),
    }));
  }, [data]);

  // Rows arrive from the entity in standings order (points desc, CONTEXT.md's
  // Standings comparator), so the first row is the leader without a re-sort.
  const viewer = rows.find((row) => row.isViewer) || null;
  const leader = rows.length > 0 ? rows[0] : null;
  const behindLeader =
    viewer && leader && viewer.points != null && leader.points != null
      ? viewer.points - leader.points
      : null;

  // The widget's own "this week" reading: the highest week number present in
  // ANY row's `weekly` map. The entity's standings response carries no
  // current-week field of its own (server/routes/pickem.router.js's
  // /standings route computes `currentWeek` only to derive `previousRank`
  // and never returns it) - this is the one signal the standings entity
  // does carry that a shared slate week is derivable from, so it is a
  // widget-owned reading, not an entity fact. It under-reports by one week
  // in the rare case where nobody in the league has picked the newest week
  // yet (a week with zero picks writes no `weekly` entry for anybody,
  // pickem.service.js's `scorePickemWeek`).
  const currentWeek = rows.reduce((max, row) => {
    const weeks = Object.keys(row.weekly || {}).map(Number);
    const rowMax = weeks.length > 0 ? Math.max(...weeks) : 0;
    return Math.max(max, rowMax);
  }, 0) || null;

  return {
    status: error ? 'error' : loading ? 'loading' : 'ready',
    rows,
    teamCount: rows.length,
    season,
    seasons: seasonOptions,
    onSeasonChange: setSeason,
    mode: data?.mode ?? null,
    viewer,
    behindLeader,
    currentWeek,
  };
}

export default usePickemStandingsTable;
