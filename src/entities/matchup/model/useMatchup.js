import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import apiClient from '../../../api/apiClient';
import supabase from '../../../api/supabaseClient';
import { subscribeToScoreFeed } from '../../../shared/lib';
import { subscribeToTeamProfileUpdates } from '../../../lib/teamProfileEvents';
import {
  matchupFromDetailBody, applyScoreEvent, applyIdentityPatch, pairStartersBySlot,
} from './matchupModel';

const LIVE_GAMES_TABLE = 'live_game_states';

/** The listed games in id order, from the id -> row map the subscription keeps. */
function gamesInOrder(ids, byId) {
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

/**
 * The live state of every NFL game a Matchup spans (its detail body's
 * `nflGameIds`, #884), through ONE realtime subscription instead of one channel
 * per game (#885): an initial read of every listed game's row, then one channel
 * filtered on the whole id set, opened only while a listed game is in progress
 * and closed once every listed game is final. A game already final at the
 * initial read is never subscribed to. Nothing else on the client reads
 * live_game_states (ADR 0009 keeps it the anon-readable surface; this is its
 * one reader). Returns the games' rows in id order; empty when there is no
 * client (realtime disabled), no ids, or the read failed.
 */
function useLiveGames(matchupId, gameIds) {
  const [byId, setById] = useState(() => new Map());
  // A stable key so a fresh but equal ids array never re-subscribes.
  const idsKey = (gameIds || []).map(String).join(',');

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

    // Open the one channel over the games not yet final, and keep it only
    // while one of them is in progress; every listed game final closes it.
    const subscribe = (rows) => {
      const open = rows.filter((r) => r.game_status !== 'final').map((r) => String(r.tank01_game_id));
      const anyLive = rows.some((r) => r.game_status === 'in_progress');
      if (!anyLive || open.length === 0 || channel) return;
      channel = supabase
        .channel(`live-games-${matchupId}`)
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
              if (listed.length === ids.length && listed.every((r) => r.game_status === 'final')) close();
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
      if (cancelled || error || !Array.isArray(data)) return;
      setById(new Map(data.map((r) => [String(r.tank01_game_id), r])));
      subscribe(data);
    })();

    return () => {
      cancelled = true;
      close();
    };
  }, [matchupId, idsKey]);

  return useMemo(() => gamesInOrder(idsKey ? idsKey.split(',') : [], byId), [idsKey, byId]);
}

/**
 * Applies the score event's per-play point deltas to a side's starters,
 * returning a new lineup only when a delta actually lands (so an unaffected side
 * keeps its identity and never re-renders). This is the optimistic per-starter
 * bump that tracks the live score without a full refetch; a resync (reconnect)
 * re-seeds the lineups from the authoritative body and drops these deltas.
 */
function applyStarterDeltas(lineup, deltaById) {
  if (!lineup || !lineup.starters) return lineup;
  let touched = false;
  const starters = lineup.starters.map((s) => {
    const d = deltaById.get(s.id);
    if (!d) return s;
    touched = true;
    return { ...s, points: Math.round(((Number(s.points) || 0) + d) * 100) / 100 };
  });
  return touched ? { ...lineup, starters } : lineup;
}

/**
 * A single Matchup as a read model (ADR 0029: the thin hook on the entity's
 * index, the sibling of `useLeagueMatchups`). It composes the same three
 * sources onto the one model, for ONE matchup instead of a league's list:
 *   - a plain fetch of the Matchup DETAIL body
 *     (`GET /api/league/:id/matchups/:matchupId`), mapped through
 *     `matchupFromDetailBody`. It is never the list read: a Matchup Detail
 *     surface reads exactly its own matchup, never the whole week (AC: no list
 *     fetch);
 *   - the live score feed (shared/lib), applied through `applyScoreEvent`, with
 *     a full refetch on the feed's `resync` (a reconnect drift-recovery); and
 *   - the Team identity feed (teamProfileEvents), applied through
 *     `applyIdentityPatch`, scoped to this league.
 *
 * The whole score event (including its `plays`) is handed to an optional
 * `onScores` callback so a reader can keep its own play-driven concerns -
 * Matchup Detail's cutscenes, toasts, ticker, retro field and its optimistic
 * per-starter point bumps - without a second socket. The callback is read
 * through a ref so passing a fresh one never re-subscribes the feed.
 *
 * The raw detail body is returned alongside the model as `detail`: it carries
 * what the model deliberately does not (the two lineups' benches, the viewer's
 * own Team id, the viewer what-if, the matchup's `is_playoff` flag, and the
 * `nflGameIds` the live-game strip mounts from, #884), which a
 * box-score surface still needs. The model is the one spelling of the scoreboard
 * (totals, status, `final`, Expected final, Players remaining); `detail` is the
 * lineup payload beneath it.
 *
 * The two lineups' STARTERS, however, arrive already paired: given the league's
 * `slotOrder` (its roster_slots keys), the hook returns `starterRows` - one row
 * per slot instance, home paired with away by slot key - so no render pairs
 * starters itself, and none can pair without the league's order (pairing refuses
 * an empty order and returns no rows, exactly as Matchup Detail waits on the
 * league for its bench line). The optimistic per-starter point bumps live here
 * too now, applied to the paired lineups on each score event, so the rows track
 * the live score without a refetch; the whole score event (including its `plays`)
 * is still handed to an optional `onScores` callback so a reader can keep its own
 * play-driven concerns - cutscenes, toasts, ticker, the retro field - without a
 * second socket. The callback is read through a ref so passing a fresh one never
 * re-subscribes the feed.
 *
 * @param {number|string} leagueId
 * @param {number|string} matchupId
 * @param {{ onScores?: (event: object) => void, slotOrder?: string[] }} [options]
 * @returns {{ matchup: object|null, detail: object|null, starterRows: object[], loading: boolean, error: string|null, refetch: () => void }}
 */
