import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../api/apiClient';
import {
  enqueuePendingLineupMutation,
  LINEUP_MUTATION_REPLAYED_EVENT,
  LINEUP_QUEUE_CHANGED_EVENT,
  PENDING_LINEUP_MUTATIONS_KEY,
  readPendingLineupMutations,
  replayPendingLineupMutations,
} from '../lib/pendingLineupMutations';

function browserIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function isConnectivityFailure(error) {
  return !error?.response || ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code);
}

function signalOffline() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('offline'));
}

export default function useResilientLineupMutation({ onReplaySuccess } = {}) {
  const [online, setOnline] = useState(browserIsOnline);
  const [pendingCount, setPendingCount] = useState(() => readPendingLineupMutations().length);
  const onlineRef = useRef(online);
  const replaySuccessRef = useRef(onReplaySuccess);
  replaySuccessRef.current = onReplaySuccess;

  useEffect(() => {
    const handleOffline = () => {
      onlineRef.current = false;
      setOnline(false);
    };
    const handleOnline = () => {
      onlineRef.current = true;
      setOnline(true);
      void replayPendingLineupMutations();
    };
    const handleQueueChanged = (event) => {
      setPendingCount(event.detail?.pendingCount ?? readPendingLineupMutations().length);
    };
    const handleStorage = (event) => {
      if (event.key !== PENDING_LINEUP_MUTATIONS_KEY) return;
      setPendingCount(readPendingLineupMutations().length);
      if (browserIsOnline() && event.newValue) void replayPendingLineupMutations();
    };
    const handleReplayed = (event) => replaySuccessRef.current?.(event.detail);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    window.addEventListener(LINEUP_QUEUE_CHANGED_EVENT, handleQueueChanged);
    window.addEventListener(LINEUP_MUTATION_REPLAYED_EVENT, handleReplayed);
    window.addEventListener('storage', handleStorage);
    if (browserIsOnline() && readPendingLineupMutations().length > 0) handleOnline();
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(LINEUP_QUEUE_CHANGED_EVENT, handleQueueChanged);
      window.removeEventListener(LINEUP_MUTATION_REPLAYED_EVENT, handleReplayed);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const saveLineup = useCallback(async (payload) => {
    const queue = () => {
      onlineRef.current = false;
      setOnline(false);
      signalOffline();
      const intent = enqueuePendingLineupMutation({
        endpoint: '/api/team/lineup',
        method: 'PUT',
        payload,
      });
      return { queued: true, intent };
    };

    if (!onlineRef.current || !browserIsOnline()) return queue();
    try {
      const response = await apiClient.put('/api/team/lineup', payload);
      return { queued: false, response };
    } catch (error) {
      if (isConnectivityFailure(error)) return queue();
      throw error;
    }
  }, []);

  return { online, pendingCount, saveLineup };
}
