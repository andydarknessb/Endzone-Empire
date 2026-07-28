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
  // Under the shipped 8-week half-life, one 30-point game a week ago is worth
  // ~0.92 recency-weighted games of evidence against 1.5 pseudo-games of a
  // 10-point pace, so the prior still outweighs the hot game and the result
  // lands on the prior's side of the midpoint. (The blend cannot fire here:
  // the game carries no sameSeason flag, so there is no current-season mean.)
  assert.ok(oneHotGame.value < 20, `expected shrinkage toward the prior, got ${oneHotGame.value}`);
  assert.ok(oneHotGame.value > 10);
  assert.equal(oneHotGame.usedPriorSeason, true);

  // The pseudo-game count is what controls how hard that pull is: more
  // pseudo-games of prior season must land strictly closer to the prior.
  const heavier = model.baselineProduction({
    priorGames: [{ points: 30, weeksAgo: 1 }],
    priorSeasonPerGame: 10,
    constants: { ...model.MODEL_CONSTANTS.baseline, priorSeasonPseudoGames: 6 },
  });
  assert.ok(heavier.value < oneHotGame.value, 'more pseudo-games must shrink harder');
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
// Current-season mean blend
// ---------------------------------------------------------------------------

/**
 * One fixture, reused by every blend test, built so the two candidate estimates
 * pull hard in opposite directions:
 *
 *  - the four current-season games are STRONG early and WEAK recently, so the
 *    recency-weighted view (~10.45/g) sits far below the flat view (18.0/g);
 *  - a fifth game from the PRIOR season scored 0, so any implementation that
 *    lets it into the "current season" mean lands somewhere else again (14.4).
 *
 * weeksAgo values are multiples of a 4-week half-life, so every recency weight
 * is an exact power of one half and the whole chain below is rational
 * arithmetic rather than a number copied out of a debugger. That half-life is
 * PINNED in BLEND_CONSTANTS rather than read from the shipped defaults: these
 * tests are about the blend machinery's arithmetic, and re-tuning the shipped
 * half-life must not silently invalidate hand-derived numbers. The shipped
 * VALUES are asserted separately, just below.
 */
const BLEND_FIXTURE = {
  priorGames: [
    { points: 6, weeksAgo: 4, sameSeason: true },   // weight 0.5
    { points: 6, weeksAgo: 8, sameSeason: true },   // weight 0.25
    { points: 30, weeksAgo: 12, sameSeason: true }, // weight 0.125
    { points: 30, weeksAgo: 16, sameSeason: true }, // weight 0.0625
    { points: 0, weeksAgo: 20, sameSeason: false }, // weight 0.03125, LAST season
  ],
  priorSeasonPerGame: 12.5,
  positionBaselinePerGame: 5,
};

// Hand-derived from the fixture, independently of the implementation:
//   weightedSum = 3 + 1.5 + 3.75 + 1.875 + 0  = 10.125
//   weightSum   = 0.5 + 0.25 + 0.125 + 0.0625 + 0.03125 = 0.96875
//   observed    = 10.125 / 0.96875                      = 324/31
//   afterSeason = (10.125 + 1.5 * 12.5) / (0.96875 + 1.5)  = 924/79
//   value       = (28.875 + 5) / (2.46875 + 1)             = 1084/111
const BLEND_FIXTURE_SHRUNK = 1084 / 111;          // ~9.7658
// UNWEIGHTED mean of the four current-season games only: (6+6+30+30)/4.
const BLEND_FIXTURE_FLAT_MEAN = 18;

// The fixture arithmetic is derived under THIS half-life, not the shipped one.
const BLEND_CONSTANTS = { ...model.MODEL_CONSTANTS.baseline, recencyHalfLifeWeeks: 4 };
const withBlend = (weight) => ({ ...BLEND_CONSTANTS, currentSeasonMeanBlendWeight: weight });

