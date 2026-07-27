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
 * - Nothing is claimed to be optimal. The constants below are conservative
 *   DEFAULTS chosen to be hard to embarrass, not fitted parameters. They are
 *   versioned with the model so a future re-fit is a visible model-version
 *   bump rather than a silent drift, and scripts/backtest-weekly-projections.js
 *   exists specifically to compare alternatives chronologically before anyone
 *   claims one is better.
 */

const MODEL_VERSION = 'free_baseline_v2';

/**
 * Model constants. DEFAULTS, not fitted optimums (see the file header).
 * Grouped by the factor they govern so a backtest sweep can override one
 * group without disturbing the rest.
 */
const MODEL_CONSTANTS = {
  baseline: {
    // Exponential recency: a game N weeks before the target week carries
    // weight 0.5^(N / halfLifeWeeks). Four weeks is roughly "last month
    // counts double the month before" — deliberately mild, because weekly
    // fantasy scoring is noisy enough that aggressive recency overfits.
    recencyHalfLifeWeeks: 4,
    // Shrinkage is expressed in PSEUDO-GAMES: how many real games of evidence
    // the fallback is worth. With 3, a player's own 3-game sample and his
    // prior-season per-game pace count equally.
    priorSeasonPseudoGames: 3,
    positionPseudoGames: 2,
    // Below this many prior games we never trust the player's own sample
    // alone, even if a fallback is unavailable.
    lowConfidenceGames: 3,
    // How many "weeks" a season boundary is worth when measuring recency.
    // 18 regular-season weeks plus an 8-week penalty for the offseason: last
    // season's Week 18 is treated as 9 weeks stale in a Week 1 projection, not
    // 1. Without this a veteran's whole prior season would pile up into a
    // high-confidence Week 1 number that a roster change could invalidate.
    seasonWeekSpan: 26,
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
  },
  homeAway: {
    // Position-level home/away splits need a lot of games before they mean
    // anything; below this the factor is simply unavailable.
    minGamesPerSide: 24,
    shrinkPseudoGames: 120,
    maxEffect: 0.05,
  },
  weather: {
    // No verified empirical weather effect is wired up (see
    // nwsWeather.service.js): forecasts are surfaced as CONTEXT with a zero
    // point contribution rather than guessed at with a hardcoded penalty.
    maxEffect: 0,
  },
  simulation: {
    draws: 400,
    // Fewer residuals than this and the player's own dispersion is not
    // usable; the position-level pooled dispersion is used instead.
    minPlayerResiduals: 3,
    minPooledResiduals: 8,
  },
  confidence: {
    // Effective sample size (recency-weighted games) thresholds.
    highEffectiveGames: 5,
    mediumEffectiveGames: 2.5,
    // Interval width relative to the mean, above which confidence is capped.
    wideIntervalRatio: 1.6,
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
  return {
    value: Number(value),
    effectiveGames,
    sampleSize: games.length,
    usedPriorSeason: isNum(priorSeasonPerGame),
    usedPositionBaseline: isNum(positionBaselinePerGame),
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
 * unknown (no schedule orientation stored for this game) or the sample is too
 * thin to distinguish from noise.
 */
function homeAwayEffect({ isHome = null, sample = null, constants = MODEL_CONSTANTS.homeAway } = {}) {
  if (isHome !== true && isHome !== false) return NEUTRAL('home/away unknown');
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

/**
 * Pure + deterministic: bootstrap a weekly point distribution by resampling
 * residuals around the projected mean.
 *
 * Residuals come from the player's own league-scored prior games when he has
 * enough of them, otherwise from the pooled position-level residuals. Negative
 * draws are NOT clamped: IDP and DST scoring produce genuinely negative weeks,
 * and clipping them would quietly bias every interval upward.
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
  const own = (playerResiduals || []).filter(isNum).map(Number);
  const pooled = (pooledResiduals || []).filter(isNum).map(Number);
  let residuals = null;
  let residualSource = null;
  if (own.length >= constants.minPlayerResiduals) {
    residuals = own;
    residualSource = 'player';
  } else if (pooled.length >= constants.minPooledResiduals) {
    residuals = pooled;
    residualSource = 'position';
  }

  if (!residuals) {
    // No dispersion evidence at all: report the point estimate and say so,
    // rather than manufacturing an interval out of nothing.
    const point = round2(mean);
    return { mean: point, median: point, p10: null, p25: null, p75: null, p90: null, residualSource: null };
  }

  const rand = mulberry32(seed);
  const draws = [];
  for (let i = 0; i < constants.draws; i++) {
    const residual = residuals[Math.floor(rand() * residuals.length) % residuals.length];
    draws.push(Number(mean) + residual);
  }
  draws.sort((a, b) => a - b);
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
  playerResiduals = [],
  pooledResiduals = [],
  opponent = null,
  versusOpponent = null,
  homeAway = null,
  weather = null,
  availability = null,
  hasRoleData = true,
  constants = MODEL_CONSTANTS,
}) {
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
        availability: availabilityInfo,
        expertConsensus: null,
        dataQuality: { level: 'none', reason: 'no prior games, prior season, or position baseline' },
      },
      unavailableReason: 'no evidence',
    };
  }

  let running = baseline.value;
  factors.recentProduction = {
    available: true,
    perGame: round2(baseline.value),
    games: baseline.sampleSize,
    effectiveGames: baseline.effectiveGames,
    usedPriorSeason: baseline.usedPriorSeason,
    usedPositionBaseline: baseline.usedPositionBaseline,
    pointsContribution: round2(baseline.value),
  };

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
  applyFactor('homeAway', homeAway);
  applyFactor('weather', weather);

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
  // There is no approved free expert-consensus feed, so this is reported as
  // explicitly unavailable rather than quietly omitted — the UI says so out
  // loud instead of implying experts agreed with us.
  factors.expertConsensus = null;
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
  opponentEffect,
  versusOpponentEffect,
  homeAwayEffect,
  weatherEffect,
  availabilityFor,
  simulateDistribution,
  probabilityBetter,
  confidenceFor,
  projectPlayer,
  round2,
};
