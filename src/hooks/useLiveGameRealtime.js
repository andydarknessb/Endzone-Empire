import { useEffect, useRef, useState } from 'react';
import supabase from '../api/supabaseClient';

const TABLE = 'live_game_states';

/**
 * Subscribes to one real NFL game's live status/score/clock via Supabase
 * Realtime, keyed by Tank01's own game id (`tank01_game_id`, a string like
 * "20260914_DEN@KC") rather than this table's internal serial `id` — that's
 * the identifier every other caller (the box-score sync, the schedule) already
 * has on hand, so callers never need a separate lookup just to use this hook.
 */
export default function useLiveGameRealtime(gameId) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    function unsubscribe() {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    }

    function subscribe() {
      if (!supabase || channelRef.current) return;
      channelRef.current = supabase
        .channel(`live-game-${gameId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: TABLE,
            filter: `tank01_game_id=eq.${gameId}`,
          },
          (payload) => {
            if (cancelled) return;
            setState(payload.new);
            if (payload.new.game_status === 'final') unsubscribe();
          }
        )
        .subscribe();
    }

    async function fetchInitial() {
      if (!supabase || !gameId) {
        setLoading(false);
        return;
      }
      const { data, error: fetchError } = await supabase
        .from(TABLE)
        .select('*')
        .eq('tank01_game_id', gameId)
        .maybeSingle();
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      setState(data);
      setLoading(false);
      if (data && data.game_status === 'in_progress') subscribe();
    }

    fetchInitial();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [gameId]);

  return { state, loading, error };
}