export function useMatchup(leagueId, matchupId, { onScores, slotOrder } = {}) {
  const [matchup, setMatchup] = useState(null);
  const [detail, setDetail] = useState(null);
  // The two lineups (starters/bench per side) as the hook's own live state,
  // seeded from each fetch of the detail body and bumped optimistically on the
  // score feed's plays. `starterRows` below pairs their starters by slot.
  const [home, setHome] = useState(null);
  const [away, setAway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const onScoresRef = useRef(onScores);
  onScoresRef.current = onScores;

  // `silent` separates the first load from a background refresh, exactly as the
  // league hook does: the first load drives `loading` (the page skeleton); a
  // resync (a reconnect refetch) must NOT, or every reconnect would blank the
  // live box score until the fetch resolves. A fetch also re-seeds the lineups
  // from the authoritative body, dropping any optimistic per-starter deltas in
  // favour of the real totals.
  const loadMatchup = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/matchups/${matchupId}`);
      setDetail(res.data);
      setMatchup(matchupFromDetailBody(res.data));
      setHome(res.data?.home ?? null);
      setAway(res.data?.away ?? null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leagueId, matchupId]);

  useEffect(() => {
    loadMatchup();
  }, [loadMatchup]);

  useEffect(() => {
    const unsubscribe = subscribeToScoreFeed(leagueId, {
      onScores: (event) => {
        const scored = (event && event.scored) || [];
        if (scored.length) {
          setMatchup((prev) => {
            if (!prev) return prev;
            const entry = scored.find((s) => s.matchupId === prev.id);
            return entry ? applyScoreEvent(prev, entry) : prev;
          });
        }
        // Optimistically bump the scoring players' displayed points by the
        // reported delta so the paired rows track the live score without a
        // refetch. Kept on the lineup state here (not the reader) so the rows the
        // hook exposes already carry the bump.
        const plays = (event && event.plays) || [];
        if (plays.length) {
          const deltaById = new Map();
          for (const p of plays) {
            deltaById.set(p.playerId, (deltaById.get(p.playerId) || 0) + (Number(p.pointsDelta) || 0));
          }
          setHome((prev) => applyStarterDeltas(prev, deltaById));
          setAway((prev) => applyStarterDeltas(prev, deltaById));
        }
        onScoresRef.current?.(event);
      },
      // A reconnect refetches to recover the deltas missed while offline, but
      // silently: the box score already on screen stays up.
      resync: () => loadMatchup({ silent: true }),
    });
    return unsubscribe;
  }, [leagueId, loadMatchup]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setMatchup((prev) => (prev ? applyIdentityPatch(prev, update) : prev));
  }), [leagueId]);

  // Starters arrive already paired (ADR 0029/0030): the hook owns the pairing so
  // no render does, and it refuses without the league's slot order - until the
  // order arrives `starterRows` is empty and the lineup views render nothing,
  // rather than pairing against a fantasy-standard default that mis-places IDP
  // starters.
  const starterRows = useMemo(
    () => pairStartersBySlot(home?.starters, away?.starters, slotOrder),
    [home, away, slotOrder]
  );

  // The NFL games this Matchup spans (the detail body's `nflGameIds`) and their
  // live state, on the model as `games` (#885). One subscription for all of
  // them; the page renders a strip per row and opens nothing itself.
  const games = useLiveGames(matchupId, detail?.nflGameIds);
  const model = useMemo(() => (matchup ? { ...matchup, games } : matchup), [matchup, games]);

  return { matchup: model, detail, starterRows, loading, error, refetch: loadMatchup };
}

export default useMatchup;
