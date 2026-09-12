/**
 * The Pickem game model (ADR 0029, entities/pickem-game): the pure per-game
 * read the board needs from a wire game row and the viewer's own picks. It
 * never reaches for line/weather/venue/broadcast/records/situation - that
 * detail lives in gameDetailModel.js, so a caller that only needs the slate
 * (gameKey, teams, kickoff, lock, phase, the viewer's own pick) never pays
 * for parsing the rest.
 */

const FINAL_STATUSES = new Set(['final']);

/**
 * open: not yet locked.
 * live: locked and in progress (no winner, no tie, and the status itself
 *   does not say final).
 * final: locked and settled (a winner, a tie, or a final status).
 */
export function gamePhase(game) {
  if (!game || !game.locked) return 'open';
  if (game.winner != null || game.isTie || FINAL_STATUSES.has(game.status)) return 'final';
  return 'live';
}

function pickFor(gameKey, myPicks) {
  return (myPicks || []).find((pick) => pick.gameKey === gameKey) || null;
}

/**
 * `game` is one entry of the week endpoint's `games` array; `myPicks` is that
 * response's sibling array of the viewer's own picks (never on the game row
 * itself, since the same game row is shared by every viewer of the league).
 */
export function gameModel(game, myPicks) {
  const pick = pickFor(game.gameKey, myPicks);
  return {
    gameKey: game.gameKey,
    // Away@home order (the broadcast convention, "visitor at home"), the
    // opposite of the gameKey's own home|away spelling.
    teams: [game.awayTeam, game.homeTeam],
    kickoff: game.kickoffAt,
    lock: Boolean(game.locked),
    phase: gamePhase(game),
    myPick: pick ? pick.pickedTeam : null,
    confidence: pick && pick.confidence != null ? pick.confidence : null,
  };
}
