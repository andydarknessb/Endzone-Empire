// In-game win probability for a head-to-head fantasy matchup. v1 is a logistic
// function of the expected final margin, where each side's expected final score
// is its points so far plus the projected points it still has left to score.
// Recomputed on every score sync — as real points come in, "remaining" shrinks
// and the curve sharpens toward whoever is ahead late.

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
 * floored shortfall while in progress, points once final; summed over the
 * starters). Because the shortfall is floored per starter server-side, the
 * remaining points here are simply expected final minus score, and a side
 * whose expected final is unknown (null) is treated as having nothing left
 * to add. Returns { home, away } probabilities summing to 1.
 */
export function matchupWinProbability({
  homeScore,
  awayScore,
  homeExpectedFinal,
  awayExpectedFinal,
}) {
  const home = homeWinProbability({
    homeScore,
    awayScore,
    homeRemaining: remainingPoints(homeExpectedFinal, homeScore),
    awayRemaining: remainingPoints(awayExpectedFinal, awayScore),
  });
  return { home, away: 1 - home };
}
