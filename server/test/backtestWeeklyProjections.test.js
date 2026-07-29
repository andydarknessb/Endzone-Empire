const test = require('node:test');
const assert = require('node:assert/strict');
const backtest = require('../../scripts/backtest-weekly-projections');
const { getExpertProvider, setExpertProvider, expertCoverage } = require('../services/expertProjection.provider');

/**
 * The backtest script is the only thing that entitles anyone to claim the new
 * model is better than the old one, so its metrics are unit-tested against
 * hand-computable fixtures rather than trusted because they run.
 */

const observation = (overrides) => ({
  season: 2025, week: 3, position: 'RB', playerId: 1, predicted: 10, actual: 10, p10: null, p90: null,
  ...overrides,
});

test('parseArgs defaults to a chronological in-season window and the shipped config', () => {
  const args = backtest.parseArgs([]);
  assert.deepEqual(args.seasons, [2025]);
  assert.equal(args.weeks[0], 2, 'week 1 has no in-season history for the incumbent baseline');
  assert.equal(args.weeks.at(-1), 18);
  assert.deepEqual(args.configs, ['default']);
  assert.equal(args.out, null, 'nothing is written unless --out is passed');
});

test('parseArgs accepts repeated seasons, weeks, positions and configs', () => {
  const args = backtest.parseArgs([
    '--season', '2024', '--season', '2025', '--week', '5', '--position', 'wr',
    '--config', 'fast-recency', '--out', 'out.json',
  ]);
  assert.deepEqual(args.seasons, [2024, 2025]);
  assert.deepEqual(args.weeks, [5]);
  assert.deepEqual(args.positions, ['WR']);
  assert.deepEqual(args.configs, ['fast-recency']);
  assert.equal(args.out, 'out.json');
});

/**
 * Since v2.2 shipped the swept `slow8-blend-25` pair as the defaults, several
 * configurations that were real variations against the v2.1 reference now
 * evaluate to the shipped constants exactly. That is a fact about the sweep
 * having landed, not a bug, but it is asserted rather than left implicit: a
 * config silently collapsing onto the defaults would otherwise show up in a
 * future run as a mysteriously identical row.
 *
 * NOTE for whoever runs the next sweep: these configs override only the
 * constants they name and inherit the rest from whatever is shipped, so their
 * MEANING moved when the defaults moved. `blend-25` scored the 4-week
 * half-life during the selection run; re-running it today scores the 8-week
 * one. Reproducing the v2.1-era numbers means pinning the half-life explicitly.
 */
const COINCIDES_WITH_DEFAULTS = [
  // Selected by the v2.2 cross, so all four are now the shipped constants.
  'slow-recency', 'light-slow-8', 'blend-25', 'slow8-blend-25',
  // Older, and deliberate: interval-145 has been the shipped intervalScale
  // since v2.1. It exists as the labeled midpoint of the interval sweep.
  'interval-145',
  // Selected by the v3 usage sweep on the enriched seasons. usage-40 and
  // usage-60 stay real variations: they were REJECTED for regressing 2025
  // lineup regret, so a run must still be able to reproduce that finding.
  'usage-25',
];

test('configurations that now equal the shipped defaults are known and listed', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  for (const [name, build] of Object.entries(backtest.CONFIGURATIONS)) {
    if (name === 'default') continue;
    const coincides = COINCIDES_WITH_DEFAULTS.includes(name);
    const constants = build(base);
    assert.equal(
      JSON.stringify(constants) === JSON.stringify(base),
      coincides,
      coincides
        ? `${name} is listed as coinciding with the defaults but no longer does`
        : `${name} silently collapsed onto the shipped defaults and would score an identical row`
    );
  }
});

