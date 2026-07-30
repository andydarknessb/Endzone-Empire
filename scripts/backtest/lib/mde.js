'use strict';

/**
 * The BLINDED design-sensitivity runner: "primary-component power for the seven
 * claims" (preregistration 13).
 *
 * It answers "how large an effect could this design have detected", and it is
 * computed on CONTROL-ONLY artifacts so that computing it cannot leak anything
 * about how the candidate cells did. That blinding is the whole point: an MDE
 * calculated after glimpsing the candidates could be used - even
 * unconsciously - to argue that a margin was set unfairly, and the margins are
 * sealed.
 *
 * **The runner is STRUCTURALLY incapable of loading a candidate cell**, not
 * merely disciplined about it:
 *
 *   - it imports nothing that can read a cell artifact;
 *   - its only data input is a per-week series of CONTROL scores, and
 *     `assertControlOnly` refuses any artifact that names a non-control cell;
 *   - it returns power contours and nothing that could be read as a result.
 *
 * A mutation test pins that: an MDE runner that accepts a candidate cell must
 * fail a test.
 *
 * **It reports. It can NEVER alter a margin, a threshold, or a decision rule**
 * (prereg 13), and it says so in its own output.
 *
 * Pure: seeded, no clock, no I/O.
 */

const { COMPONENT_ALPHA, makeRng, percentileBound } = require('./metrics');
const { CONTROL_CELL, DELTA_R, DELTA_P } = require('./arms');
const { isFiniteNumber } = require('./numbers');

/** The frozen algorithm's constants (prereg 13). */
const MDE_SEED = 184424023;
const CORRELATION_GRID = Object.freeze([
  0.00, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.99,
]);
const REGRET_EFFECTS = Object.freeze([0, -0.05, -0.10, -0.15, -0.20, -0.30, -0.50]);
const PAIRWISE_EFFECTS = Object.freeze([0, 0.0025, 0.0050, 0.0075, 0.0100, 0.0150, 0.0200]);
const EXPERIMENTS_PER_CELL = 2000;
/**
 * Simulation-only draw count. The AUTHORITATIVE analysis always uses exactly
 * 100,000; this deviation exists solely so the grid is computable, and the
 * preregistration declares it because the MDE is descriptive.
 */
const SIMULATION_DRAWS = 10000;
const EVALUATED_WEEK_COUNT = 17;

/**
 * Fail loud unless every artifact belongs to the CONTROL cell.
 *
 * This is the blinding, enforced. The runner cannot be handed a candidate even
 * by accident, and the refusal names the cell so a caller cannot mistake it for
 * a data problem.
 */
function assertControlOnly({ artifacts, label = 'MDE' }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error(`${label}: no control artifacts supplied, so no power can be estimated`);
  }
  const foreign = [...new Set(artifacts
    .map((a) => (a && a.cell !== undefined ? String(a.cell) : null))
    .filter((cell) => cell !== null && cell !== CONTROL_CELL))];
  if (foreign.length > 0) {
    throw new Error(
      `${label} is BLINDED and runs on control-only artifacts. It was handed ${foreign.join(', ')}. ` +
      'Computing design sensitivity from candidate results would let the MDE be used to argue a ' +
      'margin was unfair, and the margins are sealed.'
    );
  }
  return true;
}

/** Pure: the sample standard deviation of a per-week series. */
function weekSd(values, { label = 'sd' } = {}) {
  const usable = values.filter(isFiniteNumber).map(Number);
  if (usable.length < 2) throw new Error(`${label}: need at least two weeks to estimate an SD`);
  const mean = usable.reduce((s, v) => s + v, 0) / usable.length;
  const variance = usable.reduce((s, v) => s + (v - mean) ** 2, 0) / (usable.length - 1);
  return Math.sqrt(variance);
}

