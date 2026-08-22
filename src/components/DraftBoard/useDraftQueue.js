import { useState, useEffect, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

/** Owns the caller's draft queue: load, reorder, remove, and persisting each
 * change back to the server (optimistic, rolled back via a refetch on error). */
export default function useDraftQueue(leagueId, { onError } = {}) {
  const notify = useSnackbar();
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/draft/queue', { params: { leagueId: Number(leagueId) } });
      setQueue(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [leagueId, onError]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const persistQueue = async (nextQueue) => {
    setQueue(nextQueue);
    try {
      await apiClient.put('/api/draft/queue', {
        leagueId: Number(leagueId),
        playerIds: nextQueue.map((p) => p.id),
      });
    } catch (err) {
      onError?.(err.response?.data?.error || err.message);
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

  return { queue, loading, handleQueuePlayer, handleMoveUp, handleMoveDown, handleRemoveFromQueue };
}
