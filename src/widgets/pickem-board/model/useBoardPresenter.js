import { useState } from 'react';
import { useLeague } from '../../../hooks/useLeague';
import { groupByKickoffWindow, usePickemWeek } from '../../../entities/pickem-game';
import { useSavePicks } from '../../../features/save-picks';
import gameCardView from './gameCardView';

// The NFL regular season's week count. `entities/pickem-game` has no
// season-length concept of its own (its `usePickemWeek` reads one week at a
// time), and this ticket's write set has no `pages/pickem` yet to own the
// season's week range either, so the week picker's own domain (which weeks
// exist to pick) is this widget's until a page composes it. A plain
// plumbing constant, the same shape as `kickoffWindow.js`'s own
// `SCHEDULE_ZONE`.
const REG_SEASON_WEEKS = 18;
const WEEKS = Array.from({ length: REG_SEASON_WEEKS }, (unused, index) => index + 1);

/**
 * pickem-board widget's own model (#1265, ADR 0038's SliceMap:
 * "model/useBoardPresenter.js - groups by kickoff window"). Composes:
 *
 *   - `useLeague` (the shared league resource every island widget already
 *     reads directly, matchup-preview's precedent) for the league's own
 *     team count - CONTEXT.md: "Teams rows ARE league membership", so its
 *     length is the "M" in "N of M managers have picked".
 *   - `entities/pickem-game`'s `usePickemWeek` for the week's own slate,
 *     picks and reveal, and `groupByKickoffWindow` for the board's five
 *     sections (never reimplemented here, ADR 0038).
 *   - `save-picks`'s `useSavePicks` for the manager's own in-progress draft,
 *     dirty tracking and the save itself.
 *   - `model/gameCardView` to turn each raw wire game into what GameCard
 *     renders, folding the draft and this game's reveal in per game.
 *
 * The week itself is state THIS hook owns (`pick-week`'s own docblock: "the
 * page keeps owning the week state" - here, until `pages/pickem` exists,
 * this widget is that page for the one thing it needs from it), seeded from
 * the league's `current_week` the first time it is known.
 */
export function useBoardPresenter(leagueId) {
  const { league, teams, loading: leagueLoading } = useLeague(leagueId);
  const totalManagers = leagueLoading ? null : teams.length;

  const [week, setWeek] = useState(null);
  const effectiveWeek = week ?? league?.current_week ?? null;

  const weekState = usePickemWeek(leagueId, effectiveWeek, { enabled: effectiveWeek != null });
  const data = weekState.data;
  const games = data?.games || [];
  const mode = data?.mode || 'straight';

  const savePicksApi = useSavePicks({
    myPicks: data?.myPicks,
    savePicks: weekState.savePicks,
    saving: weekState.saving,
    saveError: weekState.saveError,
    resetKey: effectiveWeek,
  });

  // Every game's own confidence, draft-aware, so ConfidenceMenu can refuse a
  // number already spent elsewhere on the SAME slate - the server's own rule
  // (CONTEXT.md, Confidence: "each number used at most once across the
  // week").
  const confidenceByGameKey = new Map();
  for (const game of games) {
    const draft = savePicksApi.draftFor(game.gameKey);
    if (draft?.confidence != null) confidenceByGameKey.set(game.gameKey, draft.confidence);
  }
  const confidenceUsedByFor = (gameKey) => {
    const used = [];
    for (const [key, value] of confidenceByGameKey) {
      if (key !== gameKey) used.push(value);
    }
    return used;
  };

  const views = games.map((game) =>
    gameCardView({
      game,
      myPicks: data?.myPicks,
      draftFor: savePicksApi.draftFor,
      othersPicksForWeek: data?.othersPicks,
      totalManagers,
      flagged: savePicksApi.flaggedGameKeys.has(game.gameKey),
    })
  );

  const windows = groupByKickoffWindow(views);

  const flaggedMessages = {};
  if (savePicksApi.saveError && Array.isArray(savePicksApi.saveError.gameKeys)) {
    for (const gameKey of savePicksApi.saveError.gameKeys) {
      flaggedMessages[gameKey] = savePicksApi.saveError.message;
    }
  }

  return {
    week: effectiveWeek,
    weeks: WEEKS,
    setWeek,
    mode,
    loading: weekState.loading,
    error: weekState.error,
    totalManagers,
    slateSize: views.length,
    pickedCount: views.filter((view) => view.myPick != null).length,
    windows,
    saving: savePicksApi.saving,
    isDirty: savePicksApi.isDirty,
    saveError: savePicksApi.saveError,
    flaggedMessages,
    confidenceUsedByFor,
    onPickWinner: savePicksApi.pickWinner,
    onSetConfidence: savePicksApi.setConfidence,
    onSave: savePicksApi.save,
  };
}

export default useBoardPresenter;