test('the shipped constants switch the current-season blend ON at the selected pair', () => {
  const { recencyHalfLifeWeeks, currentSeasonMeanBlendWeight } = model.MODEL_CONSTANTS.baseline;
  // These two were swept CROSSED and selected together as `slow8-blend-25`, so
  // they are asserted together: shipping one without the other is shipping a
  // pair that was never measured.
  assert.equal(recencyHalfLifeWeeks, 8, 'the selected half-life');
  assert.equal(currentSeasonMeanBlendWeight, 0.25, 'the selected blend weight');
  // Mutation guard: a blend weight of 0 is the neutral element, so a default
  // that silently drifted back to it would leave every test below still
  // passing while the shipped model quietly reverted to v2.1 behavior.
  assert.notEqual(currentSeasonMeanBlendWeight, 0, 'a 0 default is the blend switched off, not a tuned value');
  assert.ok(
    currentSeasonMeanBlendWeight > 0 && currentSeasonMeanBlendWeight < 1,
    'a weight of 1 would discard the model entirely in favor of the flat incumbent average'
  );
  // A constants change without a version bump serves rows computed under the
  // old numbers from cache as if they were current.
  assert.equal(model.MODEL_VERSION, 'free_baseline_v2.2');
});

test('a zero or absent blend weight reproduces the pre-blend math exactly', () => {
  // Explicit legacy constants: this property is about the MACHINERY (weight 0
  // is the identity), not about whatever the shipped weight happens to be.
  const blendOff = model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(0) });

  // The pre-blend composition, rebuilt here from the model's own (unchanged,
  // separately tested) primitives: recency-weighted mean, shrink to the prior
  // season, shrink to the position baseline. Nothing else was ever applied.
  let weightedSum = 0;
  let weightSum = 0;
  for (const game of BLEND_FIXTURE.priorGames) {
    const w = model.recencyWeight(game.weeksAgo, BLEND_CONSTANTS.recencyHalfLifeWeeks);
    weightedSum += w * game.points;
    weightSum += w;
  }
  const legacyValue = model.shrinkToward(
    model.shrinkToward(weightedSum / weightSum, weightSum, BLEND_FIXTURE.priorSeasonPerGame, 1.5),
    weightSum + 1.5,
    BLEND_FIXTURE.positionBaselinePerGame,
    1
  );
  assert.ok(Math.abs(blendOff.value - legacyValue) < 1e-12, `got ${blendOff.value}, legacy ${legacyValue}`);
  // Pinned, so a future refactor of those primitives cannot quietly move the
  // number and take this test with it.
  assert.ok(
    Math.abs(blendOff.value - BLEND_FIXTURE_SHRUNK) < 1e-12,
    `expected the pinned 1084/111, got ${blendOff.value}`
  );

  // A constants object from before the setting existed, key genuinely absent.
  const { currentSeasonMeanBlendWeight, ...keyAbsentConstants } = BLEND_CONSTANTS;
  assert.equal(currentSeasonMeanBlendWeight, 0.25, 'the key really was present to begin with');
  assert.equal('currentSeasonMeanBlendWeight' in keyAbsentConstants, false);
  const keyAbsent = model.baselineProduction({ ...BLEND_FIXTURE, constants: keyAbsentConstants });

  assert.deepEqual(keyAbsent, blendOff, 'a constants object with no blend key behaves as before');
  // Non-numeric junk is treated as absent rather than coerced to a weight.
  for (const junk of [null, undefined, '', true, NaN, 'half']) {
    assert.deepEqual(
      model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(junk) }),
      blendOff,
      `blend weight ${String(junk)} must be read as "off", never coerced`
    );
  }
});

test('an applied blend lands weakly between the shrunk value and the flat current-season mean', () => {
  const lo = Math.min(BLEND_FIXTURE_SHRUNK, BLEND_FIXTURE_FLAT_MEAN);
  const hi = Math.max(BLEND_FIXTURE_SHRUNK, BLEND_FIXTURE_FLAT_MEAN);
  let previous = model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(0) }).value;
  for (const weight of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const result = model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(weight) });
    assert.ok(
      result.value >= lo - 1e-12 && result.value <= hi + 1e-12,
      `weight ${weight} left the interval [${lo}, ${hi}] at ${result.value}`
    );
    // A blend can only interpolate, so more weight must move monotonically
    // toward the flat mean (which is the larger of the two here).
    assert.ok(result.value > previous, `weight ${weight} did not move toward the flat mean`);
    previous = result.value;
    // The blend changes the estimate, never the evidence behind it.
    assert.equal(
      result.effectiveGames,
      model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(0) }).effectiveGames
    );
    assert.equal(result.sampleSize, 5);
  }
  const full = model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(1) });
  assert.equal(full.value, BLEND_FIXTURE_FLAT_MEAN, 'weight 1 is the flat current-season mean, exactly');
});

