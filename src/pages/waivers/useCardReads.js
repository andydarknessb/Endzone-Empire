import { useCallback, useRef, useState } from 'react';
import apiClient from '../../api/apiClient';

/**
 * The page's record of Decision-card reads (#1617), one attempt per player per
 * page view. The expanded row reads the same payload `usePlayerCard` does
 * (`GET /api/players/:id/card?leagueId=`) for its News, but the attempt lives
 * here rather than in the panel: a collapse mid-read must neither cancel the
 * read nor let the next expand send a second one, and a failed read stays
 * failed for the page view instead of retrying on every expand.
 *
 * `read(id)` returns `{ status: 'loading'|'ready'|'error', card }` and starts
 * the read the first time it is asked for a player; asking again returns the
 * stored attempt. It is called from an effect, never from render.
 *
 * BELOW-ISLAND EDGE (ADR 0031 amendment): `api/apiClient`, the plain HTTP
 * client, already this page's edge for the claim-target read.
 */
export function useCardReads(leagueId) {
  const attempts = useRef(new Map());
  const [, bump] = useState(0);

  const start = useCallback(
    (playerId) => {
      if (attempts.current.has(playerId)) return;
      attempts.current.set(playerId, { status: 'loading', card: null });
      apiClient
        .get(`/api/players/${playerId}/card?leagueId=${leagueId}`)
        .then((res) => attempts.current.set(playerId, { status: 'ready', card: res?.data ?? null }))
        .catch(() => attempts.current.set(playerId, { status: 'error', card: null }))
        .then(() => bump((n) => n + 1));
    },
    [leagueId],
  );

  const read = useCallback((playerId) => attempts.current.get(playerId) || null, []);
  return { start, read };
}

export default useCardReads;
