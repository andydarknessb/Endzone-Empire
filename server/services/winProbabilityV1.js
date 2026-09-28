/**
 * Matchup win probability v1, the server's copy, pure. The one v1 the product
 * shows is the client's (src/shared/lib/winProbability.js, an ES module the
 * server cannot require); this port exists only so win probability v2's
 * evaluation (winProbabilityEvaluation.js) can recompute v1 from a shadow
 * row's scores and Expected finals and grade the number the browser actually
 * showed. src/shared/lib/winProbability.parity.test.js pins the two to the
 * same result bit for bit, so edit both or neither.
 *
 * v1 is a logistic of the Expected final margin at a fixed scale of 24:
 * each side's expected final is its score plus the projected points it still
 * has to add (never negative), and a side whose Expected final is unknown
 * (null) is treated as having nothing left to add.
 */

const MARGIN_SCALE = 24;

/** Projected points a side still has left to score (never negative). */
function remainingPoints(projectedTotal, currentScore) {
  const proj = Number(projectedTotal) || 0;
  const cur = Number(currentScore) || 0;
  return Math.max(0, proj - cur);
}

/** Probability (0..1) that the home side wins from scores and points remaining. */
function homeWinProbability({ homeScore, awayScore, homeRemaining, awayRemaining }) {
  const expectedHome = (Number(homeScore) || 0) + (Number(homeRemaining) || 0);
  const expectedAway = (Number(awayScore) || 0) + (Number(awayRemaining) || 0);
  const margin = expectedHome - expectedAway;
  return 1 / (1 + Math.exp(-margin / MARGIN_SCALE));
}

/** `{ home, away }` from the matchup shape, exactly as the client computes it. */
function matchupWinProbability({ homeScore, awayScore, homeExpectedFinal, awayExpectedFinal }) {
  const home = homeWinProbability({
    homeScore,
    awayScore,
    homeRemaining: remainingPoints(homeExpectedFinal, homeScore),
    awayRemaining: remainingPoints(awayExpectedFinal, awayScore),
  });
  return { home, away: 1 - home };
}

module.exports = { MARGIN_SCALE, remainingPoints, homeWinProbability, matchupWinProbability };
