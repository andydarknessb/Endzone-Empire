'use strict';

/**
 * The factorial family, the salts, the activation assertions, the parsimony
 * order, and the seven-component intersection-union test.
 *
 * This is where a cell either earns a proposal or does not, so every rule here
 * is preregistered and none of it may be decided after seeing a number. Three
 * properties do most of the protecting:
 *
 * 1. **The divisor is FIXED at 7.** A cell with `homeAway = off` skips
 *    components (b) and (f), and it does NOT get a larger alpha for the ones it
 *    skips. Otherwise the cheapest way to pass would be to test less.
 * 2. **A missing or UNEVALUABLE component FAILS the claim.** There is no
 *    "assume pass". Component (f) in particular can be unevaluable in three
 *    distinct ways, and each of them makes the homeAway claim INCONCLUSIVE
 *    rather than passing.
 * 3. **Selection is never by point estimate.** When two cells pass, the
 *    parsimony total order picks between them, and it looks only at how much
 *    each cell changes - never at how well it scored.
 *
 * Pure: no clock, no I/O. The shared bootstrap resamples arrive from
 * `lib/metrics` so every bootstrap-based component uses the identical draws.
 */

const crypto = require('crypto');

const { canonicalJson } = require('./snapshotStore');
const { isFiniteNumber, roundToTie } = require('./numbers');
const {
  COMPONENT_ALPHA, SALTS, MACRO_POSITIONS, bootstrapMean,
} = require('./metrics');

// ---------------------------------------------------------------------------
// The factorial (prereg 7.1, 12.1)
// ---------------------------------------------------------------------------

const BLEND_WEIGHTS = Object.freeze([0, 0.25, 0.40, 0.60]);
const HOME_AWAY_STATES = Object.freeze(['off', 'on']);
const CONTROL_BLEND_WEIGHT = 0.25;
const CONTROL_HOME_AWAY = 'off';

/** Pure: the canonical name of a cell. */
function cellName({ blendWeight, homeAway }) {
  const usage = `usage-${String(Math.round(blendWeight * 100)).padStart(2, '0')}`;
  return `${usage}-${homeAway}`;
}

const CONTROL_CELL = cellName({ blendWeight: CONTROL_BLEND_WEIGHT, homeAway: CONTROL_HOME_AWAY });

/** The full 4 x 2 family, reported whether or not any cell passes (prereg 12.1). */
const ALL_CELLS = Object.freeze(BLEND_WEIGHTS.flatMap((blendWeight) => HOME_AWAY_STATES.map(
  (homeAway) => Object.freeze({ name: cellName({ blendWeight, homeAway }), blendWeight, homeAway })
)));

/** The SELECTION FAMILY: the 7 non-control cells (prereg 7.1). */
const SELECTION_FAMILY = Object.freeze(ALL_CELLS.filter((c) => c.name !== CONTROL_CELL));

/**
 * The preregistered fixed cell order, used ONLY when parsimony rules 1-3 all
 * tie (prereg 12.3).
 */
const FIXED_CELL_ORDER = Object.freeze([
  'usage-40-off', 'usage-00-off', 'usage-60-off',
  'usage-25-on', 'usage-40-on', 'usage-00-on', 'usage-60-on',
]);

/**
 * Resolve a cell's MODEL_CONSTANTS from the shipped baseline.
 *
 * `baseConstants` is production's own `MODEL_CONSTANTS`, injected. The cell
 * changes exactly two leaves and nothing else, which is what makes "fewest
 * changed constants" a meaningful parsimony criterion.
 *
 * **No cell may open `crossSeason`.** It ships false, no cell in this family
 * touches it, and `assertNoCrossSeason` proves it - because turning it on would
 * widen `versusOpponent`'s pool and silently invalidate the buildPriorGames
 * fail gate.
 */
function resolveConstants({ cell, baseConstants, label = 'arms' }) {
  if (!baseConstants || typeof baseConstants !== 'object') {
    throw new Error(`${label}: the production MODEL_CONSTANTS must be injected`);
  }
  const resolved = JSON.parse(JSON.stringify(baseConstants));
  resolved.usage = { ...(resolved.usage || {}), blendWeight: cell.blendWeight };
  resolved.homeAway = { ...(resolved.homeAway || {}), enabled: cell.homeAway === 'on' };
  return resolved;
}