test('no current-season game means no blend, at any weight', () => {
  // Nothing flagged sameSeason: one row says false, the others predate the
  // flag entirely. Neither may be invented into a current-season mean.
  const args = {
    priorGames: [
      { points: 20, weeksAgo: 20, sameSeason: false },
      { points: 4, weeksAgo: 24 },
      { points: 12, weeksAgo: 28 },
    ],
    priorSeasonPerGame: 11,
    positionBaselinePerGame: 8,
  };
  const off = model.baselineProduction({ ...args, constants: withBlend(0) });
  for (const weight of [0.25, 0.5, 0.75, 1]) {
    assert.deepEqual(
      model.baselineProduction({ ...args, constants: withBlend(weight) }),
      off,
      `weight ${weight} fabricated a current-season component out of nothing`
    );
  }
  // And a player with no games at all still declines to project.
  assert.equal(
    model.baselineProduction({ priorGames: [], constants: withBlend(1) }).value,
    null
  );
});

test('the blend averages current-season games FLAT and excludes last season', () => {
  // Every wrong way to compute the mixed-in mean lands on a different number,
  // and each one is named in the failure message so a regression says which
  // mistake it made rather than just "expected X got Y".
  const half = model.baselineProduction({ ...BLEND_FIXTURE, constants: withBlend(0.5) });

  const correct = 0.5 * BLEND_FIXTURE_SHRUNK + 0.5 * BLEND_FIXTURE_FLAT_MEAN;      // ~13.8829
  // Mutant A: prior-season row allowed into the mean -> (6+6+30+30+0)/5 = 14.4.
  const mutantPriorSeasonIncluded = 0.5 * BLEND_FIXTURE_SHRUNK + 0.5 * 14.4;        // ~12.1579
  // Mutant B: recency-WEIGHTED mean of the current-season games instead of the
  // flat one -> 10.125 / 0.9375 = 10.8.
  const mutantWeightedMean = 0.5 * BLEND_FIXTURE_SHRUNK + 0.5 * 10.8;               // ~10.2829
  // Mutant C: weighted mean over ALL games (the `observed` term) -> 324/31.
  const mutantObservedMean = 0.5 * BLEND_FIXTURE_SHRUNK + 0.5 * (324 / 31);         // ~10.1105
  // Mutant D: blend applied to the raw observed mean BEFORE the shrinkage
  // chain, rather than as the final step.
  const preShrinkObserved = 0.5 * (324 / 31) + 0.5 * BLEND_FIXTURE_FLAT_MEAN;
  const mutantBlendedBeforeShrinkage = model.shrinkToward(
    model.shrinkToward(preShrinkObserved, 0.96875, 12.5, 1.5),
    0.96875 + 1.5,
    5,
    1
  );                                                                                // ~11.4
  // Mutant E: the blend silently skipped.
  const mutantNoBlend = BLEND_FIXTURE_SHRUNK;                                       // ~9.7658

  assert.ok(
    Math.abs(half.value - correct) < 1e-12,
    `blend at 0.5 must be ${correct}; got ${half.value}. ` +
    `${mutantPriorSeasonIncluded} = last season counted in the current-season mean; ` +
    `${mutantWeightedMean} = recency-weighted instead of flat; ` +
    `${mutantObservedMean} = the all-games weighted mean reused as the flat mean; ` +
    `${mutantBlendedBeforeShrinkage} = blended before the shrinkage chain instead of after; ` +
    `${mutantNoBlend} = blend not applied at all`
  );
  // Every mutant above is materially, not marginally, distinguishable.
  for (const mutant of [
    mutantPriorSeasonIncluded, mutantWeightedMean, mutantObservedMean,
    mutantBlendedBeforeShrinkage, mutantNoBlend,
  ]) {
    assert.ok(Math.abs(correct - mutant) > 1, `mutant ${mutant} is too close to ${correct} to be a real check`);
  }
});

