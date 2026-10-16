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
 * A pick saves the moment it is made (ADR 0067 wave 2), so there is no draft:
 * "my pick" is the saved `myPicks` row the entity's `gameModel` read.
 * `now` (epoch ms) turns an open game's kickoff into `lockMinutes`, the
 * whole minutes to lock while under an hour (null otherwise), which is the
 * card's "Locks in n min" and its accessible name. `othersPicksForWeek` is the week response's OWN
 * `othersPicks` map (never a per-game value, CONTEXT.md/ADR 0038); this is
 * the one place that map is indexed by gameKey, which is what keeps every
 * caller off the standing trap (revealTally.js's docblock): a lookup that
 * finds nothing is `undefined`, not `[]`, and only `revealTally` gets to
 * decide what that means.
 */
export function gameCardView({
  game,
  myPicks,
  othersPicksForWeek,
  totalManagers = null,
  now = null,
}) {
  const slate = gameModel(game, myPicks, now);
  const detail = gameDetailModel(game);

  const { myPick, confidence } = slate;

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
    lockMinutes: lockMinutesFor(slate, now),
  };
}

// Whole minutes to kickoff for an open game under an hour out (a lock is inclusive at kickoff, so a
// kickoff at or before `now` is no countdown), else null.
function lockMinutesFor(slate, now) {
  if (now == null || slate.lock) return null;
  const remaining = new Date(slate.kickoff).getTime() - now;
  if (!(remaining > 0) || remaining >= 60 * 60 * 1000) return null;
  return Math.floor(remaining / 60000);
}

export default gameCardView;
