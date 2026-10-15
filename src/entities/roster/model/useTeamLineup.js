import { useMemo } from 'react';
import { useResource } from '../../../hooks/useResource';
import { lineupModel } from './lineupModel';
import { buildLedgerSections } from './buildLedgerSections';

/**
 * The Ledger sections for a lineup-shaped object (`entries`, `rosterSlots`,
 * `benchSlots`, `irSlots`), memoised on the lineup's identity; null for no
 * lineup. `useTeamLineup` calls it on the read it owns; the Lineup page calls it
 * on its own optimistic lineup (`pages/lineup/model/useLineupData.js`), which
 * keeps that object referentially stable between changes.
 *
 * @param {object|null} lineup
 */
export function useLedgerSections(lineup) {
  return useMemo(() => (lineup ? buildLedgerSections(lineup) : null), [lineup]);
}

/**
 * A team's weekly Lineup as a read model (ADR 0029: the thin hook on the
 * entity's index, following the Matchup and Standings slices' shape). It reads
 * `GET /api/team/lineup?leagueId=<id>&week=<week>` through the shared
 * `useResource` cache (ADR 0004), mapped through `lineupModel` - no live feed,
 * no socket: a lineup changes on a manager's own save, never on someone else's
 * action.
 *
 * Cached because the League Dashboard mounts it twice (My Team's Starters and
 * Quick Actions' Set Lineup recommendation), and the two must answer "is a
 * starting slot empty" from ONE read, not two requests that could disagree.
 * No `ttl`, on purpose: the store dedupes only a request in flight, so the two
 * mounts that arrive together share one GET while a mount arriving after the
 * read settled reads again, and a lineup saved on the Lineup page is never
 * served stale on the way back. It meets ADR 0004's admission rule: the GET is
 * on the ADR 0059 read list (viewer-scoped like `/api/team/roster`, dropped on
 * every session change by `dropSessionCaches`) and is
 * read by more than one mount per typical navigation.
 *
 * A null `leagueId` or `week` binds no URL, so no request fires: the caller
 * is expected to withhold both until the league and week are known, exactly
 * as the Matchup entity's chained reads withhold their own URL (the shared
 * hook's null-key contract, src/hooks/useResource.js).
 *
 * `sections` is the Ledger's Starters / IR / Bench rows for that lineup, built once
 * and memoised here (`useLedgerSections`), so no page or widget rebuilds them.
 * It is null exactly when `lineup` is.
 *
 * `lineup` is null while a read is in flight or after one failed, even when a
 * previous response is still held (`useResource` keeps the last data through a
 * failed re-read), so a surface never paints the lineup it held before a save.
 *
 * @param {number|string|null} leagueId
 * @param {number|string|null} week
 * @returns {{ lineup: object|null, sections: {starters: object[], ir: object[], bench: object[]}|null, loading: boolean, error: boolean }}
 */
export function useTeamLineup(leagueId, week) {
  const active = leagueId != null && week != null;
  const { data, loading, error } = useResource(
    active ? ['team-lineup', leagueId, week] : null,
    active ? `/api/team/lineup?leagueId=${leagueId}&week=${week}` : null
  );

  const lineup = useMemo(
    () => (!loading && !error && data ? lineupModel(data) : null),
    [loading, error, data]
  );

  const sections = useLedgerSections(lineup);

  return { lineup, sections, loading: active && loading, error: error != null };
}

export default useTeamLineup;