/** Pure: a standard normal draw from a uniform RNG (Box-Muller). */
function standardNormal(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Pure: one simulated experiment's joint verdict on BOTH component-(a)
 * inequalities.
 *
 * Draws 17 paired week-deltas with the grid's correlation and the estimated
 * SDs, adds the injected effects, and runs the SAME cluster-bootstrap machinery
 * the real analysis uses - at the reduced simulation draw count.
 */
function simulateExperiment({
  rng, rho, regretEffect, pairwiseEffect, regretSd, pairwiseSd, resamples, alpha = COMPONENT_ALPHA,
}) {
  const n = resamples.clusterCount;
  const regret = new Array(n);
  const pairwise = new Array(n);
  for (let i = 0; i < n; i++) {
    const z1 = standardNormal(rng);
    const z2 = standardNormal(rng);
    // Correlated pair: the two endpoints move together to the degree the grid
    // point specifies, which is what makes the JOINT power meaningful.
    const correlated = rho * z1 + Math.sqrt(1 - rho * rho) * z2;
    regret[i] = regretEffect + regretSd * z1;
    pairwise[i] = pairwiseEffect + pairwiseSd * correlated;
  }
  const boundFor = (values, wantUpper) => {
    const stats = new Float64Array(resamples.draws);
    for (let d = 0; d < resamples.draws; d++) {
      let sum = 0;
      const base = d * n;
      for (let c = 0; c < n; c++) sum += values[resamples.index[base + c]];
      stats[d] = sum / n;
    }
    const sorted = Float64Array.prototype.slice.call(stats).sort();
    return percentileBound(sorted, wantUpper ? 1 - alpha : alpha);
  };
  // Component (a): regret UPPER below -delta_R, pairwise LOWER above +delta_P.
  return boundFor(regret, true) < -DELTA_R && boundFor(pairwise, false) > DELTA_P;
}

/**
 * The blinded power contour grid.
 *
 * Returns, for every `(rho, regretEffect, pairwiseEffect)` cell, the fraction
 * of simulated experiments in which BOTH component-(a) inequalities hold at
 * alpha/7 - the "joint two-primary power" the preregistration names.
 *
 * `experiments` and `draws` are reducible for testing ONLY; the frozen values
 * are the defaults, and the returned report records which were used so a
 * reader can never mistake a smoke run for the real grid.
 */
function runMde({
  controlRegretWeeks,
  controlPairwiseWeeks,
  artifacts = [],
  correlations = CORRELATION_GRID,
  regretEffects = REGRET_EFFECTS,
  pairwiseEffects = PAIRWISE_EFFECTS,
  experiments = EXPERIMENTS_PER_CELL,
  draws = SIMULATION_DRAWS,
  clusterCount = EVALUATED_WEEK_COUNT,
  seed = MDE_SEED,
  label = 'MDE',
}) {
  assertControlOnly({ artifacts, label });
  const regretSd = weekSd(controlRegretWeeks, { label: `${label} regret SD` });
  const pairwiseSd = weekSd(controlPairwiseWeeks, { label: `${label} pairwise SD` });

  // The simulation uses its own reduced-draw resample index, never the
  // authoritative 100,000-draw one: mixing them would let a descriptive run
  // borrow the authoritative analysis's identity.
  const rng = makeRng(seed);
  const index = new Uint16Array(draws * clusterCount);
  for (let d = 0; d < draws; d++) {
    for (let c = 0; c < clusterCount; c++) index[d * clusterCount + c] = Math.floor(rng() * clusterCount);
  }
  const resamples = { index, draws, clusterCount, seed };

  const contours = [];
  for (const rho of correlations) {
    for (const regretEffect of regretEffects) {
      for (const pairwiseEffect of pairwiseEffects) {
        let detected = 0;
        for (let e = 0; e < experiments; e++) {
          if (simulateExperiment({
            rng, rho, regretEffect, pairwiseEffect, regretSd, pairwiseSd, resamples,
          })) detected++;
        }
        contours.push({ rho, regretEffect, pairwiseEffect, power: detected / experiments });
      }
    }
  }

  return {
    name: 'primary-component power for the seven claims',
    blinded: true,
    cell: CONTROL_CELL,
    regretSd,
    pairwiseSd,
    contours,
    settings: { experiments, draws, clusterCount, seed, alpha: COMPONENT_ALPHA },
    // Stated in the artifact itself, because the preregistration requires the
    // report to state it in the same sentence as the contours.
    notSimulated: [
      'the naive benchmark gate (d)',
      'the safety gates (e1) and (e2)',
      'the subgroup gate (f)',
      'anything on 2024',
    ],
    canAlterMargins: false,
    note:
      'Descriptive design sensitivity on control-only artifacts. It reports and can NEVER alter a '
      + 'margin, a threshold, or a decision rule. Simulation uses a reduced draw count by design; '
      + 'the authoritative analysis always uses exactly 100,000.',
  };
}

module.exports = {
  MDE_SEED,
  CORRELATION_GRID,
  REGRET_EFFECTS,
  PAIRWISE_EFFECTS,
  EXPERIMENTS_PER_CELL,
  SIMULATION_DRAWS,
  EVALUATED_WEEK_COUNT,
  assertControlOnly,
  weekSd,
  standardNormal,
  simulateExperiment,
  runMde,
};
// Deliberately absent from this module, and asserted by test: any loader,
// path, filesystem access, or accessor that could reach a candidate cell's
// artifact. The blinding is a property of the require graph, not a promise.
