import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../../api/apiClient';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

/** Owns the caller's draft queue: load, reorder, remove, and persisting each
 * change back to the server (optimistic, rolled back via a refetch on error).
 *
 * `loading` covers only the very first fetch, exactly like usePlayerPool's -
 * it is what the room ORs into its own page-skeleton `loading` (issue #216),
 * so it must never toggle again afterward. The resync fetch persistQueue
 * runs after a failed write is a background refetch instead: it sets
 * `isRefetching`, which nothing that gates the skeleton reads. */
export default function useDraftQueue(leagueId, { onError } = {}) {
  const notify = useSnackbar();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  // The last failed PUT, surfaced inline in the queue panel rather than the
  // room-wide error banner (issue #216) - cleared as soon as another write
  // is attempted.
  const [writeError, setWriteError] = useState(null);
  const hasLoadedOnceRef = useRef(false);

  const fetchQueue = useCallback(async () => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    if (!isFirstLoad) setIsRefetching(true);
    try {
      const res = await apiClient.get('/api/draft/queue', { params: { leagueId: Number(leagueId) } });
      setQueue(Array.isArray(res.data) ? res.data : []);
      // The only caller of a non-first fetchQueue is the write-failure resync
      // below, so a successful one means the queue is now confirmed in sync
      // with the server - any writeError it was showing is stale.
      if (!isFirstLoad) setWriteError(null);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message);
    } finally {
      if (isFirstLoad) {
        hasLoadedOnceRef.current = true;
        setLoading(false);
      } else {
        setIsRefetching(false);
      }
    }
  }, [leagueId, onError]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const persistQueue = async (nextQueue) => {
    setQueue(nextQueue);
    setWriteError(null);
    try {
      await apiClient.put('/api/draft/queue', {
        leagueId: Number(leagueId),
        playerIds: nextQueue.map((p) => p.id),
      });
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setWriteError(message);
      // Also the room-wide banner, same as every other error this hook
      // reports: the queue panel that would otherwise show `writeError`
      // isn't part of every draft-status composition (railComposition.js
      // drops it once the draft is complete), so this is the only surface
      // guaranteed to exist for every caller of persistQueue.
      onError?.(message);
      // Roll back the optimistic reorder from the server's own state. This is
      // a background refetch, not a first load - see fetchQueue above.
      fetchQueue();
    }
  };

  const handleQueuePlayer = (player) => {
    if (queue.some((p) => p.id === player.id)) return;
    persistQueue([...queue, player]);
    notify(`Queued ${player.name}`, { severity: 'info' });
  };

  const handleMoveUp = (index) => {
    if (index <= 0) return;
    const next = [...queue];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    persistQueue(next);
  };

  const handleMoveDown = (index) => {
    if (index >= queue.length - 1) return;
    const next = [...queue];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    persistQueue(next);
  };

  const handleRemoveFromQueue = (index) => {
    const removed = queue[index];
    const next = queue.filter((_, i) => i !== index);
    persistQueue(next);
    if (removed) notify(`Removed ${removed.name} from your queue`, { severity: 'info' });
  };

  return {
    queue,
    loading,
    isRefetching,
    writeError,
    handleQueuePlayer,
    handleMoveUp,
    handleMoveDown,
    handleRemoveFromQueue,
  };
}
