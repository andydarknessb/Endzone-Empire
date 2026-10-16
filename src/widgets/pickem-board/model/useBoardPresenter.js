import { useCallback, useMemo, useState } from 'react';
import { useLeague } from '../../../hooks/useLeague';
import { groupByKickoffWindow, nextPickGame, usePickemWeek } from '../../../entities/pickem-game';
import { useSavePicks } from '../../../features/save-picks';
import { useNow } from '../../../shared/lib';
import gameCardView from './gameCardView';

// The NFL regular season's week count. `entities/pickem-game` has no
// season-length concept of its own (its `usePickemWeek` reads one week at a
// time), so the week picker's own domain (which weeks exist to pick) is this
// widget's. A plain plumbing constant, the same shape as `kickoffWindow.js`'s
// own `SCHEDULE_ZONE`.
const REG_SEASON_WEEKS = 18;
const WEEKS = Array.from({ length: REG_SEASON_WEEKS }, (unused, index) => index + 1);

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// The next instant a "Locks in n min" word on the board changes, so one timer repaints the board
// exactly when it must: an hour before the first kickoff, then at every whole minute.
function nextLockWordChange(games, now) {
  let next = null;
  for (const game of games) {
    if (game.locked) continue;
    const remaining = new Date(game.kickoffAt).getTime() - now;
    if (!(remaining > 0)) continue;
    const at = remaining >= HOUR_MS ? now + remaining - HOUR_MS + 1 : now + (remaining % MINUTE_MS) + 1;
    if (next == null || at < next) next = at;
  }
  return next;
}

/**
 * pickem-board widget's own model (ADR 0038 SliceMap: "model/useBoardPresenter.js - groups by
 * kickoff window"), on save-on-tap since ADR 0067 wave 2. Composes:
 *
 *   - `useLeague` (the shared league resource every island widget already reads directly) for the
 *     league's own team count: the "M" in "N of M managers have picked".
 *   - `entities/pickem-game`'s `usePickemWeek` for the week's slate, picks and reveal,
 *     `groupByKickoffWindow` for the five windows and `nextPickGame` for the cursor.
 *   - `save-picks`'s `useSavePicks` for the per-tap save, its words (Saving, Pick saved and Undo,
 *     Retry) and the confidence swap.
 *   - `model/gameCardView` to turn each wire game into what GameCard renders, with the clock that
 *     turns an open game under an hour out into "Locks in n min".
 *
 * The week itself is state THIS hook owns, seeded from the league's `current_week` the first time it
 * is known. `onSaved(result)` fires after every save that landed, so the page, which composes this
 * and `entities/pickem-standings`, can clear the standings cache a save made stale (sibling entities
 * do not import each other, ADR 0029).
 *
 * `status` is the one place the board says where the manager stands, in the Picks h2 row: how many
 * are picked, how many open games still lack a pick, and the kickoff of the cursor game ("next
 * lock"), the one the cursor and the next-lock link point at.
 */
export function useBoardPresenter(leagueId, { onSaved } = {}) {
  const { league, teams, loading: leagueLoading } = useLeague(leagueId);
  const totalManagers = leagueLoading ? null : teams.length;

  const [week, setWeek] = useState(null);
  const effectiveWeek = week ?? league?.current_week ?? null;

  const weekState = usePickemWeek(leagueId, effectiveWeek, { enabled: effectiveWeek != null });
  const data = weekState.data;
  const games = useMemo(() => data?.games || [], [data]);
  const mode = data?.mode || 'straight';
  const confidenceMode = mode === 'confidence';

  // usePickemWeek reads `loading: false` the instant it is disabled (no week known yet), which would
  // flash this board's empty state before the league's own `current_week` has arrived.
  const loading = effectiveWeek == null ? leagueLoading : weekState.loading;

  const now = useNow((current) => nextLockWordChange(games, current), data);

  const views = games.map((game) =>
    gameCardView({
      game,
      myPicks: data?.myPicks,
      othersPicksForWeek: data?.othersPicks,
      totalManagers,
      now,
    })
  );
  const windows = groupByKickoffWindow(views);
  const boardOrder = windows.flatMap((group) => group.games);
  const cursor = nextPickGame(boardOrder);

  const saveWeekPicks = weekState.savePicks;
  const savePicks = useCallback(
    async (picks) => {
      const result = await saveWeekPicks(picks);
      if (result?.ok && onSaved) onSaved(result);
      return result;
    },
    [saveWeekPicks, onSaved]
  );
  const saving = useSavePicks({
    mode,
    myPicks: data?.myPicks,
    views,
    savePicks,
    resetKey: effectiveWeek,
  });

  // Who holds each rank, so ConfidenceMenu can mark a rank "used by DAL @ DEN" (choosing it swaps) or
  // "locked" (the holder kicked off, so it cannot move), never this game's own rank.
  const holders = {};
  for (const view of views) {
    if (view.confidence != null) {
      holders[view.confidence] = {
        gameKey: view.gameKey,
        label: `${view.teams[0]} @ ${view.teams[1]}`,
        locked: view.lock,
      };
    }
  }
  const usedByFor = (gameKey) => {
    const used = {};
    for (const [rank, holder] of Object.entries(holders)) {
      if (holder.gameKey !== gameKey) used[rank] = { label: holder.label, locked: holder.locked };
    }
    return used;
  };
  const usedRanks = Object.keys(holders).map(Number).sort((a, b) => a - b);
  const lockedRanks = usedRanks.filter((rank) => holders[rank].locked);

  const pickedCount = views.filter((view) => view.myPick != null).length;
  const openCount = views.filter((view) => !view.lock && view.myPick == null).length;

  return {
    week: effectiveWeek,
    weeks: WEEKS,
    setWeek,
    mode,
    loading,
    error: weekState.error,
    reload: weekState.reload,
    totalManagers,
    slateSize: views.length,
    windows,
    cursorKey: cursor ? cursor.gameKey : null,
    cursorLockMinutes: cursor ? cursor.lockMinutes : null,
    status: {
      picked: pickedCount,
      total: views.length,
      open: openCount,
      nextLock: cursor ? cursor.kickoff : null,
    },
    confidence: confidenceMode ? { usedRanks, lockedRanks, left: views.length - usedRanks.length } : null,
    usedByFor,
    stateFor: saving.stateFor,
    onPickWinner: saving.pickWinner,
    onSetConfidence: saving.setConfidence,
    onUndo: saving.undo,
    onRetry: saving.retry,
  };
}

export default useBoardPresenter;
