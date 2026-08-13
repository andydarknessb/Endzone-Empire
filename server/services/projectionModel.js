const crypto = require('crypto');

/**
 * `free_baseline_v2` — the pure math behind the weekly start/sit projection
 * engine. No database, no network, no clock: everything here is a function of
 * its arguments, so the whole model is unit-testable and the backtest script
 * can replay it over history without touching a provider.
 *
 * Design rules this file exists to enforce:
 *
 * - Missing evidence stays missing. Every factor returns an explicit
 *   `available: false` (contributing exactly nothing) rather than a zero that
 *   reads like a measurement. A player with no usable history projects `null`,
 *   never 0.
 * - Every number is priced under the CALLER'S scoring rules. Nothing in here
 *   consumes a stored `fantasy_points` value; callers hand in points they
 *   already recomputed with calculateFantasyPoints(stats, rules).
 * - Nothing here is claimed to be the best possible value. Most of the
 *   constants below are conservative DEFAULTS chosen to be hard to embarrass;
 *   the six noted in place (the two shrinkage pseudo-game counts, the
 *   interval scale, the recency half-life, the current-season blend weight and
 *   the opportunity blend weight)
 *   were picked by running scripts/backtest-weekly-projections.js
 *   chronologically over the stored 2024 and 2025 seasons, which makes them
 *   backtest-selected on that history and nothing stronger. They are versioned
 *   with the model so a future re-fit is a visible model-version bump rather
 *   than a silent drift, and that backtest exists specifically to compare
 *   alternatives chronologically before anyone claims one is better.
 */

/**
 * Cache identity for the whole engine, and the reason a constants change is
 * never cosmetic. Cached projection runs are keyed by
 * (season, week, scoring_hash, model_version), so this string is the ONLY
 * thing standing between a row generated under a previous set of constants and
 * that row being served as if it were current. ANY change to MODEL_CONSTANTS
 * therefore requires a bump here, however small the tweak looks: production may
 * already hold rows computed under the old numbers.
 *
 * v3 is that rule being obeyed rather than argued with. The opportunity
 * component (MODEL_CONSTANTS.usage) merged inert at a blend weight of 0, which
 * genuinely could not reach the output and so genuinely did not need a bump;
 * the chronological sweep then selected a weight of 0.25, the component now
 * moves every skill-position projection, and cached v2.2 rows are consequently
 * numbers this code would no longer produce. Serving one would be serving a
 * different model under the current model's name, which is exactly what the
 * key exists to prevent.
 *
 * v3.1 is the same rule applied to a change that is NOT a constants change.
 * No constant moved; what moved is that `simulateDistribution` now canonically
 * sorts its residual pool before sampling it by index, and the league-wide
 * scan in projectionFeatures now orders its rows before the LIMIT. Cached v3
 * rows were drawn from residuals in whatever order Postgres happened to return
 * them, so their medians and quantiles are values this code will not
 * necessarily reproduce. A bump is the only thing that stops one being served
 * as current, and the version string also feeds `seedFrom`, so every draw
 * sequence is re-rolled with it. That re-roll is intended: the whole point is
 * that the old sequences were a function of an input we never controlled.
 */
const MODEL_VERSION = 'free_baseline_v3.1';

/**
 * Model constants. DEFAULTS, not fitted optimums (see the file header).
 * Grouped by the factor they govern so a backtest sweep can override one
 * group without disturbing the rest.
 */
