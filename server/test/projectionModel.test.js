const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../services/projectionModel');

// ---------------------------------------------------------------------------
// Scoring identity
// ---------------------------------------------------------------------------

test('scoringHash ignores key order but not values', () => {
  const a = { receiving: { reception: 1, yards: 0.1 }, passing: { yards: 0.04 } };
  const b = { passing: { yards: 0.04 }, receiving: { yards: 0.1, reception: 1 } };
  assert.equal(model.scoringHash(a), model.scoringHash(b));
  const ppr = { ...a, receiving: { ...a.receiving, reception: 0.5 } };
  assert.notEqual(model.scoringHash(a), model.scoringHash(ppr));
});

test('scoringHash distinguishes a single tier point change', () => {
  const base = { kicking: { fieldGoal: [{ min: 0, max: 39, points: 3 }] } };
  const tweaked = { kicking: { fieldGoal: [{ min: 0, max: 39, points: 4 }] } };
  assert.notEqual(model.scoringHash(base), model.scoringHash(tweaked));
});

// ---------------------------------------------------------------------------
// Baseline production
// ---------------------------------------------------------------------------

test('baselineProduction weights recent games more heavily than old ones', () => {
  const recentHot = model.baselineProduction({
    priorGames: [{ points: 20, weeksAgo: 1 }, { points: 10, weeksAgo: 6 }],
  });
  const recentCold = model.baselineProduction({
    priorGames: [{ points: 10, weeksAgo: 1 }, { points: 20, weeksAgo: 6 }],
  });
  assert.ok(recentHot.value > recentCold.value);
  // Both see the same two games, so the plain sample size is identical.
  assert.equal(recentHot.sampleSize, 2);
  assert.equal(recentCold.sampleSize, 2);
});

test('baselineProduction shrinks a thin sample toward the prior season', () => {
  const oneHotGame = model.baselineProduction({
    priorGames: [{ points: 30, weeksAgo: 1 }],
    priorSeasonPerGame: 10,
  });
  // One 30-point game against 3 pseudo-games of a 10-point pace lands much
  // closer to 10 than to 30.
  assert.ok(oneHotGame.value < 18, `expected heavy shrinkage, got ${oneHotGame.value}`);
  assert.ok(oneHotGame.value > 10);
  assert.equal(oneHotGame.usedPriorSeason, true);
});

test('baselineProduction falls back to the position baseline, then to null', () => {
  const rookie = model.baselineProduction({
    priorGames: [],
    priorSeasonPerGame: null,
    positionBaselinePerGame: 7.5,
  });
  assert.equal(rookie.value, 7.5);
  assert.equal(rookie.sampleSize, 0);
  assert.equal(rookie.usedPositionBaseline, true);

  const nothing = model.baselineProduction({ priorGames: [] });
  assert.equal(nothing.value, null, 'no evidence must produce no number, not zero');
});

test('a Week 1 veteran with only prior-season games still projects', () => {
  // Week 1: everything is from last season, so the recency gap crosses the
  // season boundary (seasonWeekSpan). The projection exists but is not treated
  // as a large sample.
  const veteran = model.baselineProduction({
    priorGames: Array.from({ length: 17 }, (_, i) => ({
      points: 12,
      weeksAgo: model.MODEL_CONSTANTS.baseline.seasonWeekSpan - (17 - i),
    })),
    priorSeasonPerGame: 12,
  });
  assert.ok(veteran.value > 11 && veteran.value < 13);
  assert.ok(
    veteran.effectiveGames < model.MODEL_CONSTANTS.confidence.highEffectiveGames,
    'a whole prior season must not read as a high-confidence current sample'
  );
});

// ---------------------------------------------------------------------------
// Opponent adjustment
// ---------------------------------------------------------------------------

test('opponentEffect shrinks the raw ratio toward neutral', () => {
  const effect = model.opponentEffect({
    allowedPerGame: 11, leagueAveragePerGame: 10, games: 6, opponentTeam: 'DAL',
  });
  assert.equal(effect.available, true);
  // Raw ratio is +10%; six games against six pseudo-games of neutral halves it.
  assert.ok(Math.abs(effect.effect - 0.05) < 1e-9, `got ${effect.effect}`);
});