/** Pure: the SHA-256 of a cell's resolved constants, canonically serialized. */
function constantsHash(resolved) {
  return crypto.createHash('sha256').update(canonicalJson(resolved), 'utf8').digest('hex');
}

/**
 * Fail loud if any cell opens `versusOpponent.crossSeason`.
 *
 * The buildPriorGames fail gate rests on that factor staying inactive; a cell
 * that widened its pool would invalidate the gate's conclusion without changing
 * the gate's code.
 */
function assertNoCrossSeason({ cells, baseConstants, label = 'arms' }) {
  for (const cell of cells) {
    const resolved = resolveConstants({ cell, baseConstants, label });
    const crossSeason = resolved.versusOpponent && resolved.versusOpponent.crossSeason;
    if (crossSeason) {
      throw new Error(
        `${label}: cell ${cell.name} opens versusOpponent.crossSeason. No cell in this family may: ` +
        'it would widen the factor\'s pool and invalidate the buildPriorGames fail gate, which ' +
        'concluded that team resolution cannot change a number BECAUSE the factor never activates.'
      );
    }
  }
  return true;
}

/** Build the whole family with hashes, ready for the freeze manifest. */
function buildFamily({ baseConstants, label = 'arms' }) {
  assertNoCrossSeason({ cells: ALL_CELLS, baseConstants, label });
  const cells = ALL_CELLS.map((cell) => {
    const resolved = resolveConstants({ cell, baseConstants, label });
    return {
      ...cell,
      isControl: cell.name === CONTROL_CELL,
      selectable: cell.name !== CONTROL_CELL,
      resolvedConstants: resolved,
      constantsHash: constantsHash(resolved),
    };
  });
  assertDistinctConstants({ cells, label });
  return { cells, control: cells.find((c) => c.isControl), selectionFamily: cells.filter((c) => c.selectable) };
}

/**
 * Fail loud if two cells resolve to the same constants.
 *
 * Unreachable while `resolveConstants` works - eight distinct
 * `(blendWeight, enabled)` pairs cannot serialize alike - which is precisely
 * why it is a named function rather than an inline `if`: a guard that can only
 * fire on an already-broken codebase is a guard nobody has ever seen work, so
 * this one is exercised directly by test.
 *
 * It matters because two cells with identical constants would not be two arms.
 * Every paired contrast between them would be identically zero, and the family
 * would silently have seven members rather than eight.
 */
