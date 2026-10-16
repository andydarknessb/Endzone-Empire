/**
 * "Players remaining", the one definition (RULINGS Critique 9, spec #2334 AC 6l, ADR 0061): the starters
 * whose NFL game is not final and whose availability verdict is not unavailable (Out, IR, suspension,
 * practice squad, bye, released). An empty slot does not count. "Yet to play" is the narrower count of
 * those whose game has not started. The server computes the same two numbers (expectedFinal.service) and
 * emits them on every matchup payload (`playersRemaining`, `yetToPlay`).
 *
 * Use these helpers ONLY where the payload carries no server value, and never mix the sources on one
 * surface: a page prints the server's pair or this pair, not one of each, or the two counts can disagree.
 *
 * `starters` are one side's starting slots, a player row (the normalised camelCase shape or the wire's
 * snake_case, as `useMatchup` hands it, carrying `availability: { available, reason }`) or null for an
 * empty slot. A starter with no verdict on the wire is not ruled out. `gameStates` are the
 * `live_game_states` rows (`away_team`, `home_team`, `game_status`) that `useLiveGameStates` returns.
 * A starter's game is the row that carries his NFL team; with no such row his own `gameState` stands
 * (the server's classification), and with neither he is not final, so he counts as remaining but is
 * not claimed as yet to play.
 *
 * shortcut: teams match on trimmed upper-case code with no alias table (the server normalises WSH/WAS),
 * upgrade if a feed ever disagrees with the roster on a code.
 */
const code = (team) => (team == null ? '' : String(team).trim().toUpperCase());

function stateOf(starter, rows) {
  const team = code(starter.nflTeam ?? starter.nfl_team);
  const row = team ? rows.find((g) => code(g.away_team) === team || code(g.home_team) === team) : null;
  return row ? row.game_status : (starter.gameState ?? starter.game_state ?? null);
}

function countedStates(starters, gameStates) {
  const rows = Array.isArray(gameStates) ? gameStates : [];
  return (Array.isArray(starters) ? starters : [])
    .filter((s) => s && s.availability?.available !== false)
    .map((s) => stateOf(s, rows))
    .filter((state) => state !== 'final');
}

/** The starters whose NFL game is not final, unavailable starters and empty slots excluded. */
export function playersRemaining(starters, gameStates) {
  return countedStates(starters, gameStates).length;
}

/** Of those, the starters whose NFL game has not started. */
export function yetToPlay(starters, gameStates) {
  return countedStates(starters, gameStates).filter((state) => state === 'scheduled').length;
}