test('every named configuration is a real variation of the shipped constants', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  assert.equal(backtest.CONFIGURATIONS.default(base), base);
  assert.equal(backtest.CONFIGURATIONS['fast-recency'](base).baseline.recencyHalfLifeWeeks, 2);
  assert.equal(backtest.CONFIGURATIONS['slow-recency'](base).baseline.recencyHalfLifeWeeks, 8);
  assert.equal(
    backtest.CONFIGURATIONS['heavy-shrink'](base).baseline.priorSeasonPseudoGames,
    base.baseline.priorSeasonPseudoGames * 2
  );
  assert.equal(backtest.CONFIGURATIONS['usage-25'](base).usage.blendWeight, 0.25); // == the default

  assert.equal(backtest.CONFIGURATIONS['usage-40'](base).usage.blendWeight, 0.40);
  assert.equal(backtest.CONFIGURATIONS['usage-60'](base).usage.blendWeight, 0.60);
  // The stored-history arms are real variations of the CONSTANTS, which is all
  // this test can check. Whether they produce a different ROW is a property of
  // the data, not of the config: see the coincidence note below.
  assert.equal(backtest.CONFIGURATIONS['xseason-vs'](base).versusOpponent.crossSeason, true);
  assert.equal(backtest.CONFIGURATIONS['stored-homeaway'](base).homeAway.useStoredHistory, true);
  assert.equal(backtest.CONFIGURATIONS['xseason-both'](base).versusOpponent.crossSeason, true);
  assert.equal(backtest.CONFIGURATIONS['xseason-both'](base).homeAway.useStoredHistory, true);
  assert.equal(backtest.CONFIGURATIONS['interval-130'](base).simulation.intervalScale, 1.30);
  assert.equal(backtest.CONFIGURATIONS['interval-145'](base).simulation.intervalScale, 1.45);
  assert.equal(backtest.CONFIGURATIONS['interval-160'](base).simulation.intervalScale, 1.60);
  // The interval sweep must vary the interval and nothing else, or a coverage
  // comparison would be confounded by a baseline change.
  assert.deepEqual(
    backtest.CONFIGURATIONS['interval-160'](base).baseline,
    base.baseline
  );
  // A sweep must never mutate the shipped constants out from under the app.
  assert.equal(base.baseline.recencyHalfLifeWeeks, model.MODEL_CONSTANTS.baseline.recencyHalfLifeWeeks);
  assert.equal(base.simulation.intervalScale, model.MODEL_CONSTANTS.simulation.intervalScale);
  assert.equal(base.usage.blendWeight, model.MODEL_CONSTANTS.usage.blendWeight);
});

/**
 * `usage-25` won this sweep and became the v3 default, so the two heavier arms
 * are the part that still has to work: they are the reproduction path for the
 * finding that rejected them (2025 lineup regret 13.76 -> 14.54). A config that
 * drifted off the weight it names would make that finding unreproducible.
 */
test('the usage sweep varies only the opportunity blend weight', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  assert.equal(base.usage.blendWeight, 0.25, '`default` is now the selected 0.25 arm');
  const expected = { 'usage-25': 0.25, 'usage-40': 0.40, 'usage-60': 0.60 };
  for (const [name, weight] of Object.entries(expected)) {
    const constants = backtest.CONFIGURATIONS[name](base);
    assert.equal(constants.usage.blendWeight, weight, name);
    // The gate and the shrinkage move with neither the weight nor each other:
    // a blend-weight comparison confounded by a different minimum usage-game
    // count would not be measuring the blend at all.
    assert.equal(constants.usage.minUsageGames, base.usage.minUsageGames, name);
    assert.equal(
      constants.usage.efficiencyPseudoOpportunities,
      base.usage.efficiencyPseudoOpportunities,
      name
    );
    assert.deepEqual(constants.baseline, base.baseline, name);
    assert.deepEqual(constants.simulation, base.simulation, name);
  }
  // usage-60 ran above, so an in-place mutation would show up right here.
  assert.equal(base.usage.blendWeight, 0.25);
  assert.equal(model.MODEL_CONSTANTS.usage.blendWeight, 0.25);
});

