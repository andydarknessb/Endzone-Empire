import { gameDetailModel, gameModel } from '../../../entities/pickem-game';
import revealTally from './revealTally';

/**
 * pickem-board widget (#1265, ADR 0038): the one game-card view model,
 * composing the two read-only entity models (`gameModel`'s slate,
 * `gameDetailModel`'s Line/Weather/Record/Venue/Broadcast/Situation/final
 * extras) with what neither entity carries - `pickedCount` (a raw wire
 * scalar the entity deliberately does not model, ADR 0038: "never a
 * pick's direction or owner"), the week's `othersPicks` reveal for this one
 * game, and the manager's own in-progress draft from the `save-picks`
 * feature - into what GameCard actually renders.
 *
 * `draftFor` is `save-picks`'s `useSavePicks().draftFor`: when it holds an
 * unsaved edit for this game, that edit is what the card shows as "my
 * pick", overriding the server's own `myPicks` row the entity's
 * `gameModel` already read. `othersPicksForWeek` is the week response's OWN
 * `othersPicks` map (never a per-game value, CONTEXT.md/ADR 0038); this is
 * the one place that map is indexed by gameKey, which is what keeps every
 * caller off the standing trap (revealTally.js's docblock): a lookup that
 * finds nothing is `undefined`, not `[]`, and only `revealTally` gets to
 * decide what that means.
 */
export function gameCardView({
  game,
  myPicks,
  draftFor,
  othersPicksForWeek,
  totalManagers = null,
  flagged = false,
}) {
  const slate = gameModel(game, myPicks);
  const detail = gameDetailModel(game);

  const draft = draftFor ? draftFor(slate.gameKey) : null;
  const myPick = draft ? draft.pickedTeam : slate.myPick;
  const confidence = draft ? draft.confidence : slate.confidence;

  const revealedForGame = othersPicksForWeek ? othersPicksForWeek[slate.gameKey] : undefined;
  const reveal = revealTally({ othersPicks: revealedForGame, myPick, totalManagers });

  // Outcome is only ever asked of a settled (phase 'final') game: a tied
  // game credits nobody (CONTEXT.md, Scoring mode), a game the manager never
  // picked is neither correct nor missed, and otherwise it is whichever the
  // server's own winner says.
  let outcome = null;
  if (slate.phase === 'final') {
    if (game.isTie) outcome = 'tie';
    else if (!myPick) outcome = 'no-pick';
    else outcome = game.winner === myPick ? 'correct' : 'missed';
  }

  return {
    ...slate,
    ...detail,
    myPick,
    confidence,
    winner: game.winner ?? null,
    isTie: Boolean(game.isTie),
    homeScore: game.homeScore ?? null,
    awayScore: game.awayScore ?? null,
    status: game.status ?? null,
    quarter: game.quarter ?? null,
    timeRemaining: game.timeRemaining ?? null,
    pickedCount: game.pickedCount ?? 0,
    reveal,
    outcome,
    flagged: Boolean(flagged),
  };
}

export default gameCardView;
