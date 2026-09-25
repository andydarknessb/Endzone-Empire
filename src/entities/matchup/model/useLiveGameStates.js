import { useEffect, useMemo, useState } from 'react';
import supabase from '../../../api/supabaseClient';

const LIVE_GAMES_TABLE = 'live_game_states';
const READ_STATUSES = new Set(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

function gamesInOrder(ids, byId) {
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/**
 * Subscribes to, then reads, the live NFL games represented by a page's
 * matchup list. The channel is joined first (filtered on every listed id, for
 * every event, of which INSERT and UPDATE are applied and DELETE is ignored) and
 * the snapshot is read once it is SUBSCRIBED, then merged
 * by game id with channel-delivered entries winning. No change between the read
 * and the join is lost, and a scheduled game's first row is received.
 */
export function useLiveGameStates(scopeId, gameIds) {
  const [byId, setById] = useState(() => new Map());
  const idsKey = useMemo(
    () => Array.from(new Set((gameIds || []).map(String).filter(Boolean))).join(','),
    [gameIds]
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    setById(new Map());
    if (!supabase || ids.length === 0) return undefined;

    let cancelled = false;
    let readStarted = false;
    let channel = null;
    const close = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
    const closeIfAllFinal = (next) => {
      const listed = gamesInOrder(ids, next);
      if (listed.length === ids.length && listed.every((row) => row.game_status === 'final')) close();
    };

    const read = async () => {
      const { data, error } = await supabase
        .from(LIVE_GAMES_TABLE)
        .select('*')
        .in('tank01_game_id', ids);
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        console.warn('useLiveGameStates: live game states unavailable', error);
        return;
      }
      setById((prev) => {
        const next = new Map(prev);
        data.forEach((row) => {
          const key = String(row.tank01_game_id);
          if (!next.has(key)) next.set(key, row);
        });
        closeIfAllFinal(next);
        return next;
      });
    };

    channel = supabase
      .channel(`live-games-${scopeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: LIVE_GAMES_TABLE,
          filter: `tank01_game_id=in.(${ids.join(',')})`,
        },
        (payload) => {
          // supabase-js v2 DELETE payloads carry `new: {}` (truthy), so test the id.
          if (cancelled || !payload || payload.eventType === 'DELETE' || payload.new?.tank01_game_id == null) return;
          setById((prev) => {
            const next = new Map(prev);
            next.set(String(payload.new.tank01_game_id), payload.new);
            closeIfAllFinal(next);
            return next;
          });
        }
      )
      .subscribe((status) => {
        // Read only once joined; any other terminal status degrades to the snapshot.
        if (cancelled || readStarted || !READ_STATUSES.has(status)) return;
        readStarted = true;
        read();
      });

    return () => {
      cancelled = true;
      close();
    };
  }, [scopeId, idsKey]);

  return useMemo(
    () => gamesInOrder(idsKey ? idsKey.split(',') : [], byId),
    [idsKey, byId]
  );
}

export default useLiveGameStates;