/**
 * The stored-history sweep. Each arm flips ONE of the two gates that let the
 * feature builders read the backfilled per-week gameTeam/gameOpponent keys, and
 * `xseason-both` crosses them, so a gain from cross-season head-to-head history
 * cannot be credited to prior-season orientation or the other way round.
 *
 * ON COINCIDENCE, which the allowlist above deliberately does NOT cover: these
 * three differ from the shipped constants (both gates ship false), so they are
 * real variations and belong outside COINCIDES_WITH_DEFAULTS. The engine does
 * thread its per-run constants into buildPriorGames /
 * buildVersusOpponentMeetings (asserted in projection.service.test.js), so the
 * arms are live. They can still score a row identical to `default` on
 * UNENRICHED history, because a stat row with no stored gameTeam is resolved
 * exactly as it always was; an identical row is evidence about the data, not
 * about the gates.
 */
test('the stored-history sweep varies only the two gates, one at a time and crossed', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  assert.equal(base.versusOpponent.crossSeason, false, 'the gates ship off');
  assert.equal(base.homeAway.useStoredHistory, false);
  const expected = {
    'xseason-vs': [true, false],
    'stored-homeaway': [false, true],
    'xseason-both': [true, true],
  };
  for (const [name, [crossSeason, useStoredHistory]] of Object.entries(expected)) {
    const constants = backtest.CONFIGURATIONS[name](base);
    assert.equal(constants.versusOpponent.crossSeason, crossSeason, name);
    assert.equal(constants.homeAway.useStoredHistory, useStoredHistory, name);
    // The rest of both blocks, and every other block, must ride along
    // unchanged: a head-to-head comparison confounded by a moved cap or a
    // different shrinkage would not be measuring the gate.
    assert.equal(constants.versusOpponent.maxEffect, base.versusOpponent.maxEffect, name);
    assert.equal(constants.versusOpponent.shrinkage, base.versusOpponent.shrinkage, name);
    assert.equal(constants.versusOpponent.halfLifeSeasons, base.versusOpponent.halfLifeSeasons, name);
    assert.equal(constants.homeAway.minGamesPerSide, base.homeAway.minGamesPerSide, name);
    assert.equal(constants.homeAway.maxEffect, base.homeAway.maxEffect, name);
    assert.deepEqual(constants.baseline, base.baseline, name);
    assert.deepEqual(constants.usage, base.usage, name);
    assert.deepEqual(constants.simulation, base.simulation, name);
  }
  // Sweeping must not write a candidate gate back into the shipped object.
  assert.equal(model.MODEL_CONSTANTS.versusOpponent.crossSeason, false);
  assert.equal(model.MODEL_CONSTANTS.homeAway.useStoredHistory, false);
});

test('the older sweeps inherit the usage block untouched', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  for (const [name, build] of Object.entries(backtest.CONFIGURATIONS)) {
    if (name.startsWith('usage-') || name === 'default') continue;
    assert.deepEqual(
      build(base).usage,
      base.usage,
      `${name} must not switch the opportunity component on as a side effect`
    );
  }
});

test('no configuration outside the schedule-context sweep opens a schedule-context gate', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  // The three gates a config may deliberately open: two stored-history reads
  // and the home/away factor's scoring gate. Every other arm has to leave both
  // groups exactly as shipped, or a half-life comparison would quietly be a
  // comparison of something else as well.
  const scheduleSweep = ['xseason-vs', 'stored-homeaway', 'xseason-both', 'homeaway-on', 'homeaway-on-stored'];
  for (const [name, build] of Object.entries(backtest.CONFIGURATIONS)) {
    if (scheduleSweep.includes(name) || name === 'default') continue;
    const constants = build(base);
    assert.deepEqual(constants.versusOpponent, base.versusOpponent, name);
    assert.deepEqual(constants.homeAway, base.homeAway, name);
  }
  // And the sweep arms really do open exactly the gate they name.
  assert.equal(backtest.CONFIGURATIONS['homeaway-on'](base).homeAway.enabled, true);
  assert.equal(backtest.CONFIGURATIONS['homeaway-on'](base).homeAway.useStoredHistory, false);
  assert.equal(backtest.CONFIGURATIONS['stored-homeaway'](base).homeAway.enabled, false,
    'the stored-history arm is inert on its own while the scoring gate is shut');
});