test('opponentEffect is capped in both directions', () => {
  const cap = model.MODEL_CONSTANTS.opponent.maxEffect;
  const generous = model.opponentEffect({ allowedPerGame: 40, leagueAveragePerGame: 10, games: 12 });
  const stingy = model.opponentEffect({ allowedPerGame: 1, leagueAveragePerGame: 10, games: 12 });
  assert.equal(generous.effect, cap);
  assert.equal(stingy.effect, -cap);
});

test('opponentEffect is neutral and unavailable when the sample is too small', () => {
  const effect = model.opponentEffect({ allowedPerGame: 40, leagueAveragePerGame: 10, games: 2 });
  assert.equal(effect.available, false);
  assert.equal(effect.effect, 0);
  assert.match(effect.reason, /insufficient/);
});

test('opponentEffect is neutral when there is no opponent data at all', () => {
  const effect = model.opponentEffect({ allowedPerGame: null, leagueAveragePerGame: 10, games: 12 });
  assert.equal(effect.available, false);
  assert.equal(effect.effect, 0);
});

// ---------------------------------------------------------------------------
// Player vs. opponent history
// ---------------------------------------------------------------------------

test('versusOpponentEffect needs two meetings and stays tiny when it fires', () => {
  const one = model.versusOpponentEffect({ meetings: [{ points: 30, baseline: 10, seasonsAgo: 0 }] });
  assert.equal(one.available, false);

  const two = model.versusOpponentEffect({
    meetings: [
      { points: 30, baseline: 10, seasonsAgo: 0 },
      { points: 32, baseline: 10, seasonsAgo: 0 },
    ],
  });
  assert.equal(two.available, true);
  // He has TRIPLED his baseline against them, and the factor is still capped
  // at a few percent: recent role must always dominate this.
  assert.equal(two.effect, model.MODEL_CONSTANTS.versusOpponent.maxEffect);
  assert.ok(two.effect <= 0.05);
});

test('versusOpponentEffect ignores meetings with no usable baseline', () => {
  const effect = model.versusOpponentEffect({
    meetings: [
      { points: 30, baseline: 0, seasonsAgo: 0 },
      { points: 32, baseline: null, seasonsAgo: 0 },
    ],
  });
  assert.equal(effect.available, false);
});

// ---------------------------------------------------------------------------
// Home / away
// ---------------------------------------------------------------------------

test('homeAwayEffect is neutral when orientation is unknown', () => {
  const effect = model.homeAwayEffect({
    isHome: null,
    sample: { homeMean: 12, homeGames: 500, awayMean: 10, awayGames: 500 },
  });
  assert.equal(effect.available, false);
  assert.equal(effect.effect, 0);
  assert.match(effect.reason, /unknown/);
});

test('homeAwayEffect is neutral when the positional sample is thin', () => {
  const effect = model.homeAwayEffect({
    isHome: true,
    sample: { homeMean: 20, homeGames: 3, awayMean: 5, awayGames: 3 },
  });
  assert.equal(effect.available, false);
  assert.equal(effect.effect, 0);
});

test('homeAwayEffect is shrunk and capped with a real sample', () => {
  const effect = model.homeAwayEffect({
    isHome: true,
    sample: { homeMean: 12, homeGames: 100, awayMean: 10, awayGames: 100 },
  });
  assert.equal(effect.available, true);
  assert.ok(effect.effect > 0);
  assert.ok(effect.effect <= model.MODEL_CONSTANTS.homeAway.maxEffect);
});

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

test('weatherEffect reports context but contributes no points', () => {
  const effect = model.weatherEffect({
    forecast: { temperatureF: 28, windSpeedMph: 22, shortForecast: 'Windy' },
    roof: 'outdoors',
  });
  assert.equal(effect.available, true);
  assert.equal(effect.effect, 0, 'no verified weather coefficients exist, so no scored effect');
  assert.equal(effect.scored, false);
  assert.equal(effect.windSpeedMph, 22);
});

