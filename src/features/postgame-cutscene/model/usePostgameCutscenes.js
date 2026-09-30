import { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { withoutStarted } from './sessionGuard';

/**
 * The Postgame cutscenes due for the viewer (ADR 0052): one
 * `GET /api/user/postgame-cutscenes` per mount of the surface that calls it,
 * which is Home and no other. Home starts it in the same effect pass as its own
 * reads, so it never waits on them, and a failure never reaches Home: a failed
 * or malformed response is an empty list and nothing renders.
 *
 * Matchups whose cutscene already started this browser session are filtered out
 * of the response (`sessionGuard`).
 *
 * @returns {{ cutscenes: object[] }} the due items in the server order
 */
export function usePostgameCutscenes() {
  const [cutscenes, setCutscenes] = useState([]);

  useEffect(() => {
    let cancelled = false;
    // Issued synchronously in the effect so it goes out beside Home's own reads;
    // the try covers a client that throws before it returns a promise.
    let request;
    try {
      request = Promise.resolve(apiClient.get('/api/user/postgame-cutscenes'));
    } catch {
      return undefined;
    }
    request
      .then((res) => {
        const list = res && res.data && Array.isArray(res.data.cutscenes) ? res.data.cutscenes : [];
        if (!cancelled) setCutscenes(withoutStarted(list));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return { cutscenes };
}

export default usePostgameCutscenes;