// ---------------------------------------------------------------------------
// Opportunity-weighted baseline
// ---------------------------------------------------------------------------

/**
 * Four RB games carrying usage keys. The middle one is deliberately HALF known
 * (targets present, carries missing), because that is the shape real
 * enrichment gaps take and the shape a "treat missing as zero" bug hides in.
 */
const USAGE_GAMES = () => [
  { points: 14, weeksAgo: 1, usage: { carries: 16, targets: 4 } },
  { points: 11, weeksAgo: 2, usage: { carries: null, targets: 3 } },
  { points: 17, weeksAgo: 3, usage: { carries: 20, targets: 5 } },
  { points: 9, weeksAgo: 4, usage: { carries: 10, targets: 2 } },
];

/** The same games with every usage key removed: a pre-enrichment database. */
const stripUsage = (games) => games.map(({ usage, ...rest }) => rest);

test('the opportunity component ships switched OFF and inert', () => {
  const { blendWeight, minUsageGames, efficiencyPseudoOpportunities } = model.MODEL_CONSTANTS.usage;
  assert.equal(blendWeight, 0, 'shipping this above 0 is a model change and needs a version bump');
  // The other two are starting defaults, not swept values, but they are pinned
  // so a drift shows up as a failing test rather than as a quietly different
  // gate on every projection the day the weight is turned on.
  assert.equal(minUsageGames, 3);
  assert.equal(efficiencyPseudoOpportunities, 25);
  assert.equal(model.MODEL_VERSION, 'free_baseline_v2.2', 'an inert block must not bump the version');
});

test('opportunitiesForGame counts attempts for a QB and touches for skill positions', () => {
  assert.equal(model.opportunitiesForGame({ passAttempts: 34, carries: 3, targets: 0 }, 'QB'), 34);
  assert.equal(model.opportunitiesForGame({ carries: 16, targets: 4 }, 'RB'), 20);
  assert.equal(model.opportunitiesForGame({ carries: 0, targets: 9 }, 'WR'), 9, 'a real 0 is a measurement');
  assert.equal(model.opportunitiesForGame({ carries: 0, targets: 0 }, 'TE'), 0);
  // Lowercase and raw position codes both normalize through positionGroup.
  assert.equal(model.opportunitiesForGame({ carries: 5, targets: 5 }, 'rb'), 10);
});

test('opportunitiesForGame refuses a half-known touch count instead of zeroing it', () => {
  // The mutant this kills: reading a null carry count as 0. It would price the
  // middle game at 3 opportunities and call that a measurement.
  assert.equal(model.opportunitiesForGame({ carries: null, targets: 3 }, 'RB'), null);
  assert.notEqual(model.opportunitiesForGame({ carries: null, targets: 3 }, 'RB'), 3);
  assert.equal(model.opportunitiesForGame({ carries: 12, targets: null }, 'WR'), null);
  assert.equal(model.opportunitiesForGame({ targets: 3 }, 'TE'), null, 'absent is missing, not zero');
  assert.equal(model.opportunitiesForGame({ carries: '', targets: 3 }, 'RB'), null);
  assert.equal(model.opportunitiesForGame({ passAttempts: null }, 'QB'), null);
  assert.equal(model.opportunitiesForGame(null, 'RB'), null);
  assert.equal(model.opportunitiesForGame(undefined, 'QB'), null);
});

test('opportunitiesForGame is null for every group with no opportunity denominator', () => {
  // Stray keys and all: K, DEF and the IDP groups have no touch count this app
  // stores that means anything, so they can never enter the component.
  const stray = { passAttempts: 40, carries: 12, targets: 8 };
  for (const group of ['K', 'DEF', 'LB', 'ILB', 'DL', 'DB', 'CB', 'S']) {
    assert.equal(model.opportunitiesForGame(stray, group), null, group);
  }
  assert.equal(model.opportunitiesForGame(stray, null), null);
  assert.equal(model.opportunitiesForGame(stray, ''), null);
});

