import { useEffect, useRef, useState } from 'react';
import { subscribeToScoreFeed } from '../../../shared/lib';
import { playsFromScoreEvent } from '../../../entities/matchup';

/**
 * Live points via the existing scores socket (#1241, ADR 0037 ticket 9): the
 * same `scores:updated` feed Game Center and Matchup Detail already read
 * (`shared/lib`'s `subscribeToScoreFeed`, `entities/matchup`'s
 * `playsFromScoreEvent`), subscribed to ONCE at the page level and handed to
 * both consumers that need it - the "value two widgets both need is passed
 * down by the page" rule `useLineupData`/`useAdvice` already follow.
 *
 * The per-player point deltas (`plays[].playerId`/`pointsDelta`) are applied
 * directly onto the page's own `raw` lineup state (the same wire shape
 * `useLineupData` fetched and the swap/drop features already patch), summed
 * per player the same way `useMatchup.js`'s own `applyStarterDeltas` does,
 * so the Ledger's points cell moves without a refetch. The whole event is
 * also returned as `scoreEvent`, the one extra thing the team-summary-strip
 * widget needs (its own model applies `entities/matchup`'s `applyScoreEvent`
 * to the Matchup it already reads) - handing the raw event down rather than
 * duplicating that application here keeps one entity fact in one place.
 *
 * A reconnect's resync drops the last score event (the strip's own model
 * re-derives purely from its next list read once `scoreEvent` is null again)
 * and refetches the lineup (dropping any optimistic per-player deltas in
 * favour of the authoritative body) - mirroring `useMatchup.js`'s own silent
 * resync.
 */
export function useLiveScores({ leagueId, setRaw, refetch }) {
  const [scoreEvent, setScoreEvent] = useState(null);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (leagueId == null) return undefined;
    const unsubscribe = subscribeToScoreFeed(leagueId, {
      onScores: (event) => {
        setScoreEvent(event);
        const plays = playsFromScoreEvent(event);
        if (!plays.length) return;
        const deltaById = new Map();
        for (const p of plays) {
          if (p.playerId == null) continue;
          deltaById.set(p.playerId, (deltaById.get(p.playerId) || 0) + p.pointsDelta);
        }
        if (deltaById.size === 0) return;
        setRaw((prev) => {
          if (!prev || !Array.isArray(prev.entries)) return prev;
          let touched = false;
          const entries = prev.entries.map((e) => {
            const delta = deltaById.get(e.id);
            if (!delta) return e;
            touched = true;
            const base = Number(e.actualPoints) || 0;
            return { ...e, actualPoints: Math.round((base + delta) * 100) / 100 };
          });
          return touched ? { ...prev, entries } : prev;
        });
      },
      resync: () => {
        setScoreEvent(null);
        refetchRef.current?.();
      },
    });
    return unsubscribe;
  }, [leagueId, setRaw]);

  return { scoreEvent };
}

export default useLiveScores;
