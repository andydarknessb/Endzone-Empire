import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/apiClient';

// Standings move only when picks are saved or games resolve, and the two
// screens that show them (the pick'em-only dashboard, then the Pick'em page's
// Standings tab one click later) are visited back to back: a short TTL turns
// three identical full-season recomputes per navigation into one. Same
// plain-module-state precedent as useLeague.
const CACHE_TTL_MS = 30000;

// Keyed by league + season (a request without a season lets the server pick
// the league's current one, so it is its own entry). A pending fetch is stored
// as `promise` so concurrent mounts share one request.
const cache = new Map();
// Bumped by clearPickemStandingsCache: a response that was already in flight
// when the cache was cleared (a save landing mid-fetch) must not repopulate
// the cache as fresh, so a fetch only stores its result if the generation it
// started under is still current. The mount that asked still gets its answer.
const generations = new Map();
const generationOf = (key) => generations.get(key) || 0;
// Mounted hooks, so an invalidation reaches a table that is on screen (the
// Standings tab while the commissioner changes the mode above it) instead of
// only the next mount.
const listeners = new Set();

function keyFor(leagueId, season) {
  return `${leagueId}|${season == null ? '' : season}`;
}

function urlFor(leagueId, season) {
  return `/api/pickem/league/${leagueId}/standings${season == null ? '' : `?season=${season}`}`;
}

function fetchStandings(key, leagueId, season) {
  const generation = generationOf(key);
  const promise = apiClient.get(urlFor(leagueId, season)).then((res) => res.data);
  cache.set(key, { data: cache.get(key)?.data, promise, fetchedAt: null });
  promise.then(
    (data) => {
      if (generationOf(key) === generation) cache.set(key, { data, promise: null, fetchedAt: Date.now() });
    },
    () => { if (generationOf(key) === generation) cache.delete(key); }
  );
  return promise;
}

function isFresh(entry) {
  return !!(entry && entry.fetchedAt != null && Date.now() - entry.fetchedAt < CACHE_TTL_MS);
}

/**
 * Drops cached standings for one league (every season), or everything when
 * called with no id. A picks save calls this so the Standings tab reflects
 * the new picks immediately instead of after the TTL.
 */
function drop(key) {
  cache.delete(key);
  generations.set(key, generationOf(key) + 1);
}

export function clearPickemStandingsCache(leagueId) {
  if (leagueId == null) {
    for (const key of Array.from(cache.keys())) drop(key);
  } else {
    const prefix = `${leagueId}|`;
    for (const key of Array.from(cache.keys())) {
      if (key.startsWith(prefix)) drop(key);
    }
  }
  listeners.forEach((listener) => listener(leagueId));
}

/**
 * Shared GET /api/pickem/league/:id/standings[?season=]. Dedupes concurrent
 * mounts and serves repeat mounts within CACHE_TTL_MS; the verdict for a
 * league the hook has moved away from never lands as the current one.
 */
export function usePickemStandings(leagueId, season) {
  const key = leagueId != null ? keyFor(leagueId, season) : null;
  const cached = key ? cache.get(key) : null;

  const [data, setData] = useState(cached?.data ?? null);
  const [loading, setLoading] = useState(!isFresh(cached));
  const [error, setError] = useState(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  // Each load supersedes the one before it: a slower, older response (e.g. the
  // fetch that was in flight when a save invalidated the cache) must not land
  // over the newer one in this mount's state.
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (key == null) return Promise.resolve();
    const requestKey = key;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const stillCurrent = () => keyRef.current === requestKey && requestSeq.current === seq;
    setLoading(true);
    setError(null);
    const existing = cache.get(key);
    const promise = existing?.promise || fetchStandings(key, leagueId, season);
    // data/error and loading settle in the same tick so a consumer sees one
    // render per outcome, not a trailing loading flip.
    return promise
      .then((next) => { if (stillCurrent()) { setData(next); setLoading(false); } })
      .catch((err) => {
        if (stillCurrent()) {
          setError(err?.response?.data?.error || err?.message || 'Request failed');
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (key == null) return;
    const entry = cache.get(key);
    if (isFresh(entry)) {
      setData(entry.data);
      setError(null);
      setLoading(false);
      return;
    }
    // A new league/season: never keep showing the previous entry's table.
    setData(entry?.data ?? null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Reload (keeping the current table on screen) when this league's entries
  // are invalidated while mounted.
  useEffect(() => {
    if (key == null) return undefined;
    const listener = (clearedLeagueId) => {
      if (clearedLeagueId == null || String(clearedLeagueId) === String(leagueId)) load();
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [key, leagueId, load]);

  const refetch = useCallback(() => {
    if (key == null) return Promise.resolve();
    drop(key);
    return load();
  }, [key, load]);

  return { data, loading, error, refetch };
}