test('a game with a half-known touch count contributes NOTHING to the opportunity component', () => {
  const honest = model.opportunityBaseline({
    priorGames: USAGE_GAMES(), group: 'RB', efficiencyPrior: 0.6,
  });
  assert.equal(honest.usageGames, 3, 'the half-known game is excluded entirely');
  assert.ok(honest.value != null);

  // The mutant, run for real rather than described: null carries read as 0, so
  // the middle game joins at 3 opportunities for 11 points.
  const mutant = model.opportunityBaseline({
    priorGames: USAGE_GAMES().map((g) => ({
      ...g,
      usage: { ...g.usage, carries: g.usage.carries == null ? 0 : g.usage.carries },
    })),
    group: 'RB',
    efficiencyPrior: 0.6,
  });
  assert.equal(mutant.usageGames, 4);
  assert.ok(
    Math.abs(mutant.value - honest.value) > 1,
    `a fabricated zero carry count must move the value materially; ` +
    `got ${mutant.value} against ${honest.value}. It inflates the rate ` +
    `(${mutant.efficiency} vs ${honest.efficiency}) by crediting 11 points to 3 touches ` +
    `while deflating expected opportunities (${mutant.expectedOpportunities} vs ` +
    `${honest.expectedOpportunities}).`
  );

  // And a database with no enrichment at all produces no component, not a zero.
  const bare = model.opportunityBaseline({
    priorGames: stripUsage(USAGE_GAMES()), group: 'RB', efficiencyPrior: 0.6,
  });
  assert.equal(bare.value, null, 'no usage keys means no opportunity estimate, never 0');
  assert.equal(bare.usageGames, 0);
  assert.equal(bare.expectedOpportunities, null);
});

test('opportunityBaseline declines below the minimum usage-game count', () => {
  const games = USAGE_GAMES().slice(0, 3); // two usable, one half-known
  const thin = model.opportunityBaseline({ priorGames: games, group: 'RB', efficiencyPrior: 0.6 });
  assert.equal(thin.usageGames, 2);
  assert.equal(thin.value, null, 'two usage-bearing games is under the gate');
  // Lowering the gate is what changes that, not any change in the evidence.
  const lowered = model.opportunityBaseline({
    priorGames: games,
    group: 'RB',
    efficiencyPrior: 0.6,
    constants: { ...model.MODEL_CONSTANTS, usage: { ...model.MODEL_CONSTANTS.usage, minUsageGames: 2 } },
  });
  assert.ok(lowered.value > 0);
});

test('opportunityBaseline reports no value when nobody touched the ball', () => {
  const zeroed = model.opportunityBaseline({
    priorGames: [
      { points: 0, weeksAgo: 1, usage: { carries: 0, targets: 0 } },
      { points: 0, weeksAgo: 2, usage: { carries: 0, targets: 0 } },
      { points: 0, weeksAgo: 3, usage: { carries: 0, targets: 0 } },
    ],
    group: 'RB',
    efficiencyPrior: 0.6,
  });
  assert.equal(zeroed.usageGames, 3, 'the games are real and counted');
  assert.equal(zeroed.expectedOpportunities, 0);
  assert.equal(zeroed.value, null, 'zero expected opportunities is no estimate, not an estimate of zero');
});

