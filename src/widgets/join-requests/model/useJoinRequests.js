import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';

/**
 * Data model for the `join-requests` widget (console-only, #1109): the
 * commissioner-console card listing pending join requests. It reads the
 * shared league cache (useLeague / ADR 0004) - the same entry the console
 * page already warmed, so this costs no extra request - purely to derive its
 * own gate.
 *
 * `showJoinQueue` is the SAME three-clause expression `useCommissionerPanel`
 * gates the League Dashboard strip's copy of this queue on
 * (`league.is_commissioner && league.is_public && league.join_approval`): a
 * private league takes no join requests, and a public league that does not
 * screen joins admits them without ever queueing one. It is re-derived here
 * rather than shared, the way `useCommissionerPanel` re-derives its own copy
 * too - each surface that reads this queue owns its own gate.
 *
 * CommissionerTools' own GeneralSettingsPanel (CommissionerTools.jsx:562)
 * checks only two of these three clauses, `is_public && join_approval`, not
 * `useCommissionerPanel`'s three - correctly, not as a fourth copy drifting
 * from the other three: GeneralSettingsPanel is composed on a page (this one,
 * and the League Dashboard's commissioner strip) only after that page has
 * already confirmed the viewer is a commissioner, so `is_commissioner` would
 * be a redundant clause there. This HOOK is not in that position: it mounts
 * inside the very widget the page uses to decide what to show a commissioner
 * with, so it re-derives all three, the same reasoning `useCommissionerPanel`
 * gives for its own copy (a mount that cannot assume its caller already
 * checked).
 *
 * The join-requests read is NOT `shared/lib`'s `useEndpoint`: this widget
 * needs a real re-read after a decision (the ticket's own contract - "the
 * widget owns the count it shows, so a decision taken there is reflected here
 * on the next read"), and `useEndpoint` has no refetch of its own (it only
 * reloads when its URL changes). `version` is the local nonce that stands in
 * for one; bumping it is what `refetch` does, and the effect below re-runs
 * because it is in the dependency list even though the URL it builds never
 * changes.
 */
export function useJoinRequests(leagueId) {
  const { league } = useLeague(leagueId);

  const showJoinQueue = !!league?.is_commissioner && !!league?.is_public && !!league?.join_approval;

  const [status, setStatus] = useState('loading');
  const [rows, setRows] = useState([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!showJoinQueue || leagueId == null) {
      setStatus('idle');
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    apiClient
      .get(`/api/league/${leagueId}/join-requests`)
      .then((res) => {
        if (cancelled) return;
        setRows(Array.isArray(res.data) ? res.data : []);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, showJoinQueue, version]);

  // Invalidating and re-fetching, not a local splice of the decided row out of
  // `rows`: the decide-join-request feature that calls this owns the POST
  // only, and a locally-spliced list would drift from the server's own the
  // moment a second commissioner (or this same one, in another tab) decides
  // the same queue.
  const refetch = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  return { showJoinQueue, status, rows, refetch };
}

export default useJoinRequests;
