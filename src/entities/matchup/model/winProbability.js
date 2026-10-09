// In-game win probability for a head-to-head fantasy matchup. v1 is a logistic
// function of the expected final margin, where each side's expected final score
// is its points so far plus the projected points it still has left to score.
// Recomputed on every score sync — as real points come in, "remaining" shrinks
// and the curve sharpens toward whoever is ahead late.
//
// Promoted to `shared/lib` from `src/lib/winProbability` (#1120, ADR 0031):
// `matchupWinProbability` reached five widget consumers plus the Matchup page,
// past ADR 0031's one-more-consumer threshold for a `shared/lib` home. The
// arithmetic and return shape are unchanged; only its address moved.

// Spread (in fantasy points) of the expected-margin logistic. Roughly one
// standard deviation of a weekly matchup margin; larger = flatter/less certain.
export const MARGIN_SCALE = 24;

/** Projected points a side still has left to score (never negative). */
export function remainingPoints(projectedTotal, currentScore) {
  const proj = Number(projectedTotal) || 0;
  const cur = Number(currentScore) || 0;
  return Math.max(0, proj - cur);
}

/**
 * Probability (0..1) that the home side wins, given both current scores and
 * both sides' projected points remaining. Symmetric: swapping home/away gives
 * the complement. With no information (equal scores, equal remaining) it is 0.5.
 */
export function homeWinProbability({
  homeScore,
  awayScore,
  homeRemaining,
  awayRemaining,
}) {
  const expectedHome = (Number(homeScore) || 0) + (Number(homeRemaining) || 0);
  const expectedAway = (Number(awayScore) || 0) + (Number(awayRemaining) || 0);
  const margin = expectedHome - expectedAway;
  return 1 / (1 + Math.exp(-margin / MARGIN_SCALE));
}

/**
 * Convenience wrapper from the matchup shape: current scores plus each team's
 * expected final (CONTEXT.md: projection until kickoff, points plus the
 * projection for the game time left while in progress, points once final;
 * summed over the starters). An expected final never falls below the score, so
 * the remaining points here are simply expected final minus score, and a side
 * whose expected final is unknown (null) is treated as having nothing left
 * to add. Once the matchup's `status` is 'played' or 'final' the result is
 * decided by the scores alone: home 1 if ahead, 0 if behind, 0.5 on a tie,
 * rather than a logistic that would still read a settled 6-point result as
 * 56%. The gate is the status, not "nothing remaining", because a missing
 * Expected final (a projection outage, an unreadable overtime clock) also
 * reads as nothing remaining on a game still in play. server/services/winProbabilityV1.js
 * mirrors this and src/shared/lib/winProbability.parity.test.js pins the two,
 * so edit both or neither. Returns { home, away } probabilities summing to 1.
 */
export function matchupWinProbability({
  homeScore,
  awayScore,
  homeExpectedFinal,
  awayExpectedFinal,
  status,
}) {
  if (status === 'played' || status === 'final') {
    const home = Math.sign((Number(homeScore) || 0) - (Number(awayScore) || 0)) / 2 + 0.5;
    return { home, away: 1 - home };
  }
  const home = homeWinProbability({
    homeScore,
    awayScore,
    homeRemaining: remainingPoints(homeExpectedFinal, homeScore),
    awayRemaining: remainingPoints(awayExpectedFinal, awayScore),
  });
  return { home, away: 1 - home };
}