test('efficiency shrinks toward the prior on thin evidence and toward the observed rate on thick', () => {
  const PRIOR = 0.5;
  const OBSERVED = 2; // every fixture below scores exactly 2 points per opportunity
  const fixture = (games, touches) => Array.from({ length: games }, (_, i) => ({
    points: touches * OBSERVED,
    weeksAgo: i + 1,
    usage: { carries: touches, targets: 0 },
  }));

  // 3 games x 2 touches: a handful of opportunities against 25 pseudo-ones.
  const thin = model.opportunityBaseline({
    priorGames: fixture(3, 2), group: 'RB', efficiencyPrior: PRIOR,
  });
  // 16 games x 25 touches: hundreds of weighted opportunities.
  const thick = model.opportunityBaseline({
    priorGames: fixture(16, 25), group: 'RB', efficiencyPrior: PRIOR,
  });

  for (const [name, result] of [['thin', thin], ['thick', thick]]) {
    assert.ok(
      result.efficiency > PRIOR && result.efficiency < OBSERVED,
      `${name} efficiency ${result.efficiency} must sit strictly between the prior and the observed rate`
    );
  }
  assert.ok(
    Math.abs(thin.efficiency - PRIOR) < Math.abs(thick.efficiency - PRIOR),
    `thin evidence must land nearer the prior: thin ${thin.efficiency}, thick ${thick.efficiency}`
  );
  assert.ok(
    Math.abs(thick.efficiency - OBSERVED) < Math.abs(thin.efficiency - OBSERVED),
    'thick evidence must land nearer the observed rate'
  );
  // Mutation guard: shrinking with evidence measured in GAMES rather than
  // opportunities would make these two nearly identical (3 vs 16 against a
  // pseudo-weight of 25), instead of an order of magnitude apart.
  assert.ok(
    thick.efficiency - thin.efficiency > 0.5,
    `the two samples must be materially different, got ${thin.efficiency} and ${thick.efficiency}`
  );
  // No prior at all leaves the observed rate untouched rather than inventing one.
  const unshrunk = model.opportunityBaseline({
    priorGames: fixture(3, 2), group: 'RB', efficiencyPrior: null,
  });
  assert.ok(Math.abs(unshrunk.efficiency - OBSERVED) < 1e-12);
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
    model.seedFrom(model.MODEL_VERSION, 'hash', 2026, 5, 1),
    model.seedFrom(model.MODEL_VERSION, 'hash', 2026, 5, 2)
  );
});

