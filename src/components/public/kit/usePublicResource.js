import { useState, useEffect, useCallback } from 'react';

/**
 * Minimal async-resource hook standardizing the loading / error / retry cycle
 * every public data view needs. `fetcher` returns a promise; `deps` re-runs it.
 * A `retry()` re-fetches (used by the ErrorState button). Guards against setting
 * state after unmount.
 */
export function usePublicResource(fetcher, deps = []) {
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false, data: null });
    Promise.resolve()
      .then(fetcher)
      .then((data) => alive && setState({ loading: false, error: false, data }))
      .catch(() => alive && setState({ loading: false, error: true, data: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, retry };
}

export default usePublicResource;