test('weatherEffect is unavailable, not zeroed, without a forecast', () => {
  const effect = model.weatherEffect({ forecast: null, roof: 'dome' });
  assert.equal(effect.available, false);
  assert.equal(effect.roof, 'dome');
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

test('bye, Out and IR are hard-unavailable with a zero active probability', () => {
  for (const input of [{ onBye: true }, { injuryStatus: 'O' }, { injuryStatus: 'IR' }]) {
    const availability = model.availabilityFor(input);
    assert.equal(availability.available, false, JSON.stringify(input));
    assert.equal(availability.activeProbability, 0);
  }
});

test('Questionable keeps the player available with an UNKNOWN active probability', () => {
  const availability = model.availabilityFor({ injuryStatus: 'Q' });
  assert.equal(availability.available, true);
  assert.equal(availability.autoRecommend, true);
  assert.equal(
    availability.activeProbability,
    null,
    'a coarse Q designation cannot be turned into a real probability'
  );
});

test('Doubtful is startable but never auto-recommended', () => {
  const availability = model.availabilityFor({ injuryStatus: 'D' });
  assert.equal(availability.available, true);
  assert.equal(availability.autoRecommend, false);
  assert.equal(availability.activeProbability, null);
});

test('a healthy player has an active probability of 1', () => {
  assert.equal(model.availabilityFor({}).activeProbability, 1);
});

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

test('simulateDistribution is deterministic for the same seed', () => {
  const args = { mean: 12, playerResiduals: [-5, -2, 1, 4, 8], seed: 1234 };
  assert.deepEqual(model.simulateDistribution(args), model.simulateDistribution(args));
});

test('simulateDistribution keeps the mean and gives every player a distinct seed', () => {
  const residuals = Array.from({ length: 40 }, (_, i) => i - 20);
  const a = model.simulateDistribution({ mean: 12, playerResiduals: residuals, seed: 1 });
  const b = model.simulateDistribution({ mean: 12, playerResiduals: residuals, seed: 2 });
  assert.equal(a.mean, 12);
  assert.equal(b.mean, 12);
  // Seeds are derived from the identity of the prediction, so two players in
  // the same week never share a draw sequence.
  assert.notEqual(
    model.seedFrom('free_baseline_v2', 'hash', 2026, 5, 1),
    model.seedFrom('free_baseline_v2', 'hash', 2026, 5, 2)
  );
});

test('simulateDistribution does not clamp negative outcomes', () => {
  const distribution = model.simulateDistribution({
    mean: -1, playerResiduals: [-8, -6, -4, 2, 3], seed: 7,
  });
  assert.ok(distribution.p10 < 0, 'IDP and DST weeks are genuinely negative');
});

test('simulateDistribution falls back to pooled residuals, then to no interval', () => {
  const pooled = model.simulateDistribution({
    mean: 10, playerResiduals: [1], pooledResiduals: [-6, -3, -1, 0, 1, 2, 5, 8], seed: 3,
  });
  assert.equal(pooled.residualSource, 'position');
  assert.ok(pooled.p10 != null);

  const bare = model.simulateDistribution({ mean: 10, playerResiduals: [], pooledResiduals: [] });
  assert.equal(bare.mean, 10);
  assert.equal(bare.p10, null, 'no dispersion evidence means no interval, not a made-up one');
  assert.equal(bare.residualSource, null);
});

test('simulateDistribution reports nothing at all for a null mean', () => {
  const none = model.simulateDistribution({ mean: null, playerResiduals: [1, 2, 3, 4] });
  assert.equal(none.mean, null);
  assert.equal(none.median, null);
});

test('probabilityBetter is null when either side has no interval', () => {
  const full = { p10: 5, p25: 8, median: 10, p75: 13, p90: 16 };
  assert.equal(model.probabilityBetter(full, { p10: null, p25: null, median: 9, p75: null, p90: null }), null);
  assert.ok(model.probabilityBetter(full, full) === 0.5);
});

test('probabilityBetter favors the clearly better distribution', () => {
  const better = { p10: 15, p25: 18, median: 20, p75: 23, p90: 26 };
  const worse = { p10: 2, p25: 4, median: 6, p75: 8, p90: 10 };
  assert.equal(model.probabilityBetter(better, worse), 1);
  assert.equal(model.probabilityBetter(worse, better), 0);
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

test('confidence rises with effective sample size', () => {
  assert.equal(model.confidenceFor({ effectiveGames: 6, opponentAvailable: true }).level, 'high');
  assert.equal(model.confidenceFor({ effectiveGames: 3, opponentAvailable: true }).level, 'medium');
  assert.equal(model.confidenceFor({ effectiveGames: 0.5, opponentAvailable: true }).level, 'low');
});

test('an unknown injury status demotes confidence and says why', () => {
  const healthy = model.confidenceFor({ effectiveGames: 8, opponentAvailable: true, activeProbability: 1 });
  const questionable = model.confidenceFor({
    effectiveGames: 8, opponentAvailable: true, activeProbability: null,
  });
  assert.equal(healthy.level, 'high');
  assert.equal(questionable.level, 'medium');
  assert.ok(questionable.reasons.includes('injury designation'));
});

test('a wide interval demotes confidence', () => {
  const narrow = model.confidenceFor({
    effectiveGames: 8, opponentAvailable: true, distribution: { mean: 10, p10: 8, p90: 12 },
  });
  const wide = model.confidenceFor({
    effectiveGames: 8, opponentAvailable: true, distribution: { mean: 10, p10: -5, p90: 30 },
  });
  assert.equal(narrow.level, 'high');
  assert.equal(wide.level, 'medium');
  assert.ok(wide.reasons.includes('wide range'));
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const projectArgs = (overrides = {}) => ({
  playerId: 1,
  position: 'RB',
  season: 2026,
  week: 5,
  priorGames: [
    { points: 14, weeksAgo: 1 },
    { points: 11, weeksAgo: 2 },
    { points: 17, weeksAgo: 3 },
    { points: 9, weeksAgo: 4 },
  ],
  playerResiduals: [-3.8, -1.8, 1.2, 4.2],
  ...overrides,
});

test('projectPlayer returns a distribution and per-factor point contributions', () => {
  const projection = model.projectPlayer(projectArgs({
    opponent: model.opponentEffect({ allowedPerGame: 14, leagueAveragePerGame: 10, games: 8, opponentTeam: 'NYG' }),
  }));
  assert.ok(projection.mean > 0);
  assert.ok(projection.p10 <= projection.median && projection.median <= projection.p90);
  assert.equal(projection.factors.recentProduction.available, true);
  assert.ok(projection.factors.opponent.pointsContribution > 0);
  // The explanation reconstructs the projection exactly.
  const rebuilt = projection.factors.recentProduction.pointsContribution
    + projection.factors.opponent.pointsContribution;
  assert.ok(Math.abs(rebuilt - projection.mean) < 0.05, `${rebuilt} vs ${projection.mean}`);
});

test('projectPlayer marks an unavailable factor null rather than a zero contribution', () => {
  const projection = model.projectPlayer(projectArgs({
    opponent: model.opponentEffect({ allowedPerGame: null, leagueAveragePerGame: null, games: 0 }),
    homeAway: model.homeAwayEffect({ isHome: null }),
  }));
  assert.equal(projection.factors.opponent.pointsContribution, null);
  assert.equal(projection.factors.homeAway.pointsContribution, null);
  assert.notEqual(projection.factors.opponent.pointsContribution, 0);
});

test('projectPlayer returns nulls, never zero, when there is no evidence at all', () => {
  const projection = model.projectPlayer(projectArgs({ priorGames: [] }));
  assert.equal(projection.mean, null);
  assert.equal(projection.median, null);
  assert.equal(projection.confidence, 'low');
  assert.equal(projection.unavailableReason, 'no evidence');
  assert.equal(projection.factors.dataQuality.level, 'none');
});

test('projectPlayer always reports expert consensus as unavailable', () => {
  const projection = model.projectPlayer(projectArgs());
  assert.equal(projection.factors.expertConsensus, null);
});

test('projectPlayer is deterministic for the same player, week and model', () => {
  const a = model.projectPlayer(projectArgs());
  const b = model.projectPlayer(projectArgs());
  assert.deepEqual(a, b);
});

test('projectPlayer carries a bye through as unavailable with probability 0', () => {
  const projection = model.projectPlayer(projectArgs({
    availability: model.availabilityFor({ onBye: true }),
  }));
  assert.equal(projection.activeProbability, 0);
  assert.equal(projection.factors.availability.reason, 'bye');
});