test('intervalScale widens the band without moving the center', () => {
  // A deliberately RIGHT-SKEWED residual pool: median 2, mean 4.2. Stretching
  // these about zero rather than about their own median would drag the draw
  // median to 12 + 1.45 * 2 = 14.9, which is not a wider interval, it is a
  // different projection. That mistake cost real lineup regret on the 2024
  // backtest, so the center is asserted as hard as the width here.
  const args = { mean: 12, playerResiduals: [-3, -1, 2, 3, 20], seed: 1234 };
  const shipped = model.simulateDistribution(args);
  const unscaled = model.simulateDistribution({
    ...args,
    constants: { ...model.MODEL_CONSTANTS.simulation, intervalScale: 1 },
  });
  // What a `constants` object that predates the setting gets.
  const legacy = model.simulateDistribution({
    ...args,
    constants: { draws: 400, minPlayerResiduals: 3, minPooledResiduals: 8 },
  });
  // Scale-independence is the real invariant, so a second, much larger scale
  // has to hold the same center rather than 1.45 happening to be lucky.
  const wide = model.simulateDistribution({
    ...args,
    constants: { ...model.MODEL_CONSTANTS.simulation, intervalScale: 2.5 },
  });

  assert.ok(model.MODEL_CONSTANTS.simulation.intervalScale > 1, 'backtested coverage was far under 0.80');
  assert.equal(shipped.mean, 12, 'widening dispersion must never move the reported mean');
  assert.equal(unscaled.median, 14, 'mean 12 plus the pool median residual of 2');
  assert.equal(shipped.median, unscaled.median, 'the MEDIAN must survive scaling, or the band is re-tuning the projection');
  assert.equal(wide.median, unscaled.median, 'and it must hold at any scale, not just the shipped one');
  assert.deepEqual(legacy, unscaled, 'a constants object with no intervalScale behaves as before');
  assert.ok(
    shipped.p90 - shipped.p10 > unscaled.p90 - unscaled.p10,
    `expected a wider p10-p90, got ${shipped.p90 - shipped.p10} vs ${unscaled.p90 - unscaled.p10}`
  );
  assert.ok(wide.p90 - wide.p10 > shipped.p90 - shipped.p10, 'a larger scale must widen further');
  assert.ok(shipped.p10 < shipped.median && shipped.median < shipped.p90);
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

// ---------------------------------------------------------------------------
// Assembly: the opportunity blend
// ---------------------------------------------------------------------------

/** A projectArgs fixture whose games all carry usable usage counts. */
const usageArgs = (overrides = {}) => projectArgs({
  priorGames: [
    { points: 14, weeksAgo: 1, usage: { carries: 16, targets: 4 } },
    { points: 11, weeksAgo: 2, usage: { carries: 12, targets: 3 } },
    { points: 17, weeksAgo: 3, usage: { carries: 20, targets: 5 } },
    { points: 9, weeksAgo: 4, usage: { carries: 10, targets: 2 } },
  ],
  ...overrides,
});

/** The shipped constants with the opportunity blend turned up to `weight`. */
const atBlend = (weight) => ({
  ...model.MODEL_CONSTANTS,
  usage: { ...model.MODEL_CONSTANTS.usage, blendWeight: weight },
});

test('the opportunity component is INERT at blend weight 0, however much usage the games carry', () => {
  const args = usageArgs();
  // The pre-change reference, built from the model itself: the identical
  // fixture with every usage key removed cannot possibly have run a component
  // that needs them, so whatever it produces IS v2.2 behavior.
  const preChange = model.projectPlayer(usageArgs({ priorGames: stripUsage(args.priorGames) }));

  assert.deepEqual(model.projectPlayer(args), preChange, 'the shipped defaults must not see the usage keys');
  assert.deepEqual(
    model.projectPlayer(usageArgs({ constants: atBlend(0) })),
    preChange,
    'an explicit weight of 0 is the identity'
  );

  // A constants object from before the block existed, key genuinely absent.
  const { usage, ...noUsageBlock } = model.MODEL_CONSTANTS;
  assert.equal('usage' in noUsageBlock, false);
  assert.equal(usage.blendWeight, 0, 'the block really was present to begin with');
  assert.deepEqual(
    model.projectPlayer(usageArgs({ constants: noUsageBlock })),
    preChange,
    'a constants object with no usage block at all behaves exactly as before'
  );
  // Non-numeric junk is read as "off", never coerced into a weight.
  for (const junk of [null, undefined, '', true, NaN, 'a quarter']) {
    assert.deepEqual(
      model.projectPlayer(usageArgs({ constants: atBlend(junk) })),
      preChange,
      `blend weight ${String(junk)} must be read as "off"`
    );
  }
  // Inertness is structural, not numeric: an off component leaves no trace in
  // the explanation either, so the cached `factors` jsonb is byte-identical to
  // every v2.2 row already in production.
  assert.equal('opportunityValue' in preChange.factors.recentProduction, false);
  assert.equal('usageBlendWeight' in preChange.factors.recentProduction, false);
});

test('stripping every usage key leaves the blend with nothing to apply, at any weight', () => {
  const stripped = stripUsage(usageArgs().priorGames);
  const off = model.projectPlayer(usageArgs({ priorGames: stripped }));
  for (const weight of [0.25, 0.6, 1]) {
    const projection = model.projectPlayer(usageArgs({
      priorGames: stripped, constants: atBlend(weight), positionEfficiencyPerOpportunity: 0.6,
    }));
    assert.equal(projection.mean, off.mean, `weight ${weight} fabricated an opportunity estimate`);
    assert.equal(projection.median, off.median);
    assert.equal(projection.factors.recentProduction.perGame, off.factors.recentProduction.perGame);
    // Asked and answered: the component reports that it had nothing, and that
    // the weight actually applied was therefore 0.
    assert.equal(projection.factors.recentProduction.opportunityValue, null);
    assert.equal(projection.factors.recentProduction.usageGames, 0);
    assert.equal(projection.factors.recentProduction.usageBlendWeight, 0);
  }
});

test('a blended baseline lands weakly between the points baseline and the opportunity value', () => {
  // A deliberately low efficiency prior pulls the opportunity estimate well
  // clear of the points baseline, so "between" is a real constraint here.
  const prior = { positionEfficiencyPerOpportunity: 0.35 };
  const off = model.projectPlayer(usageArgs({ ...prior, constants: atBlend(0) }));
  const full = model.projectPlayer(usageArgs({ ...prior, constants: atBlend(1) }));
  const pointsBaseline = off.factors.recentProduction.perGame;
  const opportunityValue = full.factors.recentProduction.opportunityValue;

  assert.ok(
    Math.abs(pointsBaseline - opportunityValue) > 1,
    `the fixture must separate the two estimates: ${pointsBaseline} vs ${opportunityValue}`
  );
  assert.equal(
    full.factors.recentProduction.perGame,
    opportunityValue,
    'weight 1 is the opportunity value exactly, with no residue of the points baseline'
  );
  const lo = Math.min(pointsBaseline, opportunityValue);
  const hi = Math.max(pointsBaseline, opportunityValue);
  let previous = pointsBaseline;
  for (const weight of [0.1, 0.25, 0.4, 0.6, 0.9]) {
    const projection = model.projectPlayer(usageArgs({ ...prior, constants: atBlend(weight) }));
    const blended = projection.factors.recentProduction.perGame;
    assert.ok(
      blended >= lo - 1e-9 && blended <= hi + 1e-9,
      `weight ${weight} left the interval [${lo}, ${hi}] at ${blended}`
    );
    // Monotone toward the opportunity value (the smaller of the two here).
    assert.ok(blended <= previous + 1e-9, `weight ${weight} did not move toward the opportunity value`);
    previous = blended;
    // The blend changes the estimate, never the evidence or the confidence
    // behind it: those stay driven by the points baseline alone.
    assert.equal(projection.effectiveGames, off.effectiveGames);
    assert.equal(projection.sampleSize, off.sampleSize);
    assert.equal(projection.confidence, off.confidence);
    assert.equal(projection.factors.recentProduction.pointsBaselinePerGame, pointsBaseline);
    assert.equal(projection.factors.recentProduction.usageBlendWeight, weight);
    // The explanation still reconstructs the projection exactly.
    assert.ok(Math.abs(projection.factors.recentProduction.pointsContribution - projection.mean) < 0.05);
  }
});

test('K and DEF are never blended, however many stray usage keys their games carry', () => {
  const strayUsage = [
    { points: 9, weeksAgo: 1, usage: { passAttempts: 30, carries: 16, targets: 4 } },
    { points: 12, weeksAgo: 2, usage: { passAttempts: 28, carries: 12, targets: 3 } },
    { points: 6, weeksAgo: 3, usage: { passAttempts: 35, carries: 20, targets: 5 } },
    { points: 11, weeksAgo: 4, usage: { passAttempts: 31, carries: 10, targets: 2 } },
  ];
  for (const position of ['K', 'DEF', 'LB', 'DL', 'CB']) {
    const off = model.projectPlayer(usageArgs({ position, priorGames: strayUsage }));
    for (const weight of [0.25, 0.6, 1]) {
      const on = model.projectPlayer(usageArgs({
        position,
        priorGames: strayUsage,
        constants: atBlend(weight),
        positionEfficiencyPerOpportunity: 0.6,
      }));
      assert.equal(on.mean, off.mean, `${position} moved at weight ${weight}`);
      assert.equal(on.median, off.median, `${position} moved at weight ${weight}`);
      assert.equal(on.p10, off.p10);
      assert.equal(on.p90, off.p90);
      assert.equal(on.factors.recentProduction.perGame, off.factors.recentProduction.perGame);
      assert.equal(on.factors.recentProduction.usageGames, 0, `${position} counted an opportunity`);
      assert.equal(on.factors.recentProduction.opportunityValue, null);
      assert.equal(on.factors.recentProduction.usageBlendWeight, 0);
    }
  }
});

test('a QB is blended on pass attempts, and only on pass attempts', () => {
  const attempts = [
    { points: 22, weeksAgo: 1, usage: { passAttempts: 38, carries: 4, targets: null } },
    { points: 14, weeksAgo: 2, usage: { passAttempts: 26, carries: 2, targets: null } },
    { points: 19, weeksAgo: 3, usage: { passAttempts: 33, carries: 6, targets: null } },
  ];
  const blended = model.projectPlayer(usageArgs({
    position: 'QB', priorGames: attempts, constants: atBlend(0.5), positionEfficiencyPerOpportunity: 0.4,
  }));
  assert.equal(blended.factors.recentProduction.usageGames, 3);
  // Expected opportunities are the recency-weighted attempts and nothing else:
  // a QB whose carries were folded in would land above the 38-attempt maximum.
  const expected = blended.factors.recentProduction.expectedOpportunities;
  assert.ok(expected >= 26 && expected <= 38, `expected opportunities ${expected} left the attempt range`);
  // Missing targets are irrelevant to a QB, so the component still applies.
  assert.ok(blended.factors.recentProduction.opportunityValue != null);
  assert.equal(blended.factors.recentProduction.usageBlendWeight, 0.5);
});
