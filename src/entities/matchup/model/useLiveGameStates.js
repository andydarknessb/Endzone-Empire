import { useEffect, useMemo, useState } from 'react';
import supabase from '../../../api/supabaseClient';

const LIVE_GAMES_TABLE = 'live_game_states';

function gamesInOrder(ids, byId) {
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/**
 * Reads and subscribes to the live NFL games represented by a page's matchup
 * list. One channel covers every listed game, including scheduled games, so a
 * page opened before kickoff receives the first live transition.
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
    let channel = null;
    const close = () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };

    const subscribe = (rows) => {
      const open = rows
        .filter((row) => row.game_status !== 'final')
        .map((row) => String(row.tank01_game_id));
      if (open.length === 0 || channel) return;
      channel = supabase
        .channel(`live-games-${scopeId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: LIVE_GAMES_TABLE,
            filter: `tank01_game_id=in.(${open.join(',')})`,
          },
          (payload) => {
            if (cancelled || !payload || !payload.new) return;
            setById((prev) => {
              const next = new Map(prev);
              next.set(String(payload.new.tank01_game_id), payload.new);
              const listed = gamesInOrder(ids, next);
              if (listed.length === ids.length && listed.every((row) => row.game_status === 'final')) close();
              return next;
            });
          }
        )
        .subscribe();
    };

    (async () => {
      const { data, error } = await supabase
        .from(LIVE_GAMES_TABLE)
        .select('*')
        .in('tank01_game_id', ids);
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        console.warn('useLiveGameStates: live game states unavailable', error);
        return;
      }
      setById(new Map(data.map((row) => [String(row.tank01_game_id), row])));
      subscribe(data);
    })();

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