test('the half-life sweep varies the half-life and nothing else', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  const expected = {
    'light-slow-8': 8, 'light-slow-12': 12, 'light-slow-16': 16, 'light-flat': 9999,
  };
  for (const [name, halfLife] of Object.entries(expected)) {
    const constants = backtest.CONFIGURATIONS[name](base);
    assert.equal(constants.baseline.recencyHalfLifeWeeks, halfLife, name);
    // Same shrinkage, same interval: a half-life comparison must not be
    // confounded by a second changed constant.
    assert.equal(constants.baseline.priorSeasonPseudoGames, base.baseline.priorSeasonPseudoGames, name);
    assert.equal(constants.baseline.positionPseudoGames, base.baseline.positionPseudoGames, name);
    assert.equal(
      constants.baseline.currentSeasonMeanBlendWeight,
      base.baseline.currentSeasonMeanBlendWeight,
      `${name} must inherit the blend weight, not move it as well`
    );
    assert.deepEqual(constants.simulation, base.simulation, name);
  }
  assert.equal(base.baseline.recencyHalfLifeWeeks, model.MODEL_CONSTANTS.baseline.recencyHalfLifeWeeks);
});

test('the blend sweep varies the current-season blend, crossed with the half-life', () => {
  const model = require('../services/projectionModel');
  const base = model.MODEL_CONSTANTS;
  // v2.2 shipped 0.25 out of this sweep, so the sweep's own reference point is
  // now a blended one. The configs still have to produce the weights they name.
  assert.equal(base.baseline.currentSeasonMeanBlendWeight, 0.25);
  const expected = {
    'blend-25': [0.25, base.baseline.recencyHalfLifeWeeks],
    'blend-50': [0.50, base.baseline.recencyHalfLifeWeeks],
    'blend-75': [0.75, base.baseline.recencyHalfLifeWeeks],
    'slow8-blend-25': [0.25, 8],
    'slow8-blend-50': [0.50, 8],
  };
  for (const [name, [weight, halfLife]] of Object.entries(expected)) {
    const constants = backtest.CONFIGURATIONS[name](base);
    assert.equal(constants.baseline.currentSeasonMeanBlendWeight, weight, name);
    assert.equal(constants.baseline.recencyHalfLifeWeeks, halfLife, name);
    assert.deepEqual(constants.simulation, base.simulation, name);
  }
  // Sweeping must not write the candidate weight back into the shipped object:
  // blend-75 ran above, so an in-place mutation would show up right here.
  assert.equal(base.baseline.currentSeasonMeanBlendWeight, 0.25);
  assert.equal(model.MODEL_CONSTANTS.baseline.currentSeasonMeanBlendWeight, 0.25);
});

test('every configuration name is documented in the usage block', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest-weekly-projections.js'), 'utf8'
  );
  // The usage docblock, not the eslint pragma that precedes it.
  const start = source.indexOf('/**');
  const docblock = source.slice(start, source.indexOf('*/', start));
  assert.ok(docblock.includes('Usage:'), 'located the wrong comment');
  for (const name of Object.keys(backtest.CONFIGURATIONS)) {
    assert.ok(
      docblock.includes(` ${name} `) || docblock.includes(` ${name}\n`),
      `--config ${name} is accepted but the usage block never lists it`
    );
  }
});

test('spearman is 1 for a perfectly ordered set and -1 when reversed', () => {
  assert.equal(backtest.spearman([[1, 1], [2, 2], [3, 3], [4, 4]]), 1);
  assert.equal(backtest.spearman([[1, 4], [2, 3], [3, 2], [4, 1]]), -1);
  assert.equal(backtest.spearman([[1, 1]]), null, 'too few points to correlate');
});

test('pairwise accuracy counts only same-week, same-position pairs with different actuals', () => {
  const observations = [
    observation({ playerId: 1, predicted: 20, actual: 25 }),
    observation({ playerId: 2, predicted: 10, actual: 12 }),
    observation({ playerId: 3, predicted: 5, actual: 30 }), // ranked wrong
    // A different position and a different week never pair with the above.
    observation({ playerId: 4, position: 'WR', predicted: 9, actual: 1 }),
    observation({ playerId: 5, week: 4, predicted: 9, actual: 1 }),
  ];
  const { accuracy, pairs } = backtest.pairwiseAccuracy(observations);
  assert.equal(pairs, 3, 'three RB pairs in week 3');
  assert.ok(Math.abs(accuracy - 1 / 3) < 1e-9, `got ${accuracy}`);
});

