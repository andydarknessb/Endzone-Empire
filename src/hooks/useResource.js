import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/apiClient';
import {
  invalidate,
  isFresh,
  load as loadResource,
  read,
  serializeKey,
  subscribe,
} from '../lib/resourceCache';

/**
 * Binds one mount to a cached GET (ADR 0004). `key` is an array such as
 * ['league', 7]; a null key never fetches. Returns { data, loading, error,
 * refetch }.
 *
 * The store handles what is shared between mounts (one entry per key, one
 * in-flight request, the generation guard). This hook handles what is per
 * mount: which key it is showing, which of its own loads is the newest, and
 * keeping data, error and loading consistent with them.
 */
export function useResource(key, url, { ttl } = {}) {
  const serialized = key == null ? null : serializeKey(key);
  const initial = serialized == null ? undefined : read(serialized);

  const [data, setData] = useState(initial?.data ?? null);
  const [loading, setLoading] = useState(serialized != null && !isFresh(initial, ttl));
  const [error, setError] = useState(null);

  // The key this mount is currently showing. A response for a key the hook has
  // since navigated away from must not land as the current one: the route
  // guards in front of the league pages read this data for their verdict, so a
  // stale row would gate the wrong league.
  const keyRef = useRef(serialized);
  keyRef.current = serialized;
  // Each load supersedes the one before it: a slower, older response (the
  // fetch that was in flight when an invalidation or a write-through arrived)
  // must not land over the newer one in this mount's state.
  const requestSeq = useRef(0);
  // The newest load this mount started, so refetch() can hand back a promise
  // that settles once the data is on screen.
  const promiseRef = useRef(null);
  // Read at request time rather than closed over, so a url that changes
  // without the key changing still hits the right endpoint.
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(() => {
    if (serialized == null) return Promise.resolve();
    const requestKey = serialized;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const stillCurrent = () => keyRef.current === requestKey && requestSeq.current === seq;
    setLoading(true);
    setError(null);
    const shared = loadResource(requestKey, () => apiClient.get(urlRef.current).then((res) => res.data));
    const promise = shared
      // data/error and loading settle in the same tick so a consumer sees one
      // render per outcome, not a trailing loading flip.
      .then((next) => { if (stillCurrent()) { setData(next); setLoading(false); } })
      .catch((err) => {
        if (stillCurrent()) {
          setError(err?.response?.data?.error || err?.message || 'Request failed');
          setLoading(false);
        }
      });
    promiseRef.current = promise;
    return promise;
  }, [serialized]);

  useEffect(() => {
    if (serialized == null) return;
    const entry = read(serialized);
    if (isFresh(entry, ttl)) {
      // A fresh entry answers the mount outright, and it clears an error left
      // over from the key this mount was showing before.
      requestSeq.current += 1;
      setData(entry.data);
      setError(null);
      setLoading(false);
      return;
    }
    // Switching keys: never keep serving the previous key's data while the new
    // one loads. A stale entry for the NEW key is still shown, as on first
    // mount, since it is at least the right resource.
    setData(entry?.data ?? null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  useEffect(() => {
    if (serialized == null) return undefined;
    return subscribe(serialized, (event) => {
      if (event.type === 'set') {
        // A write-through is a completed load that supersedes any pending one:
        // bump the sequence so a response still on the wire cannot land after.
        requestSeq.current += 1;
        setData(event.data);
        setError(null);
        setLoading(false);
        return;
      }
      // Stale-while-revalidate: the current data stays on screen until the
      // reload lands.
      load();
    });
  }, [serialized, load]);

  const refetch = useCallback(() => {
    if (serialized == null) return Promise.resolve();
    const seqBefore = requestSeq.current;
    // refetch means "at least as fresh as now": the key is invalidated, so a
    // response already on the wire is superseded rather than reused, and a
    // new request goes out. Invalidating rather than reloading directly is
    // what makes sibling mounts on the same key reload too, sharing the one
    // request this starts. (A clear immediately before a refetch is therefore
    // redundant: a second invalidation, and a second request.)
    invalidate(serialized, { reload: true });
    // The subscription above normally starts this mount's load. Before that
    // effect has run (a refetch during the first render pass) nothing did, so
    // start it here instead of issuing a second request.
    if (requestSeq.current !== seqBefore) return promiseRef.current || Promise.resolve();
    return load();
  }, [serialized, load]);

  return { data, loading, error, refetch };
}

export default useResource;
