import { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/apiClient';

const CACHE_TTL_MS = 60000;

// Module-level cache shared by every useLeague() mount — same plain-module-
// state precedent as PlayerQuickView's `lastView`: no redux, no new deps.
// Keyed by leagueId (coerced to a string so a route-param string and a
// numeric id for the same league share one entry). A pending fetch is
// stored as `promise` so concurrent mounts await the same request instead of
// each firing their own; once it resolves, `data`/`fetchedAt` serve
// same-league mounts within CACHE_TTL_MS without a network round-trip.
const cache = new Map();

function keyFor(leagueId) {
  return String(leagueId);
}

function fetchLeague(key, leagueId) {
  const promise = apiClient.get(`/api/league/${leagueId}`).then((res) => res.data.league);
  cache.set(key, { data: cache.get(key)?.data, promise, fetchedAt: null });
  promise.then(
    (data) => cache.set(key, { data, promise: null, fetchedAt: Date.now() }),
    () => cache.delete(key)
  );
  return promise;
}

function isFresh(entry) {
  return !!(entry && entry.fetchedAt != null && Date.now() - entry.fetchedAt < CACHE_TTL_MS);
}

/** Clears the shared league cache for one league, or every league when called with no id. */
export function clearLeagueCache(leagueId) {
  if (leagueId == null) {
    cache.clear();
  } else {
    cache.delete(keyFor(leagueId));
  }
}

/**
 * Shared GET /api/league/:id. Every league subpage wants the same league
 * row, so this dedupes concurrent requests and serves repeat mounts from
 * cache within CACHE_TTL_MS instead of each screen re-fetching it.
 */
export function useLeague(leagueId) {
  const key = leagueId != null ? keyFor(leagueId) : null;
  const cached = key ? cache.get(key) : null;

  const [league, setLeague] = useState(cached?.data ?? null);
  const [loading, setLoading] = useState(!isFresh(cached));
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (key == null) return Promise.resolve();
    setLoading(true);
    setError(null);
    const existing = cache.get(key);
    const promise = existing?.promise || fetchLeague(key, leagueId);
    return promise
      .then((data) => setLeague(data))
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, leagueId]);

  useEffect(() => {
    if (key == null) return;
    const entry = cache.get(key);
    if (isFresh(entry)) {
      setLeague(entry.data);
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refetch = useCallback(() => {
    if (key == null) return Promise.resolve();
    clearLeagueCache(leagueId);
    return load();
  }, [key, leagueId, load]);

  return { league, loading, error, refetch };
}
