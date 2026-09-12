import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { readHttpFailure } from '../../../lib/httpFailure';
import { lineupEntries } from '../../../entities/roster';
import { parseRosterSlots } from '../../../shared/lib';

/**
 * The Lineup page's own mutable lineup state (#1237): a plain fetch of
 * `GET /api/team/lineup`, mapped through the Roster entity's `lineupEntries`
 * (ADR 0029) into the Ledger's per-entry shape. Kept as a page-level model
 * rather than the entity's read-only `useTeamLineup` hook because the
 * swap-players and drop-player features both need to patch this state
 * optimistically (a save that fails must roll back to exactly what was on
 * screen, and an offline save must apply locally with no request at all) -
 * `useTeamLineup` exposes no setter, being a plain read (its own docblock:
 * "no live feed, no socket: a lineup changes on a manager's own save").
 *
 * `raw`/`setRaw` are exposed alongside the built `lineup` because the
 * features mutate the WIRE shape (`entries[].id`/`.slot`) directly, the same
 * shape a snapshot-and-rollback needs; `lineup.entries` is rebuilt from `raw`
 * on every render via `lineupEntries`, so a feature's patch to `raw` is what
 * actually changes what the Ledger renders.
 */
export function useLineupData({ leagueId, week }) {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLineup = useCallback(async () => {
    if (leagueId == null) return;
    try {
      setLoading(true);
      setError(null);
      let url = `/api/team/lineup?leagueId=${leagueId}`;
      if (week != null) url += `&week=${week}`;
      const res = await apiClient.get(url);
      setRaw(res.data);
    } catch (err) {
      setError(readHttpFailure(err).message || err.message);
    } finally {
      setLoading(false);
    }
  }, [leagueId, week]);

  useEffect(() => {
    fetchLineup();
  }, [fetchLineup]);

  const rosterSlots = parseRosterSlots(raw?.rosterSlots);
  const entries =
    raw && rosterSlots.length > 0 ? lineupEntries(raw.entries, { roster_slots: rosterSlots }) : [];

  const lineup = raw
    ? {
        week: raw.week ?? null,
        season: raw.season ?? null,
        teamId: raw.teamId ?? null,
        currentWeek: raw.currentWeek ?? null,
        rosterSlots,
        benchSlots: raw.benchSlots ?? null,
        irSlots: raw.irSlots ?? null,
        entries,
      }
    : null;

  return { lineup, raw, setRaw, loading, error, refetch: fetchLineup };
}

export default useLineupData;
