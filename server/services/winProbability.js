/**
 * Matchup win probability v2 (Home v2 spec, "Win probability v2" board),
 * pure. v1 (src/shared/lib/winProbability.js) is a logistic of the expected
 * final margin with a fixed scale of 24, so certainty never arrives: a matchup
 * decided by 2 points still reads 52%. v2 keeps v1's input, the Expected
 * final margin, and gives the curve a spread that shrinks as starters finish:
 *
 *   mu      = expectedFinal(home) - expectedFinal(away)
 *   sigma_i = (p90_i - p10_i) / 2.5631        per starter, from the Weekly
 *                                             projection distribution
 *   f_i     = the fraction of his game still to play (1 before kickoff,
 *             0 once final or on a bye)
 *   sigma   = k * sqrt(sum over both lineups of sigma_i^2 * f_i)
 *   P(home) = Phi(mu / sigma), or 1 / 0 / 0.5 by the sign of mu when sigma = 0
 *
 * 2.5631 is the width of a normal curve's 10th-to-90th band in standard
 * deviations (2 x 1.28155). Remaining variance scales linearly with time left
 * (square-root-of-time for sigma). k absorbs the correlation between
 * teammates' scores; it starts at 1 and is fit by the calibration backtest.
 *
 * Shadow mode (#win-prob-v2): the live score pass records v2 beside the
 * inputs v1 needs, and nothing reads it on any surface until it passes its
 * gate (Brier score at or below v1's, reliable bins, exact 0/1 when final).
 */

const P10_P90_WIDTH_IN_SD = 2.5631;
const REGULATION_MINUTES = 60;
const QUARTER_MINUTES = 15;

/**
 * Standard normal CDF via Abramowitz and Stegun 7.1.26 (erf, max error
 * 1.5e-7), so Phi is accurate to about 1e-7.
 */
function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** "m:ss" to minutes, or null when unreadable. */
function clockMinutes(timeRemaining) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeRemaining || '').trim());
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

/**
 * The fraction (0..1) of a starter's game still to play, from the Expected
 * final game state and the live row's own vocabulary: ESPN writes quarter as
 * Q1..Q4, Half, OT, OT2...; Tank01 wrote a bare period number. An in-progress
 * game whose clock cannot be read counts as half left, the least-committal
 * guess.
 */
function gameFractionRemaining({ gameState, quarter, timeRemaining }) {
  if (gameState === 'final') return 0;
  if (gameState !== 'in_progress') return 1;
  const label = String(quarter || '').trim();
  if (/^half$/i.test(label)) return 0.5;
  const minutes = clockMinutes(timeRemaining);
  if (/^OT\d*$/i.test(label)) return minutes == null ? 0 : minutes / REGULATION_MINUTES;
  const period = /^Q?([1-4])$/i.exec(label);
  if (!period || minutes == null) return 0.5;
  const quartersAfter = 4 - Number(period[1]);
  return Math.min(1, (quartersAfter * QUARTER_MINUTES + minutes) / REGULATION_MINUTES);
}

/** One starter's standard deviation from his projection band; 0 without one. */
function starterSigma(detail) {
  if (!detail) return 0;
  const p10 = Number(detail.p10);
  const p90 = Number(detail.p90);
  if (detail.p10 == null || detail.p90 == null || !Number.isFinite(p10) || !Number.isFinite(p90)) return 0;
  return Math.max(0, p90 - p10) / P10_P90_WIDTH_IN_SD;
}

/** A lineup's remaining variance: sum of sigma_i^2 * f_i over `{ p10, p90, gameFraction }`. */
function varianceRemaining(starters) {
  return (starters || []).reduce((sum, starter) => {
    const sigma = starterSigma(starter);
    const fraction = Number(starter && starter.gameFraction);
    return sum + sigma * sigma * (Number.isFinite(fraction) ? fraction : 0);
  }, 0);
}

/**
 * `{ home, away, mu, sigma }`, or null when either side's Expected final is
 * unknown (no projection run): a probability built on a missing forecast is
 * worse than none.
 */
function winProbabilityV2({ homeExpectedFinal, awayExpectedFinal, homeVariance, awayVariance, k = 1 }) {
  if (homeExpectedFinal == null || awayExpectedFinal == null) return null;
  const mu = Number(homeExpectedFinal) - Number(awayExpectedFinal);
  const variance = Math.max(0, Number(homeVariance) || 0) + Math.max(0, Number(awayVariance) || 0);
  const sigma = k * Math.sqrt(variance);
  let home;
  if (sigma > 0) home = normalCdf(mu / sigma);
  else home = mu > 0 ? 1 : (mu < 0 ? 0 : 0.5);
  return { home, away: 1 - home, mu, sigma };
}

module.exports = {
  P10_P90_WIDTH_IN_SD,
  normalCdf,
  gameFractionRemaining,
  starterSigma,
  varianceRemaining,
  winProbabilityV2,
};