test('pairwise accuracy skips pairs where either prediction is missing', () => {
  const { pairs } = backtest.pairwiseAccuracy([
    observation({ playerId: 1, predicted: null, actual: 25 }),
    observation({ playerId: 2, predicted: 10, actual: 12 }),
  ]);
  assert.equal(pairs, 0);
});

test('regret is zero when the model picks the lineup hindsight would have picked', () => {
  const roster = [
    ['QB', 20], ['RB', 18], ['RB', 16], ['WR', 14], ['WR', 12],
    ['TE', 10], ['RB', 9], ['K', 8], ['DEF', 7], ['WR', 2],
  ].map(([position, points], i) => observation({
    playerId: i + 1, position, predicted: points, actual: points,
  }));
  const { meanRegret, weeks } = backtest.lineupRegret(roster, 10);
  assert.equal(weeks, 1);
  assert.equal(meanRegret, 0);
});

test('regret is positive when the model ranks the wrong player highest', () => {
  const roster = [
    ['QB', 20, 20], ['RB', 18, 18], ['RB', 16, 16], ['WR', 14, 14], ['WR', 12, 12],
    ['TE', 10, 10], ['RB', 9, 9], ['K', 8, 8], ['DEF', 7, 7],
    // The model thinks this WR is a bust; he actually outscores everyone.
    ['WR', 1, 40],
  ].map(([position, predicted, actual], i) => observation({
    playerId: i + 1, position, predicted, actual,
  }));
  const { meanRegret } = backtest.lineupRegret(roster, 10);
  assert.ok(meanRegret > 0, `expected regret, got ${meanRegret}`);
});

test('summarize separates missing predictions from zero-point predictions', () => {
  const summary = backtest.summarize([
    observation({ playerId: 1, predicted: 0, actual: 0 }),
    observation({ playerId: 2, predicted: null, actual: 22 }),
  ]);
  assert.equal(summary.samples, 1, 'a missing prediction is not a 0-point prediction');
  assert.equal(summary.missing, 1);
  assert.equal(summary.mae, 0);
});

test('summarize reports p10-p90 coverage only over rows that carry an interval', () => {
  const summary = backtest.summarize([
    observation({ playerId: 1, predicted: 10, actual: 11, p10: 5, p90: 15 }), // inside
    observation({ playerId: 2, predicted: 10, actual: 40, p10: 5, p90: 15 }), // outside
    observation({ playerId: 3, predicted: 10, actual: 11 }), // no interval
  ]);
  assert.equal(summary.intervalSamples, 2);
  assert.equal(summary.intervalCoverageP10P90, 0.5);
});

test('summarize computes MAE and RMSE over the errors it actually has', () => {
  const summary = backtest.summarize([
    observation({ playerId: 1, predicted: 10, actual: 13 }),
    observation({ playerId: 2, predicted: 10, actual: 6 }),
  ]);
  assert.equal(summary.mae, 3.5);
  assert.ok(Math.abs(summary.rmse - Math.sqrt((9 + 16) / 2)) < 1e-9);
});

// ---------------------------------------------------------------------------
// Expert consensus boundary
// ---------------------------------------------------------------------------

test('the shipped expert provider is a no-op that reports itself unavailable', async () => {
  const provider = getExpertProvider();
  assert.equal(provider.available, false);
  assert.equal(provider.name, null);
  assert.equal((await provider.getWeeklyProjections()).size, 0);
  assert.deepEqual(expertCoverage(), { status: 'unavailable', source: null });
});

test('a real provider would be reported as available by name', (t) => {
  t.after(() => setExpertProvider(null));
  setExpertProvider({
    name: 'licensed-feed',
    available: true,
    async getWeeklyProjections() { return new Map(); },
  });
  assert.deepEqual(expertCoverage(), { status: 'available', source: 'licensed-feed' });
  setExpertProvider(null);
  assert.deepEqual(expertCoverage(), { status: 'unavailable', source: null });
});