const MODEL_CONSTANTS = {
  baseline: {
    // Exponential recency: a game N weeks before the target week carries
    // weight 0.5^(N / halfLifeWeeks). Eight weeks is deliberately mild, which
    // is the direction the evidence pointed: weekly fantasy scoring is noisy
    // enough that aggressive recency overfits, and every faster half-life in
    // the sweep scored worse.
    //
    // BACKTEST-SELECTED, as a PAIR with currentSeasonMeanBlendWeight below:
    // the two were swept crossed rather than one at a time, and 8 was chosen
    // with 0.25, so neither number carries a separate claim and moving one
    // without re-running the cross invalidates both. The
    // `slow8-blend-25` configuration of scripts/backtest-weekly-projections.js
    // beat the previous 4-week / no-blend defaults on MAE, Spearman rho,
    // pairwise start/sit accuracy and lineup regret in BOTH stored seasons
    // (2025 and 2024). Read that as selected on two seasons of stored results
    // and nothing stronger, and expect a re-fit on more history to move it.
    recencyHalfLifeWeeks: 8,
    // Shrinkage is expressed in PSEUDO-GAMES: how many real games of evidence
    // the fallback is worth. With 1.5, a player's own 1.5 games of recency
    // weight and his prior-season per-game pace count equally.
    //
    // These two values were SELECTED BY the chronological backtest over the
    // stored 2024 and 2025 seasons (scripts/backtest-weekly-projections.js).
    // Its "light-shrink" sweep, which halves the previous 3 / 2 defaults, beat
    // those defaults on MAE, RMSE, Spearman rho, pairwise start/sit accuracy
    // and interval coverage in BOTH seasons with lineup regret unchanged. Read
    // that as backtest-selected on those two seasons and nothing more: two
    // seasons of stored results is a comparison, not a proof, and a re-fit on
    // more history is expected to move them again.
    priorSeasonPseudoGames: 1.5,
    positionPseudoGames: 1,
    // Below this many prior games we never trust the player's own sample
    // alone, even if a fallback is unavailable.
    lowConfidenceGames: 3,
    // How much of the CURRENT season's UNWEIGHTED per-game mean to mix into
    // the shrunk estimate: final = (1 - b) * shrunkValue + b * currentSeasonMean.
    // That flat mean is the incumbent "average what he has done so far this
    // year" estimator, so a quarter-weight is this model conceding that the
    // dumb average carries signal its own weighting throws away.
    //
    // BACKTEST-SELECTED as a PAIR with recencyHalfLifeWeeks above (see that
    // comment): 0.25 was swept crossed with the 8-week half-life, not chosen
    // independently, and the pair is what won on the stored 2024 and 2025
    // seasons. Interval coverage moved to 0.823 / 0.736 against a 0.80 target,
    // the 2025 end sitting a hair above the band on the conservative side.
    //
    // 0 disables the blend entirely: the mean is then never computed and the
    // value is exactly what the shrinkage chain produced, which is what every
    // pre-2.2 cached row was scored under.
    currentSeasonMeanBlendWeight: 0.25,
    // How many "weeks" a season boundary is worth when measuring recency.
    // 18 regular-season weeks plus an 8-week penalty for the offseason: last
    // season's Week 18 is treated as 9 weeks stale in a Week 1 projection, not
    // 1. Without this a veteran's whole prior season would pile up into a
    // high-confidence Week 1 number that a roster change could invalidate.
    seasonWeekSpan: 26,
  },
  // Opportunity-weighted baseline. Volume (pass attempts, carries, targets) is
  // markedly stickier week to week than the efficiency applied to it, so this
  // component projects OPPORTUNITIES and prices them, instead of projecting
  // points directly the way `baseline` does.
  usage: {
    // How much of the final baseline comes from the opportunity component:
    // baseline = (1 - w) * pointsBaseline + w * opportunityValue, applied ONLY
    // when the component produced a real number.
    //
    // BACKTEST-SELECTED on the ENRICHED stored 2024 and 2025 seasons, which is
    // a narrower claim than it sounds: the sweep could only run at all once
    // player_stats carried the usage keys, so it is two seasons of re-scored
    // history and nothing stronger. The `usage-25` configuration of
    // scripts/backtest-weekly-projections.js improved or held every gate
    // metric in BOTH seasons against the v2.2 reference (2025: MAE 4.12 ->
    // 4.11, RMSE 5.95 -> 5.93, rho .594 -> .598, pairwise accuracy .701 ->
    // .703, lineup regret unchanged at 13.76, coverage .828; 2024: MAE
    // unchanged at 4.05, RMSE 5.89 -> 5.88, rho .626 -> .629, pairwise
    // accuracy .709 -> .711, regret unchanged at 12.10, coverage .735). Small,
    // consistent, and in the same direction twice.
    //
    // The heavier arms were REJECTED, and it is worth saying why rather than
    // just recording the winner: `usage-40` and `usage-60` bought a little more
    // rank correlation and gave back lineup regret on 2025 (13.76 -> 14.54).
    // Regret is the metric that measures the decision this app actually makes
    // for a manager, so a config that ranks marginally better while starting a
    // worse lineup fails the gate no matter what rho says.
    blendWeight: 0.25,
    // 0 disables the component outright: `opportunityBaseline` is then never
    // called, no usage fields appear in the explanation, and every number is
    // exactly what v2.2 produced. That is the pre-v3 behavior, still reachable
    // by a caller passing its own constants.
    //
    // The two below were HELD FIXED at these values for the entire weight
    // sweep, so they are starting values that have never been swept
    // individually and carry no backtest claim at all. A future sweep crossing
    // them with the weight is the obvious next comparison.
    //
    // Below this many usage-bearing games the opportunity estimate is too thin
    // to price at all.
    minUsageGames: 3,
    // Shrinkage for points-per-opportunity, denominated in OPPORTUNITIES (not
    // games): the position-wide rate is worth 25 opportunities of evidence,
    // roughly one starter's week of touches, so a player with 100 weighted
    // opportunities behind him is mostly trusted on his own rate and a player
    // with 10 is mostly priced at the league's.
    efficiencyPseudoOpportunities: 25,
  },
  opponent: {
    // Fewest games a defense must have played before its positional
    // allowance is used at all.
    minGames: 4,
    // Shrinkage denominator: the ratio is pulled toward 1.0 with this many
    // pseudo-games of "neutral" evidence.
    shrinkPseudoGames: 6,
    // Hard cap on the opponent factor either way.
    maxEffect: 0.12,
  },
  versusOpponent: {
    // Deliberately weak: head-to-head history is mostly noise about a roster
    // that no longer exists.
    minMeetings: 2,
    halfLifeSeasons: 1.5,
    // The observed deviation is multiplied by this before the cap, so even a
    // wild historical split moves the projection very little.
    shrinkage: 0.15,
    maxEffect: 0.04,
    // Whether a meeting from an EARLIER season may count as a meeting at all.
    // Until the nflverse backfill wrote per-week `gameTeam`/`gameOpponent` into
    // player_stats.stats there was no honest way to say who a prior-season line
    // was earned against (the schedule would have been read through the
    // player's CURRENT team), so buildVersusOpponentMeetings has always been
    // current-season-only. This gates READING those stored keys; rows that lack
    // them are unaffected at any setting.
    //
    // SHIPS FALSE, and false is why adding it does not bump MODEL_VERSION: at
    // this value no code path reads the stored keys and every projection is
    // bit-identical to the one v3 already produced. That is the same
    // inert-merge exception the MODEL_VERSION docblock above records for the
    // usage component, including its other half: the sweep that turns this on
    // is the change that has to carry the bump.
    crossSeason: false,
  },
  homeAway: {
    // Position-level home/away splits need a lot of games before they mean
    // anything; below this the factor is simply unavailable.
    minGamesPerSide: 24,
    shrinkPseudoGames: 120,
    maxEffect: 0.05,
    // Whether this factor may SCORE at all, which is not a tuning knob but a
    // safety catch on a coefficient that has never been measured. No
    // production `nfl_games` row has ever carried orientation — 0 of 544 in
    // each of 2024, 2025 and 2026 — so `homeAwayEffect` has returned neutral
    // for every projection this engine has ever produced, and the ±5% below is
    // a default nobody has backtested against anything. Filling that column is
    // a data repair, and a data repair must not double as the activation of an
    // unvalidated adjustment: the thresholds above are met within about two
    // weeks of real rows, at which point every lineup recommendation would
    // start moving on an unmeasured number.
    //
    // SHIPS FALSE, and false is why adding it does not bump MODEL_VERSION. The
    // check sits BELOW the unknown-orientation check in `homeAwayEffect`, so on
    // today's all-null rows the factor returns the identical 'home/away
    // unknown' payload it has always returned and every projection is
    // bit-identical to the one v3.1 already produced. Same inert-merge
    // exception the MODEL_VERSION docblock records for the usage component and
    // the two stored-history gates, including its other half: the sweep that
    // turns this on is the change that has to carry the bump, and that bump is
    // free_baseline_v3.2.
    enabled: false,
    // Whether a PRIOR-SEASON game's orientation (and the opponent it is
    // resolved with) may be read from the stored per-week `gameTeam` key rather
    // than left unknown. Same enrichment, same gate, same inert-merge exception
    // as versusOpponent.crossSeason above: false means the stored keys are
    // never consulted and prior-season rows keep the null opponent/isHome they
    // have always carried, so MODEL_VERSION does not move.
    useStoredHistory: false,
  },
  weather: {
    // No verified empirical weather effect is wired up (see
    // nwsWeather.service.js): forecasts are surfaced as CONTEXT with a zero
    // point contribution rather than guessed at with a hardcoded penalty.
    maxEffect: 0,
  },
  // Market-implied scoring environment, from a sportsbook game total and
  // spread. The two together imply each team's expected points
  // (`total/2 - spread/2`), which is the single richest public statement
  // about how many points a game will produce - priced by people with money
  // at stake, and available BEFORE kickoff, which is what makes it usable.
  //
  // Nothing in this app has ever consumed it: the pit-sweep-2024-2025 study
  // searched `usage.blendWeight` x `homeAway.enabled` and nothing else, so
  // the market has never been measured against this engine at all.
  gameEnvironment: {
    // How much of a team's scoring-environment deviation reaches ONE player's
    // fantasy points. A team implied for 10% more points does not give every
    // pass-catcher 10% more: some of the surplus lands on players a manager
    // does not roster, some on game script that suppresses volume. 0.5 is a
    // deliberately conservative placeholder and is NOT a measurement.
    responsiveness: 0.5,
    // Below this many implied points the quote is treated as malformed rather
    // than as a real market view; no NFL team has ever been implied for 6.
    minImpliedPoints: 6,
    // SHIPS 0, and 0 is why adding this block does not bump MODEL_VERSION:
    // `clamp(x, 0)` is 0 for every x, so the factor cannot reach the output
    // and every projection is bit-identical to the one v3.1 already produced.
    // Same inert-merge exception the MODEL_VERSION docblock records for the
    // usage component and versusOpponent.crossSeason, including its other
    // half: the sweep that raises this is the change that carries the bump.
    //
    // The derivation below is live and clamped rather than stubbed out (the
    // weather pattern), so raising this cap turns on a formula that has been
    // read and tested, not one written under time pressure on the day.
    maxEffect: 0,
  },
  // Third-party expert-consensus projections, blended at the END of the
  // factor chain rather than into the baseline. A consensus number is a
  // COMPLETE projection that already prices matchup, injury and game script,
  // so blending it into `baseline` and then applying this engine's own
  // opponent/homeAway factors on top would double-count every adjustment the
  // experts already made.
  expertConsensus: {
    // final = (1 - w) * modelProjection + w * expertPoints, applied ONLY for a
    // player the feed actually covers.
    //
    // SHIPS 0: at this weight `expertPoints` is never read into the number and
    // every projection is bit-identical to v3.1's. Same inert-merge exception
    // as `gameEnvironment.maxEffect` above and for the same reason - and the
    // same obligation, that the sweep selecting a non-zero weight is what
    // carries the MODEL_VERSION bump.
    blendWeight: 0,
    // A consensus point value outside this range is refused as malformed
    // rather than blended. Feeds do go wrong, and a single 900 would move a
    // lineup.
    minPoints: -10,
    maxPoints: 80,
  },
  simulation: {
    draws: 400,
    // How far the resampled residuals are stretched about their own median
    // before they are added to the mean. The raw bootstrap is too confident:
    // across every configuration of the chronological backtest, empirical
    // p10-p90 coverage sat near 0.6 against the 0.80 a calibrated band should
    // hit, so a band this app prints as a likely range was wrong about twice
    // as often as it claimed. 1.45 is calibrated on that same stored
    // 2024-2025 backtest (scripts/backtest-weekly-projections.js), which is a
    // calibration on two seasons, not a proof for all of them.
    //
    // The constraint simulateDistribution must keep: the scaling is CENTERED
    // on the residual pool's median, so no value here can shift the point
    // prediction. Scaling residuals about zero instead would amplify a skewed
    // pool's bias into the draw median and quietly re-tune the projection
    // itself, which measurably cost lineup regret on the 2024 backtest.
    intervalScale: 1.45,
    // Fewer residuals than this and the player's own dispersion is not
    // usable; the position-level pooled dispersion is used instead.
    minPlayerResiduals: 3,
    minPooledResiduals: 8,
    // SMOOTHED BOOTSTRAP. Width of the Gaussian kernel each resampled residual
    // is jittered by, as a FRACTION of the shrunk inter-decile spread below.
    //
    // The defect it addresses, measured over the 34 frozen pit-sweep cohort
    // weeks (14,250 player-weeks) with this file's own functions: p10-p90
    // coverage 0.647 against a 0.80 target, and monotone in how many residuals
    // the player has - 0.477 at 3-4 residuals, 0.637 at 5-7, 0.682 at 8-11,
    // 0.696 at 12+. A bootstrap of three points CANNOT express a 10th
    // percentile: every draw is one of three numbers, so the band is bounded
    // by their own min and max and the outcome routinely falls outside the
    // SUPPORT. That is a support defect, not a scale defect, and the
    // measurement says so twice over:
    //   - raising `intervalScale` alone saturates. At 2.5 (width 23.56,
    //     nearly double) coverage still only reaches 0.738, while the 50%
    //     band overshoots to 0.594 and K/DEF reach 0.94. No multiplier
    //     reaches outside a support.
    //   - mixing the position pool in as a second component fixes the tails
    //     and breaks the middle: 0.833 at p10-p90 but 0.342 at p25-p75,
    //     because a two-component mixture's central quantiles are dominated
    //     by the narrow component.
    // Jittering widens the support continuously, in one component, so both
    // intervals move together. At bandwidth 0.20 with intervalScale 1.0 the
    // same measurement gives 0.814 / 0.531 against the 0.80 / 0.50 targets,
    // at intervals 21% NARROWER than shipped, and flattens the by-residual
    // spread from 0.477-0.927 to 0.737-0.897.
    //
    // The smoothing is deliberately SCALE-AGNOSTIC about the point estimate:
    // the re-centring pins the draw median to `mean + median(residuals)` at
    // every intervalScale, including exactly 1 where the bit-compatibility
    // shortcut leaves `origin` as the bare mean. Pinning to `origin` instead
    // would move the point estimate by the median residual at that one value
    // and nowhere else - a discontinuity in a constant this sweep varies.
    //
    // SHIPS 0, and 0 is why this does not bump MODEL_VERSION: at zero no
    // jitter is drawn, the re-centring below is skipped, the PRNG is consumed
    // exactly as before and every projection is bit-identical to v3.1's. Same
    // inert-merge exception as the usage component at weight 0.
    //
    // The numbers above come from a harness that omits the opponent, usage and
    // homeAway factors (they need a database), so it measures 0.647 where the
    // published sweep measures 0.745. They are a STARTING POINT for a proper
    // sweep, not a selection - the same mistake that put 1.45 here, calibrated
    // on a different population from the one it now serves.
    smoothingBandwidth: 0,
    // Evidence weight of the position pool when shrinking a player's own
    // spread toward it, in pseudo-observations - the same idiom as
    // `priorSeasonPseudoGames`. Read ONLY when smoothingBandwidth > 0.
    smoothingPseudoResiduals: 8,
  },
  confidence: {
    // Effective sample size (recency-weighted games) thresholds.
    highEffectiveGames: 5,
    mediumEffectiveGames: 2.5,
    // Interval width relative to the mean, above which confidence is capped.
    wideIntervalRatio: 1.6,
  },
  // What the LINEUP OPTIMIZER ranks players by. Distinct from what the UI
  // displays, which stays the median (the distribution's central outcome is
  // the honest single number to print) - this governs only which lineup the
  // optimizer recommends.
  decision: {
    // 'median' (shipped) or 'mean'.
    //
    // The optimizer's objective is the lineup's actual total, and the
    // statistic that maximizes an EXPECTED total is the mean; weekly fantasy
    // scoring is right-skewed, so the two differ per player and the median
    // systematically under-ranks boom players. Measured over the frozen
    // pit-sweep artifacts (1700 roster-weeks, production optimizer, production
    // distributions): mean-ranking cuts lineup regret by 1.90 points per
    // roster-week against median-ranking - 2024 -1.74/wk (t~-1.9) and 2025
    // -2.06/wk (t~-1.9) independently, and the candidate ordering ran exactly
    // as theory predicts (mean < mid-blend < median < p75 < p25). For scale:
    // the entire usage sweep moved regret 0.80, and the preregistered margin
    // was 0.15.
    //
    // SHIPS 'median', the exact behavior production has always had, so this
    // merges inert and MODEL_VERSION does not move. Two reasons it is not
    // flipped here: the measurement above is exploratory (34 paired weeks,
    // reconstructed rosters, no opponent/usage factors in the harness), and
    // flipping changes which lineup the app recommends - that is the change
    // that must ride a preregistered confirmation, not a code merge.
    lineupRanking: 'median',
  },
};