function assertDistinctConstants({ cells, label = 'arms' }) {
  const byHash = new Map();
  for (const cell of cells) {
    if (byHash.has(cell.constantsHash)) {
      throw new Error(
        `${label}: ${cell.name} and ${byHash.get(cell.constantsHash)} resolve to identical ` +
        'constants, so they are not distinct arms - every contrast between them would be zero.'
      );
    }
    byHash.set(cell.constantsHash, cell.name);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Salts (prereg 8.1)
// ---------------------------------------------------------------------------

/**
 * Fail loud unless a salted run differs from its unsalted twin ONLY in
 * `hashValue`.
 *
 * The salts exist to average over simulation noise. If a salt could change any
 * other input, it would be changing the model rather than the seed, and the
 * 24-salt mean would be averaging over 24 different models.
 */
function assertSaltAffectsOnlyHashValue({ runsBySalt, label = 'salts' }) {
  const salts = Object.keys(runsBySalt);
  const missing = SALTS.filter((s) => !salts.includes(s));
  if (missing.length > 0) {
    throw new Error(`${label}: ${missing.length} of the 24 preregistered salts are missing`);
  }
  const withoutHash = (run) => {
    const { hashValue, ...rest } = run;
    return canonicalJson(rest);
  };
  const reference = withoutHash(runsBySalt[SALTS[0]]);
  const hashValues = new Set();
  for (const salt of SALTS) {
    const run = runsBySalt[salt];
    if (withoutHash(run) !== reference) {
      throw new Error(
        `${label}: salt ${salt} changes an input other than hashValue. Salts vary the SEED only; ` +
        'anything else and the 24-salt mean would be averaging over 24 different models.'
      );
    }
    hashValues.add(run.hashValue);
  }
  if (hashValues.size !== SALTS.length) {
    throw new Error(`${label}: the salts must produce 24 distinct hashValues, got ${hashValues.size}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The two point-identity assertions (prereg 7.3)
// ---------------------------------------------------------------------------

/**
 * `usage-25 x off` must be BIT-IDENTICAL to the shipped control.
 *
 * They are the same configuration by construction, so any difference means the
 * harness introduced one - a different code path, a different seed, a different
 * rounding. Bit-identity, not approximate equality, because there is no
 * legitimate source of even a last-digit difference.
 */
function assertControlBitIdentity({ controlRun, usage25OffRun, label = 'usage-25 identity' }) {
  const a = canonicalJson(controlRun);
  const b = canonicalJson(usage25OffRun);
  if (a !== b) {
    throw new Error(
      `${label}: usage-25 x off is not bit-identical to the control. They are the SAME ` +
      'configuration, so a difference means the harness introduced one rather than the model.'
    );
  }
  return true;
}

/**
 * `homeaway-on-stored` must be POINT-IDENTICAL to `homeaway-on`.
 *
 * Point-identical rather than bit-identical because the two paths can carry
 * different provenance metadata; what must not differ is any published number.
 */
function assertHomeAwayStoredPointIdentity({ storedRun, computedRun, label = 'homeAway identity' }) {
  const keys = new Set([...Object.keys(storedRun), ...Object.keys(computedRun)]);
  const differences = [];
  for (const key of keys) {
    const a = storedRun[key];
    const b = computedRun[key];
    if (isFiniteNumber(a) && isFiniteNumber(b)) {
      if (roundToTie(a) !== roundToTie(b)) differences.push(`${key}: ${a} vs ${b}`);
    } else if (a === null || b === null) {
      if (a !== b) differences.push(`${key}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `${label}: homeaway-on-stored and homeaway-on differ on ${differences.length} value(s) ` +
      `(${differences.slice(0, 3).join('; ')}). They must be point-identical.`
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Factor activation (prereg 11)
// ---------------------------------------------------------------------------

/** Threshold 0.85, identical for every position and both seasons (prereg 11.2). */
const ACTIVATION_THRESHOLD = 0.85;

/**
 * Pure: is the homeAway factor ACTIVATED for one projection?
 *
 * `factors.homeAway.available === true` AND the raw `effect !== 0`. Both halves
 * matter: a factor can report itself available and still resolve to a zero
 * effect after shrinkage, and a zero effect changes nothing, so counting it as
 * activation would overstate how treated the on-cells actually are.
 */
function isActivated(projection) {
  const factor = projection && projection.factors && projection.factors.homeAway;
  if (!factor || factor.available !== true) return false;
  return isFiniteNumber(factor.effect) && Number(factor.effect) !== 0;
}

/**
 * Pure: is a projection ELIGIBLE for the activation denominator?
 *
 * Eligible, NON-NEUTRAL, KNOWN-ORIENTATION (prereg 11). A neutral-site game has
 * no orientation to price, and an unknown orientation cannot be priced either;
 * including them would make the denominator larger than anything the factor
 * could ever have acted on, and the rate would understate treatment for a
 * reason unrelated to the model.
 */
function isEligibleForActivation(projection) {
  if (!projection || projection.eligible === false) return false;
  if (projection.neutralSite === true) return false;
  return projection.knownOrientation === true;
}

/**
 * Activation rate per position, and the per-season verdict.
 *
 * If ANY position falls below 0.85 in a season, the homeAway claim is
 * INCONCLUSIVE for that season: an on-cell that is not actually treated cannot
 * be compared to an off-cell. Rates are published per season and position
 * regardless of outcome.
 */
function activationReport({ projectionsByPosition, threshold = ACTIVATION_THRESHOLD, label = 'activation' }) {
  const byPosition = {};
  const below = [];
  for (const position of MACRO_POSITIONS) {
    const all = projectionsByPosition[position] || [];
    const eligible = all.filter(isEligibleForActivation);
    const activated = eligible.filter(isActivated);
    const rate = eligible.length === 0 ? null : activated.length / eligible.length;
    byPosition[position] = {
      eligible: eligible.length,
      activated: activated.length,
      excludedIneligible: all.length - eligible.length,
      rate,
    };
    // A position with NO eligible projections cannot demonstrate treatment
    // either, so it counts as below threshold rather than being skipped.
    if (rate === null || rate < threshold) below.push(position);
  }
  return {
    byPosition,
    threshold,
    belowThreshold: below,
    verdict: below.length === 0 ? 'treated' : 'inconclusive',
    detail: below.length === 0
      ? `every position clears ${threshold}`
      : `${below.join(', ')} below ${threshold}: an on-cell that is not actually treated cannot be `
        + 'compared to an off-cell, so the homeAway claim is INCONCLUSIVE for this season',
    label,
  };
}

// ---------------------------------------------------------------------------
// The exact binomial machinery for component (f) (prereg 9.8)
// ---------------------------------------------------------------------------

/** Pure: C(n, k) as an exact-ish float; n is at most 17 here, so this is exact. */
function binomialCoefficient(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/** Pure: `P(Binomial(n, 1/2) >= k)`, the one-sided upper tail. */
function binomialUpperTail(n, k) {
  let total = 0;
  for (let j = Math.max(0, k); j <= n; j++) total += binomialCoefficient(n, j);
  return total / 2 ** n;
}

/**
 * The margin-shifted exact one-sided binomial SIGN TEST of prereg 9.8.
 *
 * 1. For each 2025 season-week with subgroup rows in both cells, `D_w` is the
 *    on-minus-off week metric.
 * 2. **Margin shift**: `S_w = D_w - delta_F`.
 * 3. Weeks with `S_w` exactly zero at ten decimal places are DROPPED; `n` is
 *    what remains and `k = #{w : S_w < 0}`.
 * 4. Under the null at the boundary, `k ~ Binomial(n, 1/2)`, and
 *    `p = sum_{j=k}^{n} C(n,j) 2^-n`.
 * 5. Noninferiority iff `p <= alpha/7`.
 * 6. The INVERTED BOUND is the same procedure, so they can never disagree: the
 *    endpoint passes iff the bound lies strictly below `delta_F`.
 */
const DELTA_F = 0.025;
const CATASTROPHIC_CAP = 0.20;
const MIN_F_CLUSTERS = 8;
const MIN_F_ROWS = 30;
const MAX_EFFECT = 0.05;
/** Below this realized mean |b|, the margin is unreachable (prereg 9.8). */
const FALSIFIABILITY_FLOOR = DELTA_F / MAX_EFFECT; // 0.50

function exactSignTest({ weekDeltas, margin = DELTA_F, alpha = COMPONENT_ALPHA, label = 'component (f)' }) {
  const shifted = weekDeltas.map((d) => roundToTie(Number(d) - margin));
  const nonTied = shifted.filter((s) => s !== 0);
  const n = nonTied.length;
  const k = nonTied.filter((s) => s < 0).length;
  if (n === 0) {
    return {
      evaluable: false,
      reason: 'every week tied exactly on the shifted margin, so the sign test has no information',
      n: 0, k: 0, p: null, bound: null, passes: false,
    };
  }
  const p = binomialUpperTail(n, k);
  // The inverted one-sided bound: the order statistic D_(j) with
  // j = min{ i : P(Bin(n,1/2) >= i) <= alpha }. No such i means +infinity.
  let j = null;
  for (let i = 1; i <= n; i++) {
    if (binomialUpperTail(n, i) <= alpha) { j = i; break; }
  }
  const sortedDeltas = [...weekDeltas].map(Number).sort((a, b) => a - b);
  const bound = j === null ? Infinity : sortedDeltas[j - 1];
  const passes = p <= alpha;
  // The test and the bound are the same procedure, so they cannot disagree.
  const boundAgrees = j === null ? !passes : (bound < margin) === passes;
  return {
    evaluable: true,
    reason: null,
    n,
    k,
    p,
    bound,
    passes,
    boundAgrees,
    droppedTiedWeeks: weekDeltas.length - n,
  };
}

/**
 * ONE endpoint of component (f), end to end, including all three ways it can
 * be UNEVALUABLE.
 *
 * Unevaluable means the homeAway claim is INCONCLUSIVE - **never a pass**. Zero
 * rows is "not estimable", not a formal pass, and 2024 can never rescue sparse
 * 2025 evidence.
 *
 * This runs ONE endpoint. Component (f) has TWO, and `componentF` below is what
 * combines them - calling this directly for a claim would test half the gate.
 */
function componentFEndpoint({
  endpoint,
  weekDeltas,
  subgroupRows,
  meanAbsBaseline,
  maxAbsBaseline = null,
  weekMeanAbsBaselines = [],
  incrementalErrors = [],
  margin = DELTA_F,
  alpha = COMPONENT_ALPHA,
  label = 'component (f)',
}) {
  const where = endpoint ? `${label} ${endpoint}` : label;
  const clusters = weekDeltas.length;

  /**
   * The transparency block the preregistration REQUIRES per endpoint (9.8):
   * the non-tied week count, k, the exact p, the inverted bound, the subgroup
   * row count, the realized MEAN and MAXIMUM |b|, the count of weeks whose own
   * realized mean |b| is at or below the falsifiability floor, and the
   * week-sign independence assumption the exact test rests on.
   *
   * The per-week floor count matters on its own: those are weeks where the
   * margin was unattainable, so a favourable sign there is structurally
   * uninformative. The season-level guard bounds the aggregate; this discloses
   * how much of k rests on such weeks.
   */
  const transparency = () => ({
    endpoint,
    subgroupRows,
    meanAbsBaseline: isFiniteNumber(meanAbsBaseline) ? Number(meanAbsBaseline) : null,
    maxAbsBaseline: isFiniteNumber(maxAbsBaseline) ? Number(maxAbsBaseline) : null,
    weeksBelowFalsifiabilityFloor: weekMeanAbsBaselines
      .filter((b) => isFiniteNumber(b) && Number(b) <= FALSIFIABILITY_FLOOR).length,
    weeksWithBaseline: weekMeanAbsBaselines.filter(isFiniteNumber).length,
    // If the realized maximum |b| never exceeds B_ref = cap / maxEffect, the
    // catastrophic veto could not have fired on this data. That is a
    // DISCLOSURE, not a failure - the veto is an additional safety rather than
    // a gate that must bind.
    catastrophicCapCouldFire: isFiniteNumber(maxAbsBaseline)
      ? Number(maxAbsBaseline) > CATASTROPHIC_CAP / MAX_EFFECT
      : null,
    weekSignIndependenceAssumed: true,
  });

  // (i) The evaluability MINIMUM: at least 8 distinct 2025 clusters AND at
  //     least 30 subgroup rows.
  if (clusters < MIN_F_CLUSTERS || subgroupRows < MIN_F_ROWS) {
    return {
      endpoint,
      status: 'unevaluable',
      claimVerdict: 'inconclusive',
      reason: `below the evaluability minimum: ${clusters} cluster(s) and ${subgroupRows} row(s), `
        + `the minimum is ${MIN_F_CLUSTERS} clusters and ${MIN_F_ROWS} rows. Zero rows is "not `
        + 'estimable", not a formal pass, and 2024 cannot rescue sparse 2025 evidence.',
      passes: false,
      transparency: transparency(),
    };
  }
  // (ii) The FALSIFIABILITY GUARD, which fires BEFORE the test is read: if the
  //      realized mean |b| is at or below delta_F / maxEffect, the largest
  //      attainable delta is at or below the margin and noninferiority cannot
  //      be falsified.
  if (!isFiniteNumber(meanAbsBaseline) || Number(meanAbsBaseline) <= FALSIFIABILITY_FLOOR) {
    return {
      endpoint,
      status: 'unevaluable',
      claimVerdict: 'inconclusive',
      reason: `the realized mean |b| is ${meanAbsBaseline}, at or below ${FALSIFIABILITY_FLOOR}. The `
        + `maximum attainable per-week delta is then at or below the margin ${margin}, so `
        + 'noninferiority cannot be falsified and a pass would be an artefact of the scale.',
      passes: false,
      transparency: transparency(),
    };
  }
  const test = exactSignTest({ weekDeltas, margin, alpha, label: where });
  if (!test.evaluable) {
    return {
      endpoint,
      status: 'unevaluable',
      claimVerdict: 'inconclusive',
      reason: test.reason,
      passes: false,
      test,
      transparency: transparency(),
    };
  }
  // (iii) The catastrophic VETO, defined INCREMENTALLY versus the matched
  //       off-cell so a pre-existing bad prediction cannot falsely veto
  //       homeAway. A veto can never turn a failure into a pass.
  const vetoRows = incrementalErrors.filter((inc) => isFiniteNumber(inc) && Number(inc) > CATASTROPHIC_CAP);
  if (vetoRows.length > 0) {
    return {
      endpoint,
      status: 'vetoed',
      claimVerdict: 'fail',
      reason: `${vetoRows.length} subgroup row(s) increased absolute error by more than `
        + `${CATASTROPHIC_CAP} versus the matched off-cell`,
      passes: false,
      test,
      transparency: transparency(),
    };
  }
  return {
    endpoint,
    status: test.passes ? 'passed' : 'failed',
    claimVerdict: test.passes ? 'pass' : 'fail',
    reason: null,
    passes: test.passes,
    test,
    transparency: {
      ...transparency(),
      nonTiedWeeks: test.n,
      k: test.k,
      exactP: test.p,
      invertedBound: test.bound,
    },
  };
}

/** The two preregistered endpoints of component (f) (prereg 9.8). */
const F_ENDPOINTS = Object.freeze({ F1: 'f1-subgroup-mae', F2: 'f2-subgroup-absolute-bias' });

/**
 * Component (f): BOTH endpoints, combined.
 *
 * The preregistration defines TWO endpoints, each with its own exact binomial
 * sign test:
 *   - **f1**: per-week subgroup MAE, on-cell minus matched off-cell;
 *   - **f2**: per-week subgroup ABSOLUTE BIAS, same contrast.
 *
 * Both are the MEDIAN over 2025 season-weeks of the on-minus-off delta, and
 * both must clear noninferiority. Running one and reporting the component would
 * leave half the no-harm gate untested while a homeAway claim passed, so BOTH
 * inputs are required BY NAME here - the single-endpoint mistake is not
 * representable rather than merely discouraged.
 *
 * Combination, in precedence order:
 *   - VETOED in either endpoint -> vetoed, claim FAILS. A veto outranks an
 *     unevaluable endpoint because it is positive evidence of harm, whereas
 *     unevaluable is absent evidence;
 *   - UNEVALUABLE in either -> unevaluable, claim INCONCLUSIVE;
 *   - passes ONLY if BOTH endpoints pass.
 */
function componentF({ f1, f2, label = 'component (f)' }) {
  for (const [name, input] of [['f1', f1], ['f2', f2]]) {
    if (!input || typeof input !== 'object') {
      throw new Error(
        `${label} requires BOTH endpoints; ${name} is missing. The preregistration defines two - `
        + 'per-week subgroup MAE and per-week subgroup absolute bias - and running one would leave '
        + 'half the no-harm gate untested while the homeAway claim passed.'
      );
    }
  }
  const results = {
    [F_ENDPOINTS.F1]: componentFEndpoint({ ...f1, endpoint: F_ENDPOINTS.F1, label }),
    [F_ENDPOINTS.F2]: componentFEndpoint({ ...f2, endpoint: F_ENDPOINTS.F2, label }),
  };
  const each = Object.values(results);

  const vetoed = each.filter((r) => r.status === 'vetoed');
  if (vetoed.length > 0) {
    return {
      status: 'vetoed',
      claimVerdict: 'fail',
      passes: false,
      reason: vetoed.map((r) => `${r.endpoint}: ${r.reason}`).join('; '),
      endpoints: results,
      transparency: each.map((r) => r.transparency),
    };
  }
  const unevaluable = each.filter((r) => r.status === 'unevaluable');
  if (unevaluable.length > 0) {
    return {
      status: 'unevaluable',
      claimVerdict: 'inconclusive',
      passes: false,
      reason: unevaluable.map((r) => `${r.endpoint}: ${r.reason}`).join('; '),
      endpoints: results,
      transparency: each.map((r) => r.transparency),
    };
  }
  const passes = each.every((r) => r.passes);
  return {
    status: passes ? 'passed' : 'failed',
    claimVerdict: passes ? 'pass' : 'fail',
    passes,
    reason: passes ? null
      : each.filter((r) => !r.passes)
        .map((r) => `${r.endpoint} did not clear noninferiority`).join('; '),
    endpoints: results,
    transparency: each.map((r) => r.transparency),
  };
}

// ---------------------------------------------------------------------------
// The bootstrap components (a)-(e1)
// ---------------------------------------------------------------------------

/** The preregistered margins (prereg 9.2, 9.6). */
const DELTA_R = 0.15;
const DELTA_P = 0.005;

/**
 * Pure: one co-primary component - both inequalities must hold, from the SAME
 * resamples, at alpha/7.
 *
 * `regretDirection` is `'below'` when the upper bound must sit below a
 * threshold and `'above'` when the lower bound must sit above one. Regret is
 * favourable NEGATIVE, pairwise favourable POSITIVE (prereg 6.7).
 */
function coPrimaryComponent({
  name, regretWeeks, pairwiseWeeks, resamples,
  regretThreshold, pairwiseThreshold, alpha = COMPONENT_ALPHA, label = 'component',
}) {
  const regret = bootstrapMean({ weekValues: regretWeeks, resamples, alpha, label: `${label} regret` });
  const pairwise = bootstrapMean({ weekValues: pairwiseWeeks, resamples, alpha, label: `${label} pairwise` });
  const regretOk = regret.upper < regretThreshold;
  const pairwiseOk = pairwise.lower > pairwiseThreshold;
  return {
    name,
    passes: regretOk && pairwiseOk,
    regret: { ...regret, threshold: regretThreshold, ok: regretOk },
    pairwise: { ...pairwise, threshold: pairwiseThreshold, ok: pairwiseOk },
    alpha,
    detail: regretOk && pairwiseOk
      ? 'both co-primary bounds clear their margins'
      : `${!regretOk ? `regret upper ${regret.upper} is not below ${regretThreshold}` : ''}`
        + `${!regretOk && !pairwiseOk ? '; ' : ''}`
        + `${!pairwiseOk ? `pairwise lower ${pairwise.lower} is not above ${pairwiseThreshold}` : ''}`,
  };
}

/**
 * The claim: an intersection-union over seven components.
 *
 * It passes only if EVERY component passes. A component that does not apply
 * passes VACUOUSLY BY DEFINITION and is reported as "not applicable" - never by
 * test. A missing or unevaluable component FAILS the claim.
 */
function evaluateClaim({ cell, components, label = 'claim' }) {
  const required = ['a', 'b', 'c', 'd', 'e1', 'e2', 'f'];
  const results = {};
  let verdict = 'pass';
  const failures = [];
  const inconclusive = [];

  for (const key of required) {
    const component = components[key];
    if (component === undefined) {
      results[key] = { status: 'missing', passes: false };
      failures.push(`${key} is missing`);
      verdict = 'fail';
      continue;
    }
    if (component.applicable === false) {
      // Vacuous by DEFINITION, never by test - and the divisor stays 7.
      results[key] = { status: 'not-applicable', passes: true };
      continue;
    }
    if (component.status === 'unevaluable') {
      results[key] = { status: 'unevaluable', passes: false, reason: component.reason };
      inconclusive.push(`${key}: ${component.reason}`);
      continue;
    }
    results[key] = { status: component.passes ? 'passed' : 'failed', passes: !!component.passes };
    if (!component.passes) failures.push(`${key} failed`);
  }

  // An UNEVALUABLE component makes the claim inconclusive; an outright FAILURE
  // makes it fail. A failure outranks an inconclusive: the cell is not saved by
  // one component being unmeasurable when another was measured and lost.
  if (failures.length > 0) verdict = 'fail';
  else if (inconclusive.length > 0) verdict = 'inconclusive';

  return {
    cell,
    verdict,
    components: results,
    failures,
    inconclusive,
    alpha: COMPONENT_ALPHA,
    divisor: 7,
    detail: verdict === 'pass' ? 'every component passes at alpha/7'
      : verdict === 'fail' ? `failed: ${failures.join('; ')}`
        : `inconclusive: ${inconclusive.join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// Parsimony (prereg 12.3)
// ---------------------------------------------------------------------------

/**
 * The parsimony TOTAL ORDER, applied in order and NEVER by point estimate:
 *
 *   1. fewest changed constants versus the shipped configuration;
 *   2. cells that introduce NO newly gated factor outrank cells that activate
 *      one (so usage-40 x off outranks usage-25 x on);
 *   3. smallest absolute `blendWeight` change from 0.25;
 *   4. the preregistered fixed cell order.
 */
function parsimonyKey(cell) {
  const usageChanged = cell.blendWeight !== CONTROL_BLEND_WEIGHT ? 1 : 0;
  const homeAwayChanged = cell.homeAway !== CONTROL_HOME_AWAY ? 1 : 0;
  return {
    changedConstants: usageChanged + homeAwayChanged,
    activatesFactor: homeAwayChanged,
    // Rounded to the preregistered tie precision. `0.40 - 0.25` is
    // 0.15000000000000002 in binary floating point, and this is a COMPARISON
    // KEY in a total order that has to be reproducible: two cells that should
    // tie on rule 3 must actually tie, and fall through to rule 4, rather than
    // being separated by a bit of representation noise.
    blendWeightChange: roundToTie(Math.abs(cell.blendWeight - CONTROL_BLEND_WEIGHT)),
    fixedOrder: FIXED_CELL_ORDER.indexOf(cell.name),
  };
}

function selectByParsimony({ passingCells, label = 'parsimony' }) {
  if (!Array.isArray(passingCells) || passingCells.length === 0) {
    return { selected: null, reason: 'no cell passed', ranked: [] };
  }
  for (const cell of passingCells) {
    if (FIXED_CELL_ORDER.indexOf(cell.name) < 0) {
      throw new Error(`${label}: ${cell.name} is not in the preregistered fixed cell order`);
    }
  }
  const ranked = [...passingCells].sort((a, b) => {
    const ka = parsimonyKey(a);
    const kb = parsimonyKey(b);
    return ka.changedConstants - kb.changedConstants
      || ka.activatesFactor - kb.activatesFactor
      || ka.blendWeightChange - kb.blendWeightChange
      || ka.fixedOrder - kb.fixedOrder;
  });
  return {
    selected: ranked[0],
    ranked,
    reason: 'parsimony total order; point estimates never break a tie',
    keys: ranked.map((c) => ({ name: c.name, ...parsimonyKey(c) })),
  };
}

module.exports = {
  BLEND_WEIGHTS,
  HOME_AWAY_STATES,
  CONTROL_CELL,
  CONTROL_BLEND_WEIGHT,
  CONTROL_HOME_AWAY,
  ALL_CELLS,
  SELECTION_FAMILY,
  FIXED_CELL_ORDER,
  ACTIVATION_THRESHOLD,
  DELTA_R,
  DELTA_P,
  DELTA_F,
  CATASTROPHIC_CAP,
  MIN_F_CLUSTERS,
  MIN_F_ROWS,
  MAX_EFFECT,
  FALSIFIABILITY_FLOOR,
  cellName,
  resolveConstants,
  constantsHash,
  assertNoCrossSeason,
  assertDistinctConstants,
  buildFamily,
  assertSaltAffectsOnlyHashValue,
  assertControlBitIdentity,
  assertHomeAwayStoredPointIdentity,
  isActivated,
  isEligibleForActivation,
  activationReport,
  binomialCoefficient,
  binomialUpperTail,
  exactSignTest,
  F_ENDPOINTS,
  componentFEndpoint,
  componentF,
  coPrimaryComponent,
  evaluateClaim,
  parsimonyKey,
  selectByParsimony,
};
