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
 * Resolve a cell's constants with `homeAway.useStoredHistory` forced `true`
 * - the "on-stored" twin used by the `homeaway-on-stored == homeaway-on`
 * point-identity assertion (PHASE5_EXECUTION_SPEC.md section 8.6.1).
 * Informed by, not copied from, `scripts/backtest-weekly-projections.js`'s
 * `withHistory` pattern. `resolveConstants` itself is untouched - it still
 * builds only the eight factorial cells - this is a separate, named
 * builder for the one extra variant the sealed assertion requires.
 */
function resolveConstantsWithStoredHistory({ cell, baseConstants, label = 'arms' }) {
  const resolved = resolveConstants({ cell, baseConstants, label });
  resolved.homeAway = { ...(resolved.homeAway || {}), useStoredHistory: true };
  return resolved;
}

/**
 * Fail loud unless a cell's "on-stored" twin differs from it in EXACTLY the
 * `homeAway.useStoredHistory` leaf and nothing else - analogous to
 * `assertSaltAffectsOnlyHashValue`, so a bug in constructing the on-stored
 * variant is caught structurally, before any numeric comparison runs
 * downstream (PHASE5_EXECUTION_SPEC.md section 8.6.1).
 */
function assertOnlyStoredHistoryLeafDiffers({ baseResolved, storedResolved, label = 'arms' }) {
  if (!baseResolved.homeAway || baseResolved.homeAway.useStoredHistory === true) {
    throw new Error(`${label}: the base variant must NOT have useStoredHistory === true`);
  }
  if (!storedResolved.homeAway || storedResolved.homeAway.useStoredHistory !== true) {
    throw new Error(`${label}: the on-stored variant must have useStoredHistory === true`);
  }
  const stripLeaf = (resolved) => {
    const clone = JSON.parse(JSON.stringify(resolved));
    if (clone.homeAway) delete clone.homeAway.useStoredHistory;
    return clone;
  };
  if (canonicalJson(stripLeaf(baseResolved)) !== canonicalJson(stripLeaf(storedResolved))) {
    throw new Error(
      `${label}: the on-stored variant differs from its twin in more than just ` +
      'homeAway.useStoredHistory - a bug in constructing the variant.'
    );
  }
  return true;
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

/**
 * Runtime, exhaustive-over-what-actually-runs salt-collision guard
 * (PHASE5_EXECUTION_SPEC.md section 3.4, item 5): for one evaluated
 * player-week, assert the 24 salt-derived final seeds it used are pairwise
 * distinct. Complements the unit-test-level check (illustrative, not
 * exhaustive); this one runs against every real seed the authoritative
 * sweep actually computes, and aborts the sweep the instant a real
 * collision is detected.
 */
function assertSaltsProduceDistinctSeeds({ seedsBySalt, label = 'salt seed collision' }) {
  const bySeed = new Map();
  for (const salt of Object.keys(seedsBySalt)) {
    const seed = seedsBySalt[salt];
    if (bySeed.has(seed)) {
      throw new Error(
        `${label}: salts ${bySeed.get(seed)} and ${salt} produced the identical final seed (${seed}). ` +
        'The 24 salts must be pairwise distinct in seed space; a real collision means two salts would ' +
        'have scored the same simulation draw, silently reducing the effective replicate count.'
      );
    }
    bySeed.set(seed, salt);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The two point-identity assertions (prereg 7.3)
// ---------------------------------------------------------------------------

/**
 * Scan the RAW input (a raw `playerIds` array, or raw SQL rows already
 * mapped to their key) for repeated keys, BEFORE any Map-building loop is
 * allowed to run (PHASE5_EXECUTION_SPEC.md section 8.6.4). A length-vs-Map-
 * size comparison performed AFTER the Map is built is too late: last-wins
 * reduction has already silently discarded the duplicate by then.
 */
function assertNoDuplicateRawIds(ids, label = 'duplicate check') {
  if (!Array.isArray(ids)) {
    throw new Error(`${label}: raw id list must be an array, scanned before any Map is built`);
  }
  const seen = new Set();
  const dupes = new Set();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  if (dupes.size > 0) {
    throw new Error(
      `${label}: ${dupes.size} duplicate id(s) in the raw input, found by scanning BEFORE any ` +
      `Map-building loop ran: ${[...dupes].slice(0, 5).join(', ')}`
    );
  }
  return true;
}

/** Exact key-set equality (not merely equal count) and independent cardinality equality. */
function assertMatchedKeySets(mapA, mapB, label = 'key-set check') {
  if (mapA.size !== mapB.size) {
    throw new Error(`${label}: cardinality differs - ${mapA.size} vs ${mapB.size}`);
  }
  const keysA = new Set(mapA.keys());
  const keysB = new Set(mapB.keys());
  const onlyA = [...keysA].filter((k) => !keysB.has(k));
  const onlyB = [...keysB].filter((k) => !keysA.has(k));
  if (onlyA.length > 0 || onlyB.length > 0) {
    throw new Error(
      `${label}: player-key sets differ - present only on side A: ${onlyA.slice(0, 5).join(', ')}; ` +
      `present only on side B: ${onlyB.slice(0, 5).join(', ')}`
    );
  }
  return true;
}

/**
 * `usage-25 x off` must be BIT-IDENTICAL to the shipped control.
 *
 * They are the same configuration by construction, so any difference means the
 * harness introduced one - a different code path, a different seed, a different
 * rounding. Bit-identity, not approximate equality, because there is no
 * legitimate source of even a last-digit difference.
 *
 * Deliberately generic: `controlRun`/`usage25OffRun` are compared as PLAIN
 * canonicalizable values via `canonicalJson`, whatever they are - a full run
 * summary, a single per-projection object, or (as `controlCellEvaluator.js`'s
 * `resolveControlConstants` already does, Commit A6) two independently-
 * derived RESOLVED-CONSTANTS objects. **Callers must never pass a value that
 * contains a `Map`** (`canonicalJson` serializes a `Map` to the literal
 * string `"{}"`, since `Object.keys` on a Map returns `[]`, silently, with
 * no throw - which would make this function compare `"{}"` against `"{}"`
 * and report a vacuous pass). `assertProjectionRunBitIdentical` below is the
 * Map-safe wrapper for the sealed `usage-25 == control` run-level assertion
 * (PHASE5_EXECUTION_SPEC.md section 8.6.0) - it calls this function once per
 * paired per-projection object, never on a whole `generateProjections`
 * return value.
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
 * The sealed `usage-25 == control` run-level bit-identity assertion
 * (PHASE5_EXECUTION_SPEC.md section 8.6.0), Map-safe. `controlRun`/
 * `usage25OffRun` MUST be `generateProjections`-shaped: `{ projections:
 * Map<playerId, projection>, inputCutoff, sourceCoverage }`. This function
 * never hands either Map to `canonicalJson` directly; instead it performs
 * the required procedure itself: raw-input uniqueness -> exact key-set/
 * cardinality equality -> per-player pairing by `playerId`, comparing each
 * pair via `assertControlBitIdentity` (so the per-projection comparison
 * itself is the same well-tested plain-object bit-identity check) ->
 * the two named non-Map fields (`inputCutoff`, `sourceCoverage`) compared
 * separately. No allowlist applies to the per-projection comparison -
 * unlike `assertHomeAwayStoredPointIdentity`, every field must match,
 * including provenance metadata, since two runs of the identical
 * configuration have no reason to differ in it either.
 */
function assertProjectionRunBitIdentical({
  controlRun, usage25OffRun, controlPlayerIds, usage25OffPlayerIds, label = 'usage-25 identity',
}) {
  if (!controlRun || !(controlRun.projections instanceof Map)) {
    throw new Error(`${label}: controlRun must be a generateProjections-shaped object with a projections Map`);
  }
  if (!usage25OffRun || !(usage25OffRun.projections instanceof Map)) {
    throw new Error(`${label}: usage25OffRun must be a generateProjections-shaped object with a projections Map`);
  }
  assertNoDuplicateRawIds(controlPlayerIds, `${label}: control raw playerIds`);
  assertNoDuplicateRawIds(usage25OffPlayerIds, `${label}: usage-25 x off raw playerIds`);
  assertMatchedKeySets(controlRun.projections, usage25OffRun.projections, `${label}: projections`);

  const differences = [];
  for (const [playerId, controlProjection] of controlRun.projections) {
    const usageProjection = usage25OffRun.projections.get(playerId);
    try {
      assertControlBitIdentity({ controlRun: controlProjection, usage25OffRun: usageProjection, label });
    } catch {
      differences.push(`playerId ${playerId}`);
    }
  }
  const nonMapFields = ['inputCutoff', 'sourceCoverage'];
  for (const field of nonMapFields) {
    const a = Object.prototype.hasOwnProperty.call(controlRun, field) ? controlRun[field] : null;
    const b = Object.prototype.hasOwnProperty.call(usage25OffRun, field) ? usage25OffRun[field] : null;
    if (canonicalJson(a) !== canonicalJson(b)) differences.push(field);
  }
  if (differences.length > 0) {
    throw new Error(
      `${label}: usage-25 x off is not bit-identical to the control on ${differences.length} value(s) ` +
      `(${differences.slice(0, 3).join('; ')}). They are the SAME configuration, so a difference means ` +
      'the harness introduced one rather than the model.'
    );
  }
  return true;
}

/**
 * The complete fresh-vs-fresh allowlist (PHASE5_EXECUTION_SPEC.md section
 * 8.6.2), every numeric/nullable path verified against `projectPlayer`'s
 * actual return shape. Dot-paths, checked with own-property presence at
 * every segment - never bracket-access-returns-undefined, never `in`.
 */
const FRESH_VS_FRESH_ALLOWLIST = Object.freeze([
  'mean', 'median', 'p10', 'p25', 'p75', 'p90', 'activeProbability', 'sampleSize', 'effectiveGames',
  'factors.recentProduction.perGame', 'factors.recentProduction.pointsContribution',
  'factors.recentProduction.effectiveGames', 'factors.recentProduction.games',
  'factors.recentProduction.pointsBaselinePerGame', 'factors.recentProduction.opportunityValue',
  'factors.recentProduction.expectedOpportunities', 'factors.recentProduction.opportunityEfficiency',
  'factors.recentProduction.usageGames', 'factors.recentProduction.usageBlendWeight',
  'factors.opponent.effect', 'factors.opponent.pointsContribution', 'factors.opponent.games',
  'factors.opponent.allowedPerGame', 'factors.opponent.leagueAveragePerGame',
  'factors.versusOpponent.effect', 'factors.versusOpponent.pointsContribution',
  'factors.versusOpponent.meetings', 'factors.versusOpponent.observedDeviation',
  'factors.homeAway.effect', 'factors.homeAway.pointsContribution', 'factors.homeAway.games',
  'factors.homeAway.homeGames', 'factors.homeAway.awayGames',
  'factors.weather.effect', 'factors.weather.pointsContribution', 'factors.weather.temperatureF',
  'factors.weather.windSpeedMph', 'factors.weather.windGustMph', 'factors.weather.precipitationProbability',
  'factors.availability.activeProbability',
  'factors.role.pointsContribution',
]);

/**
 * The cache-compatible allowlist (PHASE5_EXECUTION_SPEC.md section 8.6.3),
 * frozen directly against `loadCachedRows`'s own mapped shape, not derived
 * by subtraction from the fresh-vs-fresh list. The only field it excludes
 * relative to the fresh list is the TOP-LEVEL `effectiveGames` (the nested
 * `factors.recentProduction.effectiveGames` round-trips fine).
 */
const CACHE_COMPATIBLE_ALLOWLIST = Object.freeze(
  FRESH_VS_FRESH_ALLOWLIST.filter((path) => path !== 'effectiveGames')
);

function hasOwnPath(obj, path) {
  const segments = path.split('.');
  let cur = obj;
  for (const segment of segments) {
    if (cur === null || typeof cur !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(cur, segment)) return false;
    cur = cur[segment];
  }
  return true;
}

function getByPath(obj, path) {
  return path.split('.').reduce(
    (cur, segment) => (cur === null || typeof cur !== 'object' ? undefined : cur[segment]),
    obj
  );
}

/**
 * `homeaway-on-stored` must be POINT-IDENTICAL to `homeaway-on`, over the
 * allowlisted numeric/nullable paths only (PHASE5_EXECUTION_SPEC.md section
 * 8.6.4). Point-identical rather than bit-identical because the two paths
 * can carry different provenance metadata; what must not differ is any
 * published number. Runs the four steps IN ORDER: (1) own-property
 * presence per side; (2) per-side type/finiteness validation, INDEPENDENTLY
 * on each side, before any cross-side comparison, so a one-sided NaN/
 * string/object hard-errors instead of degrading into an ordinary
 * missing-path mismatch; (3) three-state missing/null handling; (4)
 * `roundToTie` equality for two present finite numbers.
 */
function assertHomeAwayStoredPointIdentity({
  storedRun, computedRun, allowlist = FRESH_VS_FRESH_ALLOWLIST, label = 'homeAway identity',
}) {
  const differences = [];
  for (const path of allowlist) {
    const storedPresent = hasOwnPath(storedRun, path);
    const computedPresent = hasOwnPath(computedRun, path);
    for (const [present, obj, side] of [
      [storedPresent, storedRun, 'stored'],
      [computedPresent, computedRun, 'computed'],
    ]) {
      if (!present) continue;
      const value = getByPath(obj, path);
      if (!(value === null || isFiniteNumber(value))) {
        throw new Error(
          `${label}: ${path} on the ${side} side is present but neither null nor a finite number ` +
          `(${JSON.stringify(value)}). The allowlist contains only numeric/nullable paths, so this ` +
          'is a structural defect independent of any comparison.'
        );
      }
    }
    if (!storedPresent && !computedPresent) continue;
    if (storedPresent !== computedPresent) {
      differences.push(`${path}: missing on one side (stored=${storedPresent}, computed=${computedPresent})`);
      continue;
    }
    const a = getByPath(storedRun, path);
    const b = getByPath(computedRun, path);
    if (a === null || b === null) {
      if (a !== b) differences.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      continue;
    }
    if (roundToTie(a) !== roundToTie(b)) differences.push(`${path}: ${a} vs ${b}`);
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
/**
 * Below this realized mean |b|, the margin is unreachable (prereg 9.8).
 *
 * Corrected from `DELTA_F / MAX_EFFECT` (0.50) per PHASE5_EXECUTION_SPEC.md
 * section 6.1: production rounds every simulated median to 2 decimals
 * BEFORE scoring, so `inc <= |b|*|e| + 0.01` rather than `inc <= |b|*|e|`.
 * This is a substantive prospective amendment (it changes which cells are
 * evaluable), not a mechanical consequence.
 */
const FALSIFIABILITY_FLOOR = (DELTA_F - 0.01) / MAX_EFFECT; // 0.30
/**
 * Veto-incapable disclosure threshold, used exclusively inside the
 * transparency block's `catastrophicCapCouldFire` disclosure. Never gates
 * the veto itself (which fires strictly on the directly-measured
 * `inc > CATASTROPHIC_CAP`), so this correction cannot change any verdict -
 * a mechanical rounding correction (PHASE5_EXECUTION_SPEC.md section 6.1).
 */
const CATASTROPHIC_CAP_COULD_FIRE_THRESHOLD = (CATASTROPHIC_CAP - 0.01) / MAX_EFFECT; // 3.80

/**
 * `favorablePositive`: false (default) for a favorable-NEGATIVE inequality
 * (regret, MAE, RMSE, WIS - lower delta is better, e.g. component (f)'s
 * f1/f2), true for a favorable-POSITIVE one (pairwise, coverage, rho -
 * higher delta is better). Per PHASE5_EXECUTION_SPEC.md section 4.4 item 4:
 * the statistic is never negated without also negating the margin. `x =
 * delta` and `margin* = margin` when `favorablePositive` is false (the
 * component (f) default, unchanged); `x = -delta` and `margin* = -margin`
 * when `favorablePositive` is true. The reported bound is de-normalized
 * back to the metric's own natural sign, and compared against the
 * ORIGINAL (non-negated) `margin`, before publication.
 */
function exactSignTest({
  weekDeltas, margin = DELTA_F, alpha = COMPONENT_ALPHA, favorablePositive = false, label = 'component (f)',
}) {
  const sign = favorablePositive ? -1 : 1;
  const effectiveMargin = sign * margin;
  // Section 4.4 item 1: count distinct values AFTER ten-decimal
  // (roundToTie) normalization - already the case here via `roundToTie`.
  const pairs = weekDeltas.map((d) => {
    const x = sign * Number(d);
    return { x, shifted: roundToTie(x - effectiveMargin) };
  });
  const nonTiedPairs = pairs.filter((p) => p.shifted !== 0);
  const n = nonTiedPairs.length;
  const k = nonTiedPairs.filter((p) => p.shifted < 0).length;
  if (n === 0) {
    return {
      evaluable: false,
      reason: 'every week tied exactly on the shifted margin, so the sign test has no information',
      n: 0, k: 0, p: null, bound: null, passes: false,
    };
  }
  const p = binomialUpperTail(n, k);
  // The inverted one-sided bound: the order statistic X_(j) with
  // j = min{ i : P(Bin(n,1/2) >= i) <= alpha }. No such i means +infinity.
  // Section 4.4 item 2: the sorted array is built from the SAME non-tied
  // subset (of unshifted x-values) that produced n and k - never the full,
  // untrimmed weekDeltas array, which would index the wrong order statistic
  // whenever any week ties out.
  let j = null;
  for (let i = 1; i <= n; i++) {
    if (binomialUpperTail(n, i) <= alpha) { j = i; break; }
  }
  const sortedX = nonTiedPairs.map((pr) => pr.x).sort((a, b) => a - b);
  const boundX = j === null ? Infinity : sortedX[j - 1];
  const passes = p <= alpha;
  // De-normalize the bound back to the metric's own natural sign, and
  // report/compare against the ORIGINAL (non-negated) margin.
  const bound = j === null ? Infinity : sign * boundX;
  // The test and the bound are the same procedure, so they cannot disagree.
  // In natural-sign terms: favorable-negative passes iff bound < margin;
  // favorable-positive passes iff bound > margin (x-space: boundX < margin*).
  const boundAgrees = j === null
    ? !passes
    : (favorablePositive ? bound > margin : bound < margin) === passes;
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
    // a gate that must bind. Both operands are roundToTie-normalized
    // (PHASE5_EXECUTION_SPEC.md section 6.2) so a genuine boundary value is
    // never misclassified by floating-point representation noise.
    catastrophicCapCouldFire: isFiniteNumber(maxAbsBaseline)
      ? roundToTie(Number(maxAbsBaseline)) > roundToTie(CATASTROPHIC_CAP_COULD_FIRE_THRESHOLD)
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
  if (!isFiniteNumber(meanAbsBaseline)
    || roundToTie(Number(meanAbsBaseline)) <= roundToTie(FALSIFIABILITY_FLOOR)) {
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
  const vetoRows = incrementalErrors.filter(
    (inc) => isFiniteNumber(inc) && roundToTie(Number(inc)) > roundToTie(CATASTROPHIC_CAP)
  );
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

/** The favorable boundary is always 0 (section 8.1). */
const FAVORABLE_BOUNDARY = 0;

/**
 * The complete signed-boundary table (section 8.1), keyed exactly by
 * `sweepEvaluator.E2_ENDPOINT_KEYS` for the thirteen (e2) rows, and by
 * `<component>-regret`/`<component>-pairwise` for the co-primary components.
 * Frozen here, once, as the single source of truth for every passing/
 * harmful boundary and direction a runtime wiring this table needs - never
 * re-typed or re-derived at a call site.
 *
 * **Component (b), (c), (d) are zero-margin** (`passing = harmful = 0`) per
 * section 8.1's table - this is the one place this codebase can state that
 * without knowing what (b)/(c)/(d) measure beyond "a co-primary regret+
 * pairwise pair at zero margin"; their SUBJECT MATTER (which contrast feeds
 * each) is out of this table's scope and must come from whatever assembles
 * their `weekDeltas`.
 */
const SIGNED_BOUNDARY_TABLE = Object.freeze({
  'a-regret': Object.freeze({ passingBoundary: -DELTA_R, harmfulBoundary: DELTA_R, direction: 'below' }),
  'a-pairwise': Object.freeze({ passingBoundary: DELTA_P, harmfulBoundary: -DELTA_P, direction: 'above' }),
  'b-regret': Object.freeze({ passingBoundary: 0, harmfulBoundary: 0, direction: 'below' }),
  'b-pairwise': Object.freeze({ passingBoundary: 0, harmfulBoundary: 0, direction: 'above' }),
  'c-regret': Object.freeze({ passingBoundary: 0, harmfulBoundary: 0, direction: 'below' }),
  'c-pairwise': Object.freeze({ passingBoundary: 0, harmfulBoundary: 0, direction: 'above' }),
  'd-regret': Object.freeze({ passingBoundary: 0, harmfulBoundary: 0, direction: 'below' }),
  'd-pairwise': Object.freeze({ passingBoundary: 0, harmfulBoundary: 0, direction: 'above' }),
  'e1-regret': Object.freeze({ passingBoundary: DELTA_R, harmfulBoundary: DELTA_R, direction: 'below' }),
  'e1-pairwise': Object.freeze({ passingBoundary: -DELTA_P, harmfulBoundary: -DELTA_P, direction: 'above' }),
  coverage: Object.freeze({ passingBoundary: -0.01, harmfulBoundary: -0.01, direction: 'above' }),
  'mae-2025': Object.freeze({ passingBoundary: 0.10, harmfulBoundary: 0.10, direction: 'below' }),
  'mae-2024': Object.freeze({ passingBoundary: 0.10, harmfulBoundary: 0.10, direction: 'below' }),
  'rmse-2025': Object.freeze({ passingBoundary: 0.15, harmfulBoundary: 0.15, direction: 'below' }),
  'rmse-2024': Object.freeze({ passingBoundary: 0.15, harmfulBoundary: 0.15, direction: 'below' }),
  'rho-2025': Object.freeze({ passingBoundary: -0.005, harmfulBoundary: -0.005, direction: 'above' }),
  'rho-2024': Object.freeze({ passingBoundary: -0.005, harmfulBoundary: -0.005, direction: 'above' }),
  'wis-2025': Object.freeze({ passingBoundary: 0.10, harmfulBoundary: 0.10, direction: 'below' }),
  'wis-2024': Object.freeze({ passingBoundary: 0.10, harmfulBoundary: 0.10, direction: 'below' }),
  'standard-regret-2025': Object.freeze({ passingBoundary: DELTA_R, harmfulBoundary: DELTA_R, direction: 'below' }),
  'standard-pairwise-2025': Object.freeze({ passingBoundary: -DELTA_P, harmfulBoundary: -DELTA_P, direction: 'above' }),
  'full-ppr-regret-2025': Object.freeze({ passingBoundary: DELTA_R, harmfulBoundary: DELTA_R, direction: 'below' }),
  'full-ppr-pairwise-2025': Object.freeze({ passingBoundary: -DELTA_P, harmfulBoundary: -DELTA_P, direction: 'above' }),
});

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
 * test. A missing component FAILS the claim.
 *
 * The complete, corrected Level-2 cell table (PHASE5_EXECUTION_SPEC.md
 * section 8.2), precedence `vetoed > fail > inconclusive > pass`:
 *   - any component `missing` -> fail (prereg 9.1, 10.4);
 *   - a component `unevaluable` because n < 15 -> fail (prereg 10.4's own text);
 *   - component (f) `unevaluable`, for ANY of its three causes -> inconclusive
 *     (prereg 9.8's own explicit override; ONLY (f) gets this exception - a
 *     non-(f) component `unevaluable` for any other reason is prereg 9.1's
 *     unmodified default, fail);
 *   - any component `wide-straddle` -> inconclusive (prereg 10.6);
 *   - activation shortfall, `on`-cells only -> inconclusive (prereg 11.2),
 *     passed in via the optional `activation` parameter;
 *   - a component `failed` -> fail (prereg 9.1);
 *   - component (f) veto fires (`component.status === 'vetoed'`) -> vetoed
 *     (prereg 9.8, section 6.4) - the one cell-level outcome outside
 *     fail/inconclusive/pass, and the only one that outranks a `fail`.
 */
function evaluateClaim({ cell, components, activation = null, label = 'claim' }) {
  const required = ['a', 'b', 'c', 'd', 'e1', 'e2', 'f'];
  const results = {};
  const failures = [];
  const inconclusive = [];
  const vetoedReasons = [];

  for (const key of required) {
    const component = components[key];
    if (component === undefined) {
      results[key] = { status: 'missing', passes: false };
      failures.push(`${key} is missing`);
      continue;
    }
    if (component.applicable === false) {
      // Vacuous by DEFINITION, never by test - and the divisor stays 7.
      results[key] = { status: 'not-applicable', passes: true };
      continue;
    }
    if (component.status === 'vetoed') {
      if (key !== 'f') {
        throw new Error(`${label}: only component (f) may report status 'vetoed', got it from ${key}`);
      }
      results[key] = { status: 'vetoed', passes: false, reason: component.reason };
      vetoedReasons.push(`${key}: ${component.reason || 'vetoed'}`);
      continue;
    }
    if (component.status === 'unevaluable') {
      results[key] = { status: 'unevaluable', passes: false, reason: component.reason };
      // Only component (f) has a named inconclusive exception. Every other
      // component's unevaluable outcome is prereg 9.1's unmodified default: fail.
      if (key === 'f') inconclusive.push(`${key}: ${component.reason}`);
      else failures.push(`${key}: ${component.reason}`);
      continue;
    }
    if (component.status === 'wide-straddle') {
      results[key] = { status: 'wide-straddle', passes: false, reason: component.reason };
      inconclusive.push(`${key}: wide-straddle (${component.reason || 'interval spans both boundaries'})`);
      continue;
    }
    results[key] = { status: component.passes ? 'passed' : 'failed', passes: !!component.passes };
    if (!component.passes) failures.push(`${key} failed`);
  }

  if (activation && activation.verdict === 'inconclusive') {
    inconclusive.push(`activation: ${activation.detail}`);
  }

  // Precedence: vetoed > fail > inconclusive > pass. A cell that is ALSO
  // independently vetoed or failed for an unrelated reason keeps that status
  // regardless of an activation shortfall or wide-straddle also being true.
  let verdict = 'pass';
  if (vetoedReasons.length > 0) verdict = 'vetoed';
  else if (failures.length > 0) verdict = 'fail';
  else if (inconclusive.length > 0) verdict = 'inconclusive';

  return {
    cell,
    verdict,
    components: results,
    failures,
    inconclusive,
    vetoedReasons,
    activation: activation || null,
    alpha: COMPONENT_ALPHA,
    divisor: 7,
    detail: verdict === 'pass' ? 'every component passes at alpha/7'
      : verdict === 'vetoed' ? `vetoed: ${vetoedReasons.join('; ')}`
        : verdict === 'fail' ? `failed: ${failures.join('; ')}`
          : `inconclusive: ${inconclusive.join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// The signed-boundary endpoint reducer (prereg 10.6, sections 8.1-8.2)
// ---------------------------------------------------------------------------

/**
 * Level 4, ONE non-(f) endpoint, NOT exact-triggered: classify a fully-
 * computed bootstrap CI against its signed boundaries (section 8.1).
 *
 * `direction`: `'below'` when the upper bound must clear BELOW
 * `passingBoundary` (favorable-negative: regret, MAE, RMSE, WIS), `'above'`
 * when the lower bound must clear ABOVE it (favorable-positive: pairwise,
 * coverage, rho). `favorableBoundary` is always 0 (section 8.1). Wide-
 * straddle requires `harmfulBoundary !== favorableBoundary` - the zero-
 * margin endpoints (b, c, d) have `passing = harmful = 0`, so both rules
 * coincide trivially and wide-straddle can never fire for them by
 * construction; a non-passing outcome there falls to the exhaustive
 * catch-all, `threshold-not-established`.
 */
function classifyBootstrapEndpoint({
  evaluable, reason = null, lower = null, upper = null,
  favorableBoundary = FAVORABLE_BOUNDARY, passingBoundary, harmfulBoundary, direction,
}) {
  if (!evaluable) {
    return { status: 'unevaluable', passes: false, reason: reason || 'the bootstrap distribution was not evaluable' };
  }
  if (!isFiniteNumber(lower) || !isFiniteNumber(upper)) {
    throw new Error('classifyBootstrapEndpoint: an evaluable endpoint must carry a finite lower and upper bound');
  }
  const passes = direction === 'below' ? upper < passingBoundary : lower > passingBoundary;
  if (harmfulBoundary !== favorableBoundary) {
    const lo = Math.min(favorableBoundary, harmfulBoundary);
    const hi = Math.max(favorableBoundary, harmfulBoundary);
    if (lower <= lo && upper >= hi) {
      return {
        status: 'wide-straddle',
        passes: false,
        reason: `the interval [${lower}, ${upper}] spans both the favorable boundary `
          + `(${favorableBoundary}) and the harmful boundary (${harmfulBoundary})`,
      };
    }
  }
  return {
    status: passes ? 'passed' : 'threshold-not-established',
    passes,
    reason: passes ? null : 'fully evaluated, but did not clear the passing boundary and did not wide-straddle',
  };
}

/**
 * Level 4, ONE non-(f) endpoint, exact-triggered (section 4.2's AND rule,
 * section 8.2's triggered precedence): `bootstrap` is a
 * `classifyBootstrapEndpoint`-shaped result (or `{ evaluable: false, reason
 * }`), `exact` is an `exactSignTest`-shaped result. Exact-side non-
 * estimability ALWAYS takes precedence over a bootstrap-side wide-straddle -
 * an endpoint must be fully evaluated (both procedures produced a usable
 * result) before wide-straddle can even apply. Agreement gives
 * `passed`/`threshold-not-established`; disagreement gives
 * `threshold-not-established`, never `unevaluable` (both procedures WERE
 * computed).
 */
function classifyTriggeredEndpoint({ bootstrap, exact }) {
  if (!exact.evaluable) {
    return { status: 'unevaluable', passes: false, reason: `exact side: ${exact.reason}` };
  }
  if (bootstrap.status === 'unevaluable' || bootstrap.evaluable === false) {
    return {
      status: 'unevaluable', passes: false, reason: `bootstrap side: ${bootstrap.reason || 'not evaluable'}`,
    };
  }
  if (bootstrap.status === 'wide-straddle') {
    return { status: 'wide-straddle', passes: false, reason: bootstrap.reason };
  }
  const agree = bootstrap.passes === exact.passes;
  if (agree && bootstrap.passes) {
    return { status: 'passed', passes: true, reason: null };
  }
  return {
    status: 'threshold-not-established',
    passes: false,
    reason: agree
      ? 'both the bootstrap and exact procedures agree the endpoint does not clear the passing boundary'
      : 'the bootstrap and exact procedures disagree; both were computed, so this is not unevaluable',
  };
}

/**
 * Level 1: the whole authoritative run is `valid` or `void` (section 8.2).
 * `void` PREEMPTS the entire cell-level table rather than being one more row
 * in it - a canary failure, a permutation-control threshold miss (section
 * 5), or either sealed identity assertion failing (section 8.6) all void
 * the run, never just one cell.
 */
function classifyRun({
  canariesPassed = true, permutationControlPassed = true, identityAssertionsPassed = true,
}) {
  const reasons = [];
  if (!canariesPassed) reasons.push('a canary failed (prereg 17)');
  if (!permutationControlPassed) {
    reasons.push('the permutation control missed its threshold on at least one endpoint (section 5)');
  }
  if (!identityAssertionsPassed) reasons.push('a sealed identity assertion failed (section 8.6)');
  return {
    status: reasons.length > 0 ? 'void' : 'valid',
    reasons,
    detail: reasons.length > 0
      ? `void: ${reasons.join('; ')}`
      : 'valid: every canary, the permutation control, and both sealed identity assertions passed',
  };
}

/**
 * Level 5: SELECTION, the frozen order (section 8.5). Step 2's winner-only
 * branch is retained for structural completeness but is provably
 * unreachable under the current, configuration-only parsimony order
 * (`selectByParsimony`'s total order is a pure function of each cell's own
 * configuration, never of a point estimate or lineup-ordering variant) - kept
 * as defense in depth only, per the sealed reasoning.
 */
function selectAtLevel5({
  runStatus, passingCells, orderingDisagreement = false, deployedPolicyDisagreement = false, label = 'selection',
}) {
  if (runStatus === 'void') {
    return { outcome: 'no-selection', reasons: ['the run is void; no selection is meaningful'] };
  }
  if (orderingDisagreement || deployedPolicyDisagreement) {
    const reasons = [];
    if (orderingDisagreement) {
      reasons.push(
        'a sensitivity ordering disagrees with the primary ordering about which cell the parsimony '
        + 'order would select (section 8.4)'
      );
    }
    if (deployedPolicyDisagreement) {
      reasons.push('deployed-policy/force-fill disagreement (prereg 5.3): NO SELECTION OCCURS');
    }
    return { outcome: 'no-proposal', reasons };
  }
  if (!Array.isArray(passingCells) || passingCells.length === 0) {
    return { outcome: 'no-proposal', reasons: ['none passed'] };
  }
  const { selected, ranked, reason } = selectByParsimony({ passingCells, label });
  return { outcome: 'selected', selected, ranked, reason };
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
  CATASTROPHIC_CAP_COULD_FIRE_THRESHOLD,
  cellName,
  resolveConstants,
  resolveConstantsWithStoredHistory,
  assertOnlyStoredHistoryLeafDiffers,
  constantsHash,
  assertNoCrossSeason,
  assertDistinctConstants,
  buildFamily,
  assertSaltAffectsOnlyHashValue,
  assertSaltsProduceDistinctSeeds,
  assertNoDuplicateRawIds,
  assertMatchedKeySets,
  assertControlBitIdentity,
  assertProjectionRunBitIdentical,
  assertHomeAwayStoredPointIdentity,
  FRESH_VS_FRESH_ALLOWLIST,
  CACHE_COMPATIBLE_ALLOWLIST,
  hasOwnPath,
  getByPath,
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
  FAVORABLE_BOUNDARY,
  SIGNED_BOUNDARY_TABLE,
  classifyBootstrapEndpoint,
  classifyTriggeredEndpoint,
  classifyRun,
  selectAtLevel5,
  parsimonyKey,
  selectByParsimony,
};