// Position groupings for the opponent / positional-baseline factors. DEF
// (team defense), K and the individual-defender group are kept SEPARATE from
// each other and from offense: they are scored by unrelated rule categories,
// so pooling them would compare unrelated distributions.
const IDP_POSITIONS = new Set([
  'DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS',
]);

/** Pure: a player's position code -> the group its baselines are pooled in. */
function positionGroup(position) {
  const p = String(position || '').toUpperCase();
  if (!p) return null;
  if (IDP_POSITIONS.has(p)) return `IDP_${p}`;
  return p;
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/** Pure: recursively key-sorted JSON, so two equal rule trees serialize identically. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Stable identity for a scoring profile. Two leagues whose effective rules are
 * deep-equal share a hash (and therefore a cached run); any difference at all,
 * including a single tier's points, produces a different hash. Key ORDER never
 * affects it, which matters because rulesForLeague builds its object by
 * merging and pg returns jsonb keys in storage order.
 */
function scoringHash(rules) {
  return crypto.createHash('sha256').update(canonicalJson(rules || {})).digest('hex').slice(0, 32);
}

/** Pure: 32-bit hash of a string, for deriving a simulation seed. */
function seedFrom(...parts) {
  const text = parts.map((p) => String(p)).join('|');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed, same sequence, every process. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * "Is this an actual number?" — and NOT `Number.isFinite(Number(v))`, because
 * `Number(null)` is 0. That coercion is exactly how a missing measurement
 * turns into a confident zero, which is the one thing this model must never
 * do, so null/undefined/''/booleans are rejected explicitly.
 */
function isNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

/** Pure: linear-interpolated quantile of an ASCENDING-sorted numeric array. */
function quantile(sorted, q) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pure: exponential recency weight for a game played `weeksAgo` before the
 * target week. Games from earlier seasons pass the elapsed weeks accumulated
 * across the season boundary, so a Week 1 projection still ranks a player's
 * late-prior-season form above his early-prior-season form.
 */
function recencyWeight(weeksAgo, halfLifeWeeks = MODEL_CONSTANTS.baseline.recencyHalfLifeWeeks) {
  const gap = Math.max(0, Number(weeksAgo) || 0);
  const halfLife = Number(halfLifeWeeks) > 0 ? Number(halfLifeWeeks) : 1;
  return Math.pow(0.5, gap / halfLife);
}

/**
 * Pure: shrink an observed mean toward a prior. `evidence` and `priorWeight`
 * are both in pseudo-game units, so the result is the evidence-weighted
 * average of the two. A null/absent prior returns the observation untouched.
 */
function shrinkToward(observed, evidence, prior, priorWeight) {
  if (!isNum(observed)) return isNum(prior) ? Number(prior) : null;
  if (!isNum(prior) || !(Number(priorWeight) > 0)) return Number(observed);
  const n = Math.max(0, Number(evidence) || 0);
  const w = Number(priorWeight);
  return (n * Number(observed) + w * Number(prior)) / (n + w);
}

// ---------------------------------------------------------------------------
// Baseline production
// ---------------------------------------------------------------------------

/**
 * Pure: recency-weighted per-game baseline from a player's prior league-scored
 * games, shrunk toward his most recent completed-season per-game pace and then
 * toward the position baseline.
 *
 * `priorGames` MUST already exclude the target week and everything after it
 * (see buildGameRecency / the input-cutoff tests) — this function trusts its
 * input and does no filtering of its own beyond ignoring non-numeric points.
 *
 * Returns null when there is neither player history nor any fallback, which is
 * the difference between "no projection" and "projected zero".
 */
function baselineProduction({
  priorGames = [],
  priorSeasonPerGame = null,
  positionBaselinePerGame = null,
  constants = MODEL_CONSTANTS.baseline,
}) {
  const games = (priorGames || []).filter((g) => g && isNum(g.points));
  let weightedSum = 0;
  let weightSum = 0;
  for (const game of games) {
    const w = recencyWeight(game.weeksAgo, constants.recencyHalfLifeWeeks);
    weightedSum += w * Number(game.points);
    weightSum += w;
  }
  // "Effective sample size" is the summed recency weight, not the raw count:
  // six games all a year old are worth far less evidence than three from last
  // month, and confidence should say so.
  const effectiveGames = round2(weightSum);
  const observed = weightSum > 0 ? weightedSum / weightSum : null;

  const afterSeason = shrinkToward(
    observed,
    weightSum,
    isNum(priorSeasonPerGame) ? Number(priorSeasonPerGame) : null,
    constants.priorSeasonPseudoGames
  );
  const evidenceAfterSeason = weightSum
    + (isNum(priorSeasonPerGame) ? constants.priorSeasonPseudoGames : 0);
  const value = shrinkToward(
    afterSeason,
    evidenceAfterSeason,
    isNum(positionBaselinePerGame) ? Number(positionBaselinePerGame) : null,
    constants.positionPseudoGames
  );

  if (!isNum(value)) {
    return { value: null, effectiveGames: 0, sampleSize: 0, usedPriorSeason: false, usedPositionBaseline: false };
  }

  // Optional final step: blend toward the CURRENT season's unweighted mean.
  // Only games flagged `sameSeason` count, so a prior-season game can never
  // leak into a number that claims to describe this year, and the mean is FLAT
  // (no recency weight) on purpose, because that is precisely the estimator
  // this is blending with. Off by default (weight 0), and skipped entirely when
  // the player has no current-season games, because there would be nothing to
  // blend with and inventing a component would be a fabricated measurement.
  const blendWeight = isNum(constants.currentSeasonMeanBlendWeight)
    ? Number(constants.currentSeasonMeanBlendWeight)
    : 0;
  let blended = Number(value);
  if (blendWeight > 0) {
    const currentSeason = games.filter((g) => g.sameSeason);
    if (currentSeason.length > 0) {
      const flatMean =
        currentSeason.reduce((sum, g) => sum + Number(g.points), 0) / currentSeason.length;
      blended = (1 - blendWeight) * Number(value) + blendWeight * flatMean;
    }
  }

  return {
    // `effectiveGames` deliberately stays the recency weight sum: the blend
    // changes the estimate, not how much evidence there is behind it.
    value: blended,
    effectiveGames,
    sampleSize: games.length,
    usedPriorSeason: isNum(priorSeasonPerGame),
    usedPositionBaseline: isNum(positionBaselinePerGame),
  };
}

// ---------------------------------------------------------------------------
// Opportunity-weighted baseline (OFF by default: see MODEL_CONSTANTS.usage)
// ---------------------------------------------------------------------------

/** Position groups whose opportunity count is carries + targets. */
const TOUCH_GROUPS = new Set(['RB', 'WR', 'TE']);

/**
 * Pure: how many scoring opportunities one game represents, or null when that
 * is not knowable.
 *
 * QB is pass attempts. RB/WR/TE are carries PLUS targets, and only when BOTH
 * are present: a receiving back whose carries did not come through in the feed
 * would otherwise be priced as a pure receiver, which is not a thinner
 * measurement but a wrong one. Every other group (K, DEF, the IDP groups) is
 * null by construction — no opportunity denominator this app stores means
 * anything for them, and inventing one would be the fabricated zero this whole
 * file exists to avoid.
 *
 * A null here is not a penalty. It removes the game from the opportunity
 * component entirely; the points-only baseline still sees it.
 */
function opportunitiesForGame(usage, group) {
  if (!usage || typeof usage !== 'object') return null;
  const normalized = positionGroup(group);
  if (!normalized) return null;
  if (normalized === 'QB') {
    return isNum(usage.passAttempts) ? Number(usage.passAttempts) : null;
  }
  if (!TOUCH_GROUPS.has(normalized)) return null;
  // Both, or neither. A missing half is missing data, never a zero.
  if (!isNum(usage.carries) || !isNum(usage.targets)) return null;
  return Number(usage.carries) + Number(usage.targets);
}

/**
 * Pure: a per-game baseline built as EXPECTED OPPORTUNITIES x POINTS PER
 * OPPORTUNITY, both estimated from the player's own usage-bearing prior games.
 *
 * The two halves are deliberately estimated differently:
 *
 * - Opportunities are a recency-weighted MEAN per game, on the same half-life
 *   the points baseline uses (a separate usage half-life would be a second
 *   tuned number nobody has swept).
 * - Efficiency is a recency-weighted RATIO OF SUMS (sum w*points over
 *   sum w*opportunities), not a mean of per-game ratios, so a 3-touch week
 *   cannot swing the rate the way a 25-touch week does. It is then shrunk
 *   toward `efficiencyPrior` (the position group's league-wide rate) with the
 *   evidence measured in OPPORTUNITIES rather than games, which is the unit the
 *   rate is actually per: `efficiencyPseudoOpportunities` is how many
 *   opportunities of league-average scoring the prior is worth.
 *
 * `value` is null — not 0 — whenever there are too few usage-bearing games or
 * no positive expected opportunity count, which is what keeps a player with no
 * enrichment (or a K, or a DEF) contributing nothing here instead of a zero.
 */
function opportunityBaseline({
  priorGames = [],
  group = null,
  efficiencyPrior = null,
  constants = MODEL_CONSTANTS,
} = {}) {
  const baselineConstants = (constants && constants.baseline) || MODEL_CONSTANTS.baseline;
  const usageConstants = { ...MODEL_CONSTANTS.usage, ...((constants && constants.usage) || {}) };

  let weightSum = 0;
  let weightedOpportunities = 0;
  let weightedPoints = 0;
  let usageGames = 0;
  for (const game of priorGames || []) {
    if (!game || !isNum(game.points)) continue;
    const opportunities = opportunitiesForGame(game.usage, group);
    if (opportunities === null) continue;
    const w = recencyWeight(game.weeksAgo, baselineConstants.recencyHalfLifeWeeks);
    weightSum += w;
    weightedOpportunities += w * opportunities;
    weightedPoints += w * Number(game.points);
    usageGames += 1;
  }

  const expectedOpportunities = weightSum > 0 ? weightedOpportunities / weightSum : null;
  // Undefined rather than zero when nobody touched the ball: dividing points by
  // no opportunities is not a 0.0 points-per-touch measurement.
  const observedEfficiency = weightedOpportunities > 0 ? weightedPoints / weightedOpportunities : null;
  const efficiency = shrinkToward(
    observedEfficiency,
    weightedOpportunities,
    isNum(efficiencyPrior) ? Number(efficiencyPrior) : null,
    usageConstants.efficiencyPseudoOpportunities
  );

  const enoughGames = usageGames >= Number(usageConstants.minUsageGames);
  const usable = enoughGames && isNum(expectedOpportunities) && Number(expectedOpportunities) > 0
    && isNum(efficiency);
  return {
    value: usable ? Number(expectedOpportunities) * Number(efficiency) : null,
    usageGames,
    expectedOpportunities: isNum(expectedOpportunities) ? Number(expectedOpportunities) : null,
    efficiency: isNum(efficiency) ? Number(efficiency) : null,
  };
}

// ---------------------------------------------------------------------------
// Factors. Each returns { available, effect, ...context }; `effect` is a
// multiplicative deviation from 1.0 (0 = neutral) and is ALWAYS capped.
// ---------------------------------------------------------------------------

const NEUTRAL = (reason, extra = {}) => ({ available: false, effect: 0, reason, ...extra });

/**
 * Pure: how much more (or less) than a league-average defense this opponent
 * has allowed to the player's position, shrunk toward neutral by how few games
 * we have observed and then capped.
 *
 * Raw "fantasy points allowed" is famously misleading over a handful of games
 * (it mostly measures who a defense happened to play), which is exactly why
 * the shrinkage and the minimum-games gate are not optional here.
 */
function opponentEffect({
  allowedPerGame,
  leagueAveragePerGame,
  games,
  opponentTeam = null,
  constants = MODEL_CONSTANTS.opponent,
} = {}) {
  if (!isNum(allowedPerGame) || !isNum(leagueAveragePerGame) || Number(leagueAveragePerGame) <= 0) {
    return NEUTRAL('no opponent data', { opponentTeam: opponentTeam || null });
  }
  const observedGames = Math.max(0, Number(games) || 0);
  if (observedGames < constants.minGames) {
    return NEUTRAL('insufficient opponent sample', {
      opponentTeam: opponentTeam || null,
      games: observedGames,
    });
  }
  const ratio = Number(allowedPerGame) / Number(leagueAveragePerGame);
  const shrunk =
    (observedGames * ratio + constants.shrinkPseudoGames * 1) /
    (observedGames + constants.shrinkPseudoGames);
  return {
    available: true,
    effect: clamp(shrunk - 1, constants.maxEffect),
    opponentTeam: opponentTeam || null,
    games: observedGames,
    allowedPerGame: round2(allowedPerGame),
    leagueAveragePerGame: round2(leagueAveragePerGame),
  };
}

/**
 * Pure: a deliberately weak "he always plays well against them" factor.
 * Each meeting is compared against the player's own surrounding baseline (so a
 * good game in a good season is not double-counted as a matchup effect),
 * decayed by how many seasons ago it was, multiplied by a heavy shrinkage
 * constant, and finally capped at a few percent. It can nudge a close call; it
 * can never outweigh recent role.
 */
function versusOpponentEffect({ meetings = [], constants = MODEL_CONSTANTS.versusOpponent } = {}) {
  const usable = (meetings || []).filter(
    (m) => m && isNum(m.points) && isNum(m.baseline) && Number(m.baseline) > 0
  );
  if (usable.length < constants.minMeetings) {
    return NEUTRAL('insufficient head-to-head history', { meetings: usable.length });
  }
  let weighted = 0;
  let weight = 0;
  for (const meeting of usable) {
    const seasonsAgo = Math.max(0, Number(meeting.seasonsAgo) || 0);
    const w = Math.pow(0.5, seasonsAgo / constants.halfLifeSeasons);
    weighted += w * (Number(meeting.points) / Number(meeting.baseline) - 1);
    weight += w;
  }
  if (weight <= 0) return NEUTRAL('insufficient head-to-head history', { meetings: usable.length });
  const deviation = weighted / weight;
  return {
    available: true,
    effect: clamp(deviation * constants.shrinkage, constants.maxEffect),
    meetings: usable.length,
    observedDeviation: round2(deviation),
  };
}

/**
 * Pure: empirical home/away effect for the player's position group, derived
 * from prior position-level results only. Returns neutral when the split is
 * unknown (no schedule orientation stored for this game, or a neutral-site
 * game, which has no orientation to be known), when `constants.enabled` has
 * not explicitly authorized the factor to score, or when the sample is too
 * thin to distinguish from noise.
 */
function homeAwayEffect({ isHome = null, sample = null, constants = MODEL_CONSTANTS.homeAway } = {}) {
  if (isHome !== true && isHome !== false) return NEUTRAL('home/away unknown');
  // Fail closed: anything short of an explicit `true` scores nothing, so a
  // constants object assembled without the key cannot activate the adjustment
  // by omission. Deliberately BELOW the unknown-orientation check, because a
  // row with no orientation must keep reporting exactly that — the gate's
  // reason string is reachable only once orientation data exists, which is the
  // property that makes this change bit-identical on today's production rows.
  if (!constants || constants.enabled !== true) return NEUTRAL('home/away gated off');
  if (!sample) return NEUTRAL('no positional home/away sample');
  const { homeMean, homeGames, awayMean, awayGames } = sample;
  if (!isNum(homeMean) || !isNum(awayMean)) return NEUTRAL('no positional home/away sample');
  if (
    Number(homeGames) < constants.minGamesPerSide ||
    Number(awayGames) < constants.minGamesPerSide
  ) {
    return NEUTRAL('insufficient home/away sample', {
      homeGames: Number(homeGames) || 0,
      awayGames: Number(awayGames) || 0,
    });
  }
  const totalGames = Number(homeGames) + Number(awayGames);
  const overall = (Number(homeMean) * Number(homeGames) + Number(awayMean) * Number(awayGames)) / totalGames;
  if (!(overall > 0)) return NEUTRAL('no positional home/away sample');
  const ratio = (isHome ? Number(homeMean) : Number(awayMean)) / overall;
  const shrunk =
    (totalGames * ratio + constants.shrinkPseudoGames * 1) / (totalGames + constants.shrinkPseudoGames);
  return {
    available: true,
    effect: clamp(shrunk - 1, constants.maxEffect),
    isHome,
    games: totalGames,
  };
}

/**
 * Pure: weather CONTEXT. The point contribution is structurally zero
 * (constants.weather.maxEffect is 0) because no empirically derived,
 * sample-gated weather coefficients exist in this app yet — see the file
 * header. The forecast still rides along in the factor payload so the UI can
 * show it honestly as information rather than as a scored adjustment.
 */
function weatherEffect({ forecast = null, roof = null, constants = MODEL_CONSTANTS.weather } = {}) {
  if (!forecast) return NEUTRAL('weather unavailable', { roof: roof || null });
  return {
    available: true,
    // Deliberately not derived from the forecast: see the doc comment.
    effect: clamp(0, constants.maxEffect),
    scored: false,
    roof: roof || null,
    temperatureF: isNum(forecast.temperatureF) ? Number(forecast.temperatureF) : null,
    windSpeedMph: isNum(forecast.windSpeedMph) ? Number(forecast.windSpeedMph) : null,
    windGustMph: isNum(forecast.windGustMph) ? Number(forecast.windGustMph) : null,
    precipitationProbability: isNum(forecast.precipitationProbability)
      ? Number(forecast.precipitationProbability)
      : null,
    shortForecast: forecast.shortForecast || null,
    forecastTime: forecast.forecastTime || null,
  };
}

/**
 * Pure: market-implied scoring environment for ONE player's game.
 *
 * `impliedPoints` is this player's own team's implied total, `opponentImplied`
 * the other side's, both derived by the caller from a stored quote
 * (`total / 2 -+ spread / 2`). `slateAverageImplied` is the mean implied total
 * across every team playing that week, so the comparison is against the week
 * the player actually played in rather than a hardcoded constant that rots as
 * the league's scoring rate drifts.
 *
 * DEF is inverted deliberately, and it is the whole reason this cannot be a
 * single team-level multiplier: a shootout is GOOD for the quarterback in it
 * and BAD for the defense opposite him. A defense is priced off the points it
 * is expected to CONCEDE, so its factor reads the opponent's implied total and
 * flips the sign.
 *
 * Returns an explicit unavailable payload for a missing or malformed quote —
 * never a zero that would read as "the market said this game is average".
 */
function gameEnvironmentEffect({
  impliedPoints = null,
  opponentImplied = null,
  slateAverageImplied = null,
  position = null,
  constants = MODEL_CONSTANTS.gameEnvironment,
} = {}) {
  if (!isNum(slateAverageImplied) || Number(slateAverageImplied) < constants.minImpliedPoints) {
    return NEUTRAL('no slate baseline');
  }
  const isDefense = positionGroup(position) === 'DEF';
  const own = isDefense ? opponentImplied : impliedPoints;
  if (!isNum(own)) return NEUTRAL('no market quote');
  if (Number(own) < constants.minImpliedPoints) return NEUTRAL('implausible market quote');

  // Signed deviation from the week's own scoring environment. Inverted for a
  // defense: a higher opponent implied total is a WORSE outlook, not better.
  const deviation = Number(own) / Number(slateAverageImplied) - 1;
  const directed = isDefense ? -deviation : deviation;
  const raw = constants.responsiveness * directed;
  return {
    available: true,
    effect: clamp(raw, constants.maxEffect),
    // False whenever the cap has swallowed the derivation, so the UI can show
    // the market as CONTEXT without implying it moved the number. At
    // maxEffect 0 this is false for every projection.
    scored: constants.maxEffect > 0,
    impliedPoints: isNum(impliedPoints) ? round2(impliedPoints) : null,
    opponentImplied: isNum(opponentImplied) ? round2(opponentImplied) : null,
    slateAverageImplied: round2(slateAverageImplied),
    // The uncapped derivation, reported so a reviewer can see what the cap is
    // actually suppressing rather than having to recompute it.
    rawEffect: Math.round(raw * 10000) / 10000,
  };
}

/**
 * Pure: blend a finished model projection toward an expert-consensus number.
 *
 * Applied AFTER every factor (see `MODEL_CONSTANTS.expertConsensus`).
 *
 * THREE distinct outcomes, and the difference between the first two is the
 * reason this returns a payload rather than a boolean:
 *
 *  - `factor: null` — no provider supplied anything for this player-week. This
 *    is the shipped default (no approved feed exists), and it is byte-for-byte
 *    what `factors.expertConsensus` has always been, so installing this code
 *    changes nothing a caller can observe.
 *  - `available: false` — a provider RAN and either skipped this player or
 *    returned a quote outside the plausible range. Materially different from
 *    the above: one means nobody asked, the other means we asked and got
 *    nothing usable.
 *  - `available: true` — a usable quote, `scored` telling the caller whether
 *    the weight actually let it move the number.
 */
function expertConsensusBlend({
  value,
  expert = null,
  constants = MODEL_CONSTANTS.expertConsensus,
} = {}) {
  const weight = isNum(constants.blendWeight) ? Number(constants.blendWeight) : 0;
  if (!isNum(value)) return { value, factor: null };
  if (expert == null) return { value, factor: null };
  if (!isNum(expert.points)) {
    return {
      value,
      factor: { available: false, reason: 'no expert coverage', source: expert.source || null },
    };
  }
  const points = Number(expert.points);
  if (points < constants.minPoints || points > constants.maxPoints) {
    return {
      value,
      factor: {
        available: false,
        reason: 'expert quote out of range',
        source: expert.source || null,
      },
    };
  }
  if (!(weight > 0)) {
    // Covered, in range, and deliberately not used. Reported as context so the
    // UI can show what the experts said while being explicit that the number
    // on screen is this engine's alone.
    return {
      value,
      factor: {
        available: true,
        scored: false,
        expertPoints: round2(points),
        blendWeight: 0,
        source: expert.source || null,
      },
    };
  }
  const blended = (1 - weight) * Number(value) + weight * points;
  return {
    value: blended,
    factor: {
      available: true,
      scored: true,
      expertPoints: round2(points),
      blendWeight: weight,
      source: expert.source || null,
      pointsContribution: round2(blended - Number(value)),
    },
  };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Pure: hard availability, applied BEFORE optimization rather than as a
 * projection haircut.
 *
 * `activeProbability` is 1 for a player with no designation, 0 for a bye/Out/IR
 * and null for Questionable/Doubtful. That null is the honest answer: the only
 * injury signal this app stores is a coarse four-value designation, and there
 * is no snapshot history to calibrate "Questionable" into a real probability
 * from. Inventing 0.6 would look like a measurement.
 */
function availabilityFor({ injuryStatus = null, onBye = false, locked = false, lockedSlot = null } = {}) {
  const status = injuryStatus ? String(injuryStatus).toUpperCase() : null;
  if (onBye) {
    return { available: false, activeProbability: 0, reason: 'bye', status, locked, lockedSlot };
  }
  if (status === 'O') {
    return { available: false, activeProbability: 0, reason: 'out', status, locked, lockedSlot };
  }
  if (status === 'IR') {
    return { available: false, activeProbability: 0, reason: 'ir', status, locked, lockedSlot };
  }
  if (status === 'D') {
    // Doubtful players are startable if a manager insists, but never
    // AUTO-recommended over a healthy player: without a real active
    // probability there is nothing to trade off against.
    return {
      available: true,
      autoRecommend: false,
      activeProbability: null,
      reason: 'doubtful',
      status,
      locked,
      lockedSlot,
    };
  }
  if (status === 'Q') {
    return {
      available: true,
      autoRecommend: true,
      activeProbability: null,
      reason: 'questionable',
      status,
      locked,
      lockedSlot,
    };
  }
  return { available: true, autoRecommend: true, activeProbability: 1, reason: null, status, locked, lockedSlot };
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

/** Pure: inter-decile spread of an ASCENDING-sorted pool. The robust width the smoothing is scaled by. */
function interDecileSpread(sorted) {
  return Number(quantile(sorted, 0.9)) - Number(quantile(sorted, 0.1));
}

/**
 * Pure: the smoothing kernel's bandwidth IN POINTS, or 0 when smoothing is off.
 *
 * The bandwidth is a fraction of the player's own spread SHRUNK toward the
 * position pool's, in pseudo-observations - so a player with three residuals,
 * whose own spread is badly biased small, is smoothed by something close to
 * his position's real dispersion, while a well-sampled player is smoothed by
 * his own. Returns 0 whenever smoothing is disabled or there is no usable
 * spread to scale, which is what keeps the shipped configuration bit-identical.
 */
function smoothingBandwidthFor({ own, pooled, residuals, constants }) {
  const bw = isNum(constants.smoothingBandwidth) ? Number(constants.smoothingBandwidth) : 0;
  if (!(bw > 0) || !residuals || residuals.length === 0) return 0;
  const pseudo = isNum(constants.smoothingPseudoResiduals)
    ? Number(constants.smoothingPseudoResiduals)
    : 0;
  // `residuals` is the SELECTED pool and is already sorted; the pooled array
  // is sorted here only when it is actually consulted.
  const ownSpread = interDecileSpread(residuals);
  const usablePooled = pooled && pooled.length >= constants.minPooledResiduals
    ? pooled.slice().sort((a, b) => a - b)
    : null;
  if (!usablePooled || !(pseudo > 0)) {
    return ownSpread > 0 ? bw * ownSpread : 0;
  }
  const pooledSpread = interDecileSpread(usablePooled);
  // `own.length`, not `residuals.length`: when the player's own pool was too
  // small to be SELECTED, his evidence is what he actually has, not the size
  // of the pool he borrowed.
  const n = own.length;
  const shrunk = (n * ownSpread + pseudo * pooledSpread) / (n + pseudo);
  return shrunk > 0 ? bw * shrunk : 0;
}

/** Pure: one standard normal from a uniform generator, Box-Muller. Consumes two uniforms. */
function standardNormal(rand) {
  const u = Math.max(rand(), Number.MIN_VALUE);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Pure + deterministic: bootstrap a weekly point distribution by resampling
 * residuals around the projected mean.
 *
 * Residuals come from the player's own league-scored prior games when he has
 * enough of them, otherwise from the pooled position-level residuals. Negative
 * draws are NOT clamped: IDP and DST scoring produce genuinely negative weeks,
 * and clipping them would quietly bias every interval upward.
 *
 * "Deterministic" here means deterministic in the CONTENT of its inputs, not
 * merely in its seed. Residuals are sampled by INDEX, so the caller's array
 * ORDER would otherwise be a hidden input: the same multiset arriving shuffled
 * (a different query plan upstream, a row order Postgres never promised) would
 * produce different draws, hence a different median and different quantiles,
 * from identical data. The pool is therefore canonically sorted before any
 * draw. The invariant is: same residual multiset, mean, constants and seed =>
 * byte-identical output, whatever order the residuals came in.
 */
function simulateDistribution({
  mean,
  playerResiduals = [],
  pooledResiduals = [],
  seed = 0,
  constants = MODEL_CONSTANTS.simulation,
}) {
  if (!isNum(mean)) {
    return { mean: null, median: null, p10: null, p25: null, p75: null, p90: null, residualSource: null };
  }
  // `.filter().map()` already yields fresh arrays, so nothing below can reach
  // the caller's own arrays; the sort is applied to these copies deliberately
  // and never to `playerResiduals` / `pooledResiduals` themselves.
  const own = (playerResiduals || []).filter(isNum).map(Number);
  const pooled = (pooledResiduals || []).filter(isNum).map(Number);
  let residuals = null;
  let residualSource = null;
  // Selection is on the UNSORTED lengths, which sorting cannot change, so
  // which pool wins is exactly what it always was: own residuals when the
  // player has enough of them, pooled ones otherwise.
  if (own.length >= constants.minPlayerResiduals) {
    residuals = own;
    residualSource = 'player';
  } else if (pooled.length >= constants.minPooledResiduals) {
    residuals = pooled;
    residualSource = 'position';
  }

  if (residuals) {
    // Canonical order for the SELECTED pool. Ascending numeric sort is the
    // canonical form because it is also what `quantile` needs below, so the
    // median read is now free of a defensive copy rather than paying for one.
    // Negative residuals are preserved in full: this reorders, it never
    // filters or clamps.
    residuals.sort((a, b) => a - b);
  }

  if (!residuals) {
    // No dispersion evidence at all: report the point estimate and say so,
    // rather than manufacturing an interval out of nothing.
    const point = round2(mean);
    return { mean: point, median: point, p10: null, p25: null, p75: null, p90: null, residualSource: null };
  }

  const rand = mulberry32(seed);
  const scale = isNum(constants.intervalScale) ? Number(constants.intervalScale) : 1;
  // Widening the band must not move the point estimate, so the stretch is
  // CENTERED on the residual pool's own median instead of on zero. Scaling raw
  // residuals (mean + scale * residual) multiplies whatever bias the pool
  // carries and drags the draw median away from the projection: that is a
  // point-estimate change wearing an interval-calibration costume, and on the
  // 2024 backtest it alone regressed lineup regret from 11.22 to 15.05 at a
  // scale of 1.45. Centering leaves the draw median at (mean + median
  // residual) for every scale and moves only the spread.
  //
  // `quantile` requires ASCENDING input, which the canonical sort above has
  // already guaranteed. With scale 1 both correction terms drop out and every
  // draw is `mean + residual` to the bit, so a caller passing constants
  // without an intervalScale gets exactly the sequence it always got.
  const center = scale === 1 ? 0 : Number(quantile(residuals, 0.5));
  const origin = scale === 1 ? Number(mean) : Number(mean) + center;
  // Kernel bandwidth in POINTS, or 0 for the unsmoothed bootstrap. Derived
  // before the loop so the per-draw path stays a multiply-add.
  const bandwidth = smoothingBandwidthFor({ own, pooled, residuals, constants });
  const draws = [];
  for (let i = 0; i < constants.draws; i++) {
    const residual = residuals[Math.floor(rand() * residuals.length) % residuals.length];
    const jitter = bandwidth > 0 ? bandwidth * standardNormal(rand) : 0;
    draws.push(origin + scale * (residual - center) + jitter);
  }
  draws.sort((a, b) => a - b);
  if (bandwidth > 0) {
    // A symmetric kernel does NOT leave a skewed draw set's median alone: it
    // pulls it toward the mean, measured at +0.18 points before this
    // correction. Widening the band must not move the point estimate, so the
    // draws are translated back until the median sits exactly where the
    // unsmoothed mechanism puts it. A translation changes no interval WIDTH,
    // only position, so the calibration above is unaffected by it.
    //
    // The target is `mean + median(residuals)`, NOT `origin`. They agree at
    // every scale except exactly 1, where the bit-compatibility shortcut above
    // leaves `origin` as the bare mean - correct there only because the
    // unsmoothed draws are `mean + residual` and carry the median residual
    // themselves. Pinning to `origin` would therefore have moved the point
    // estimate by the median residual at scale 1 and nowhere else, inventing a
    // discontinuity in a constant a calibration sweep is expected to vary.
    const pinTarget = Number(mean) + Number(quantile(residuals, 0.5));
    const drift = Number(quantile(draws, 0.5)) - pinTarget;
    if (drift !== 0) {
      for (let i = 0; i < draws.length; i++) draws[i] -= drift;
    }
  }
  return {
    mean: round2(mean),
    median: round2(quantile(draws, 0.5)),
    p10: round2(quantile(draws, 0.1)),
    p25: round2(quantile(draws, 0.25)),
    p75: round2(quantile(draws, 0.75)),
    p90: round2(quantile(draws, 0.9)),
    residualSource,
  };
}

/**
 * Pure: probability that draw A exceeds draw B, from two distributions
 * summarized by quantiles. Uses the quantile pairs as a coarse empirical
 * comparison rather than assuming normality; returns null when either side has
 * no interval, so the UI can stay silent instead of printing a made-up number.
 */
function probabilityBetter(a, b) {
  const quantiles = ['p10', 'p25', 'median', 'p75', 'p90'];
  const drawsA = quantiles.map((q) => a && a[q]).filter(isNum).map(Number);
  const drawsB = quantiles.map((q) => b && b[q]).filter(isNum).map(Number);
  if (drawsA.length < quantiles.length || drawsB.length < quantiles.length) return null;
  let wins = 0;
  let total = 0;
  for (const x of drawsA) {
    for (const y of drawsB) {
      total += 1;
      if (x > y) wins += 1;
      else if (x === y) wins += 0.5;
    }
  }
  return total === 0 ? null : Math.round((wins / total) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Pure: high / medium / low, considering effective sample size, how wide the
 * simulated interval is relative to the mean, whether the number leans on a
 * prior-season fallback, whether the opponent factor had a real sample, injury
 * uncertainty, and whether role/opportunity data was available at all.
 * Confidence only ever moves DOWN from the sample-size starting point.
 */
function confidenceFor({
  effectiveGames = 0,
  distribution = null,
  usedPriorSeasonFallback = false,
  usedPositionFallback = false,
  opponentAvailable = false,
  activeProbability = 1,
  hasRoleData = true,
  constants = MODEL_CONSTANTS.confidence,
} = {}) {
  const reasons = [];
  let level = 'low';
  if (effectiveGames >= constants.highEffectiveGames) level = 'high';
  else if (effectiveGames >= constants.mediumEffectiveGames) level = 'medium';
  else reasons.push('small sample');

  const demote = (reason) => {
    reasons.push(reason);
    level = level === 'high' ? 'medium' : 'low';
  };

  if (distribution && isNum(distribution.p10) && isNum(distribution.p90) && isNum(distribution.mean)) {
    const width = Number(distribution.p90) - Number(distribution.p10);
    const scale = Math.abs(Number(distribution.mean));
    if (scale > 0 && width / scale > constants.wideIntervalRatio) demote('wide range');
  }
  if (usedPositionFallback && effectiveGames < constants.mediumEffectiveGames) demote('position baseline');
  else if (usedPriorSeasonFallback && effectiveGames < constants.mediumEffectiveGames) demote('prior season');
  if (!opponentAvailable) reasons.push('opponent sample thin');
  if (activeProbability === null) demote('injury designation');
  if (!hasRoleData) reasons.push('no role data');

  return { level, reasons };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Pure: turn a fully-prepared feature bundle into a projection.
 *
 * Factors compose multiplicatively over the baseline, applied in a fixed
 * order, and each one records the POINT difference it made — so the
 * explanation adds up to the projection exactly, and an unavailable factor
 * contributes a literal `null` rather than a 0 that reads as "we checked and
 * it was neutral".
 */
function projectPlayer({
  playerId,
  position,
  season,
  week,
  modelVersion = MODEL_VERSION,
  scoringHashValue = '',
  priorGames = [],
  priorSeasonPerGame = null,
  positionBaselinePerGame = null,
  // League-wide points per opportunity for this player's position group, the
  // shrinkage target for his own efficiency. Null (a pre-enrichment database,
  // or a group with no opportunity denominator) simply leaves his own observed
  // rate unshrunk.
  positionEfficiencyPerOpportunity = null,
  playerResiduals = [],
  pooledResiduals = [],
  opponent = null,
  versusOpponent = null,
  homeAway = null,
  weather = null,
  gameEnvironment = null,
  // `{ points, source }` for THIS player from the expert provider, or null
  // when the feed does not cover him. Never fabricated: an absent player must
  // arrive as null, not as a zero.
  expert = null,
  availability = null,
  hasRoleData = true,
  constants = MODEL_CONSTANTS,
  // Gate 2 sweep seam (PHASE5_EXECUTION_SPEC.md section 6.5). Validated
  // unconditionally, at the top of the function body, before ANY other
  // logic - including before the `baseline.value == null` early return
  // below - so an invalid type is caught even on a player-week that never
  // reaches the semantic point. Invocation itself stays conditional: it
  // fires at most once, only if execution actually reaches the point
  // immediately before `applyFactor('homeAway', homeAway)`.
  onPreHomeAwayBaseline,
}) {
  if (onPreHomeAwayBaseline !== undefined && typeof onPreHomeAwayBaseline !== 'function') {
    throw new Error('projectPlayer: onPreHomeAwayBaseline must be undefined or a function');
  }
  const baseline = baselineProduction({
    priorGames,
    priorSeasonPerGame,
    positionBaselinePerGame,
    constants: constants.baseline,
  });

  const availabilityInfo = availability || availabilityFor({});
  const factors = {};

  if (baseline.value == null) {
    // Neither the player nor any fallback had usable evidence. There is no
    // honest number to report, so report none.
    return {
      playerId,
      position: position || null,
      modelVersion,
      mean: null,
      median: null,
      p10: null,
      p25: null,
      p75: null,
      p90: null,
      activeProbability: availabilityInfo.activeProbability,
      confidence: 'low',
      confidenceReasons: ['no history'],
      sampleSize: 0,
      effectiveGames: 0,
      factors: {
        recentProduction: null,
        role: null,
        opponent: null,
        versusOpponent: null,
        homeAway: null,
        weather: null,
        gameEnvironment: null,
        availability: availabilityInfo,
        expertConsensus: null,
        dataQuality: { level: 'none', reason: 'no prior games, prior season, or position baseline' },
      },
      unavailableReason: 'no evidence',
    };
  }

  // Opportunity-weighted component. Consulted ONLY when a positive blend weight
  // asks for it, so at the shipped weight of 0 nothing here runs, nothing here
  // is reported, and the object below is exactly the one v2.2 always built.
  const usageBlendWeight = isNum(constants.usage && constants.usage.blendWeight)
    ? Number(constants.usage.blendWeight)
    : 0;
  const usageComponent = usageBlendWeight > 0
    ? opportunityBaseline({
      priorGames,
      group: positionGroup(position),
      efficiencyPrior: positionEfficiencyPerOpportunity,
      constants,
    })
    : null;
  // The blend applies only when the component produced a real number. A player
  // with no usage enrichment, or a K, keeps the points-only baseline untouched
  // rather than being blended against a fabricated stand-in.
  const usageApplied = !!(usageComponent && isNum(usageComponent.value));
  const blendedBaseline = usageApplied
    ? (1 - usageBlendWeight) * Number(baseline.value) + usageBlendWeight * Number(usageComponent.value)
    : Number(baseline.value);

  let running = blendedBaseline;
  factors.recentProduction = {
    available: true,
    perGame: round2(blendedBaseline),
    games: baseline.sampleSize,
    effectiveGames: baseline.effectiveGames,
    usedPriorSeason: baseline.usedPriorSeason,
    usedPositionBaseline: baseline.usedPositionBaseline,
    pointsContribution: round2(blendedBaseline),
  };
  if (usageComponent) {
    // Reported so the explanation still adds up and nothing is implied that was
    // not measured: `opportunityValue` null means the component was asked and
    // had nothing to say, and `usageBlendWeight` is the weight ACTUALLY applied
    // (0 in that case), not the one configured.
    Object.assign(factors.recentProduction, {
      pointsBaselinePerGame: round2(baseline.value),
      opportunityValue: usageApplied ? round2(usageComponent.value) : null,
      expectedOpportunities: usageComponent.expectedOpportunities == null
        ? null
        : round2(usageComponent.expectedOpportunities),
      opportunityEfficiency: usageComponent.efficiency == null
        ? null
        : Math.round(Number(usageComponent.efficiency) * 10000) / 10000,
      usageGames: usageComponent.usageGames,
      usageBlendWeight: usageApplied ? usageBlendWeight : 0,
    });
  }

  const applyFactor = (key, factor) => {
    if (!factor || !factor.available) {
      factors[key] = factor ? { ...factor, pointsContribution: null } : null;
      return;
    }
    const next = running * (1 + factor.effect);
    factors[key] = { ...factor, pointsContribution: round2(next - running) };
    running = next;
  };

  applyFactor('opponent', opponent);
  applyFactor('versusOpponent', versusOpponent);
  // The semantic point (PHASE5_EXECUTION_SPEC.md section 6.5): `running` is
  // `b`, the pre-homeAway baseline, captured raw - finite, unrounded, exactly
  // the value immediately before homeAway is applied. Called exactly once
  // per player-week that reaches here; an exception thrown by the callback
  // propagates uncaught, aborting generation rather than being swallowed.
  if (onPreHomeAwayBaseline) {
    onPreHomeAwayBaseline({
      playerId, position, season, week, blendWeight: usageBlendWeight, baseline: running,
    });
  }
  applyFactor('homeAway', homeAway);
  applyFactor('weather', weather);
  // LAST in the chain, and deliberately AFTER the homeAway seam above: the
  // pre-homeAway baseline `b` that `onPreHomeAwayBaseline` reports is pinned
  // by PHASE5_EXECUTION_SPEC.md section 6.5 and defines component (f)'s
  // subgroup membership. Inserting a factor earlier would silently redefine
  // `b` and invalidate that machinery, so a new factor goes on the end unless
  // there is a reason strong enough to re-cut the spec.
  applyFactor('gameEnvironment', gameEnvironment);

  // Expert consensus is not an `applyFactor` multiplier: it replaces part of
  // the projection rather than scaling it, so it composes as a weighted blend
  // over the finished value.
  const expertBlend = expertConsensusBlend({
    value: running,
    expert,
    constants: constants.expertConsensus || MODEL_CONSTANTS.expertConsensus,
  });
  running = isNum(expertBlend.value) ? Number(expertBlend.value) : running;

  const distribution = simulateDistribution({
    mean: running,
    playerResiduals,
    pooledResiduals,
    seed: seedFrom(modelVersion, scoringHashValue, season, week, playerId),
    constants: constants.simulation,
  });

  const confidence = confidenceFor({
    effectiveGames: baseline.effectiveGames,
    distribution,
    usedPriorSeasonFallback: baseline.usedPriorSeason && baseline.sampleSize === 0,
    usedPositionFallback: baseline.usedPositionBaseline && baseline.sampleSize === 0 && !baseline.usedPriorSeason,
    opponentAvailable: !!(opponent && opponent.available),
    activeProbability: availabilityInfo.activeProbability,
    hasRoleData,
    constants: constants.confidence,
  });

  factors.role = hasRoleData
    ? { available: true, pointsContribution: null, note: 'included in recent production' }
    : null;
  factors.availability = availabilityInfo;
  // Null when no provider is installed at all (the shipped default), an
  // `available: false` payload when a provider ran and did not cover this
  // player, and a scored payload only at a non-zero blend weight. The UI must
  // be able to tell "no expert input" from "expert input that happened to
  // agree", which is why these are three distinct values and not one.
  factors.expertConsensus = expertBlend.factor;
  factors.dataQuality = {
    level: confidence.level,
    reasons: confidence.reasons,
    residualSource: distribution.residualSource,
  };

  return {
    playerId,
    position: position || null,
    modelVersion,
    mean: distribution.mean,
    median: distribution.median,
    p10: distribution.p10,
    p25: distribution.p25,
    p75: distribution.p75,
    p90: distribution.p90,
    activeProbability: availabilityInfo.activeProbability,
    confidence: confidence.level,
    confidenceReasons: confidence.reasons,
    sampleSize: baseline.sampleSize,
    effectiveGames: baseline.effectiveGames,
    factors,
    unavailableReason: null,
  };
}

module.exports = {
  MODEL_VERSION,
  MODEL_CONSTANTS,
  IDP_POSITIONS,
  positionGroup,
  canonicalJson,
  scoringHash,
  seedFrom,
  mulberry32,
  quantile,
  recencyWeight,
  shrinkToward,
  baselineProduction,
  opportunitiesForGame,
  opportunityBaseline,
  opponentEffect,
  versusOpponentEffect,
  homeAwayEffect,
  weatherEffect,
  interDecileSpread,
  smoothingBandwidthFor,
  standardNormal,
  gameEnvironmentEffect,
  expertConsensusBlend,
  availabilityFor,
  simulateDistribution,
  probabilityBetter,
  confidenceFor,
  projectPlayer,
  round2,
};
