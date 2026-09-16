'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const marketFactorReplay = require('../../scripts/holdout/lib/marketFactorReplay');
const successorEval = require('../../scripts/holdout/lib/successorEval');

const {
  marketEffectFor, replayRows, weekEligibility, evaluateMarketFactor, renderReport, buildArms,
} = marketFactorReplay;

// ---------------------------------------------------------------------------
// marketEffectFor - the capped/shrunk candidate effect for one captured factor
// ---------------------------------------------------------------------------

test('marketEffectFor is null when the factor is absent, unavailable, or has no finite rawEffect', () => {
  assert.equal(marketEffectFor(null, { maxEffect: 0.1 }), null);
  assert.equal(marketEffectFor(undefined, { maxEffect: 0.1 }), null);
  assert.equal(
    marketEffectFor({ available: false, reason: 'no slate baseline' }, { maxEffect: 0.1 }),
    null,
    'a captured unavailable factor never contributes, regardless of the candidate cap'
  );
  assert.equal(marketEffectFor({ available: true, rawEffect: null }, { maxEffect: 0.1 }), null);
  assert.equal(marketEffectFor({ available: true, rawEffect: NaN }, { maxEffect: 0.1 }), null);
  assert.equal(marketEffectFor({ available: true, rawEffect: 'not-a-number' }, { maxEffect: 0.1 }), null);
});

test('marketEffectFor clamps rawEffect * shrink to +/- maxEffect - the worked examples', () => {
  const factor = { available: true, rawEffect: -0.10 };
  assert.equal(marketEffectFor(factor, { maxEffect: 0.05, shrink: 1 }), -0.05, 'capped at 0.05');
  assert.equal(marketEffectFor(factor, { maxEffect: 0.25, shrink: 1 }), -0.10, 'under the 0.25 cap, unclamped');
  assert.equal(marketEffectFor(factor, { maxEffect: 0.25, shrink: 0.5 }), -0.05, 'shrunk by half before the cap');
  assert.equal(marketEffectFor(factor, { maxEffect: 0, shrink: 1 }), 0, 'market-off: capped to exactly 0, not null');

  const positive = { available: true, rawEffect: 0.30 };
  assert.equal(marketEffectFor(positive, { maxEffect: 0.15, shrink: 1 }), 0.15, 'clamp also caps the positive side');

  // pg returns projection_snapshot_players.factors as parsed jsonb already, but
  // rawEffect could still arrive as a numeric string from a hand-built fixture.
  assert.equal(
    marketEffectFor({ available: true, rawEffect: '-0.10' }, { maxEffect: 0.25, shrink: 1 }),
    -0.10,
    'a numeric-string rawEffect is coerced the same as a number'
  );
});

// ---------------------------------------------------------------------------
// replayRows - shifting a captured row's distribution by mean * effect
// ---------------------------------------------------------------------------

function row(overrides = {}) {
  return {
    playerId: 1,
    position: 'WR',
    mean: 10,
    median: 10,
    p10: 5,
    p25: 8,
    p75: 12,
    p90: 15,
    activeProbability: 1,
    factors: { gameEnvironment: { available: true, rawEffect: -0.10 } },
    ...overrides,
  };
}

test('replayRows shifts mean/median/p10/p25/p75/p90 by mean * effect and carries marketEffect - worked numbers', () => {
  const rows = [row()];

  const capped05 = replayRows(rows, { maxEffect: 0.05, shrink: 1 });
  assert.equal(capped05[0].marketEffect, -0.05);
  assert.equal(capped05[0].mean, 9.5);
  assert.equal(capped05[0].median, 9.5);
  assert.equal(capped05[0].p10, 4.5, 'p10 shifts by the same -0.5 delta as mean');
  assert.equal(capped05[0].p25, 7.5);
  assert.equal(capped05[0].p75, 11.5);
  assert.equal(capped05[0].p90, 14.5);

  const capped25 = replayRows(rows, { maxEffect: 0.25, shrink: 1 });
  assert.equal(capped25[0].marketEffect, -0.10);
  assert.equal(capped25[0].mean, 9, 'delta -1.0 on a mean of 10');

  const shrunk = replayRows(rows, { maxEffect: 0.25, shrink: 0.5 });
  assert.equal(shrunk[0].marketEffect, -0.05);
  assert.equal(shrunk[0].mean, 9.5, 'delta -0.5 under shrink 0.5');
});

test('replayRows never mutates its input rows', () => {
  const rows = [row()];
  const original = JSON.parse(JSON.stringify(rows));
  replayRows(rows, { maxEffect: 0.05, shrink: 1 });
  assert.deepEqual(rows, original);
});

test('replayRows leaves an unavailable factor untouched, marketEffect null', () => {
  const unavailable = [row({ factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } } })];
  const [out] = replayRows(unavailable, { maxEffect: 0.25, shrink: 1 });
  assert.equal(out.marketEffect, null);
  assert.equal(out.mean, 10);
  assert.equal(out.p10, 5);
  assert.equal(out.p90, 15);
});

test('replayRows leaves a row with no gameEnvironment factor at all untouched', () => {
  const noFactor = [row({ factors: {} })];
  const [out] = replayRows(noFactor, { maxEffect: 0.25, shrink: 1 });
  assert.equal(out.marketEffect, null);
  assert.equal(out.mean, 10);
});

test('replayRows handles pg-string decimal columns', () => {
  const stringy = [row({
    mean: '10.00', median: '10.00', p10: '5.00', p25: '8.00', p75: '12.00', p90: '15.00',
  })];
  const [out] = replayRows(stringy, { maxEffect: 0.05, shrink: 1 });
  assert.equal(out.mean, 9.5);
  assert.equal(out.p10, 4.5);
});

// ---------------------------------------------------------------------------
// weekEligibility
// ---------------------------------------------------------------------------

test('weekEligibility is eligible when at least one row has an available gameEnvironment factor', () => {
  const rows = [
    row({ playerId: 1, factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } } }),
    row({ playerId: 2, factors: { gameEnvironment: { available: true, rawEffect: 0.02 } } }),
  ];
  assert.deepEqual(weekEligibility(rows), { eligible: true, available: 1, reason: null });
});

test('weekEligibility excludes a week where every row reports the same unavailable reason', () => {
  const rows = [
    row({ playerId: 1, factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } } }),
    row({ playerId: 2, factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } } }),
  ];
  assert.deepEqual(weekEligibility(rows), { eligible: false, available: 0, reason: 'no slate baseline' });
});

test('weekEligibility reports the most common reason when rows disagree, and falls back when the factor is entirely absent', () => {
  const rows = [
    row({ playerId: 1, factors: { gameEnvironment: { available: false, reason: 'no market quote' } } }),
    row({ playerId: 2, factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } } }),
    row({ playerId: 3, factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } } }),
  ];
  assert.equal(weekEligibility(rows).reason, 'no slate baseline');

  const noFactorAtAll = [row({ playerId: 1, factors: {} }), row({ playerId: 2, factors: null })];
  assert.deepEqual(
    weekEligibility(noFactorAtAll),
    { eligible: false, available: 0, reason: 'no gameEnvironment factor stored' }
  );
});

// ---------------------------------------------------------------------------
// buildArms
// ---------------------------------------------------------------------------

test('buildArms puts market-off first and crosses caps x shrinks for the rest', () => {
  const arms = buildArms({ caps: [0.05, 0.10], shrinks: [1, 0.5] });
  assert.deepEqual(arms[0], { key: 'market-off', maxEffect: 0, shrink: 1 });
  assert.equal(arms.length, 1 + 2 * 2);
  assert.ok(arms.some((a) => a.key === 'cap0.10-shrink1' && a.maxEffect === 0.10 && a.shrink === 1));
  assert.ok(arms.some((a) => a.key === 'cap0.05-shrink0.5' && a.maxEffect === 0.05 && a.shrink === 0.5));
});

test('ARMS_DEFAULT has the documented caps x shrinks plus the market-off control', () => {
  assert.equal(marketFactorReplay.ARMS_DEFAULT.length, 1 + 4 * 2);
  assert.equal(marketFactorReplay.ARMS_DEFAULT[0].key, 'market-off');
});

// ---------------------------------------------------------------------------
// evaluateMarketFactor - the whole comparison on a synthetic two-week ledger
// ---------------------------------------------------------------------------

const SEASON = 2026;

function excludedWeekRows() {
  // Every row unavailable for the same reason: week 1 is excluded wholesale.
  return [1, 2].map((playerId) => row({
    playerId,
    factors: { gameEnvironment: { available: false, reason: 'no slate baseline' } },
  }));
}

/**
 * Week 2's rows are built so the market correction is exactly right: actual
 * = mean * (1 + rawEffect), and the cap is generous enough (0.5) that
 * `replayRows` applies rawEffect UNCLAMPED. A candidate arm therefore lands
 * its shifted mean exactly on actual (MAE 0), while market-off (effect
 * pinned to 0) leaves the original miss in place (MAE > 0).
 */
function eligibleWeekRows() {
  return [
    row({
      playerId: 1, mean: 10, median: 10, p10: 5, p25: 8, p75: 12, p90: 15,
      factors: { gameEnvironment: { available: true, rawEffect: -0.08 } },
    }),
    row({
      playerId: 2, position: 'RB', mean: 8, median: 8, p10: 4, p25: 6, p75: 10, p90: 12,
      factors: { gameEnvironment: { available: true, rawEffect: 0.06 } },
    }),
  ];
}

function syntheticLedger() {
  const week1 = { header: { season: SEASON, week: 1 }, rows: excludedWeekRows() };
  const week2 = { header: { season: SEASON, week: 2 }, rows: eligibleWeekRows() };
  // Same expression shape `replayRows` itself uses (`mean + mean * effect`,
  // not `mean * (1 + effect)`) so the two computations round identically in
  // floating point and the "correct" arm's MAE lands on exactly 0, not an
  // epsilon away from it.
  const actuals = new Map([
    [`${SEASON}:2:1`, 10 + 10 * -0.08],
    [`${SEASON}:2:2`, 8 + 8 * 0.06],
  ]);
  return {
    profiles: [{ name: 'half_ppr', weeks: [week1, week2], actuals }],
  };
}

test('evaluateMarketFactor excludes the no-slate-baseline week and reports market-off equal to raw metricsForArm', () => {
  const { profiles } = syntheticLedger();
  const result = evaluateMarketFactor({ profiles, arms: [{ key: 'market-off', maxEffect: 0, shrink: 1 }] });

  const profile = result.profiles.half_ppr;
  assert.deepEqual(profile.eligibleWeeks, [{ season: SEASON, week: 2 }]);
  assert.deepEqual(profile.excludedWeeks, [{ week: 1, reason: 'no slate baseline' }]);

  const week2 = profiles[0].weeks[1];
  const rawMetrics = successorEval.metricsForArm({
    rows: week2.rows, actuals: profiles[0].actuals, season: SEASON, week: 2,
  });
  const marketOffWeekly = profile.byArm['market-off'].weekly[0];
  assert.equal(marketOffWeekly.mae, rawMetrics.mae);
  assert.equal(marketOffWeekly.spearman, rawMetrics.spearman);
  assert.equal(marketOffWeekly.pairwise, rawMetrics.pairwise);
  assert.ok(rawMetrics.mae > 0, 'the raw captured means miss the market-adjusted actuals');
});

test('evaluateMarketFactor: a correctly-capped arm drives MAE to 0 where market-off does not', () => {
  const { profiles } = syntheticLedger();
  const arms = [
    { key: 'market-off', maxEffect: 0, shrink: 1 },
    { key: 'correct', maxEffect: 0.5, shrink: 1 },
  ];
  const result = evaluateMarketFactor({ profiles, arms });
  const profile = result.profiles.half_ppr;

  assert.equal(profile.byArm['market-off'].season.mae > 0, true);
  assert.equal(profile.byArm.correct.season.mae, 0, 'the corrected mean lands exactly on the market-adjusted actual');
});

test('evaluateMarketFactor: a profile with zero eligible weeks reports every week excluded and empty byArm weeklies', () => {
  const week1 = { header: { season: SEASON, week: 1 }, rows: excludedWeekRows() };
  const result = evaluateMarketFactor({
    profiles: [{ name: 'standard', weeks: [week1], actuals: new Map() }],
    arms: [{ key: 'market-off', maxEffect: 0, shrink: 1 }],
  });
  const profile = result.profiles.standard;
  assert.equal(profile.eligibleWeeks.length, 0);
  assert.deepEqual(profile.excludedWeeks, [{ week: 1, reason: 'no slate baseline' }]);
  assert.deepEqual(profile.byArm['market-off'].weekly, []);
  assert.equal(profile.byArm['market-off'].season.weeksScored, 0);
});

// ---------------------------------------------------------------------------
// renderReport
// ---------------------------------------------------------------------------

test('renderReport prints the zero-eligible sentence for a profile with nothing to compare', () => {
  const week1 = { header: { season: SEASON, week: 1 }, rows: excludedWeekRows() };
  const result = evaluateMarketFactor({
    profiles: [{ name: 'standard', weeks: [week1], actuals: new Map() }],
  });
  const rendered = renderReport(result);
  assert.match(rendered, /## standard/);
  assert.match(rendered, /no week with a market quote at capture; nothing to compare/);
  assert.match(rendered, /excluded weeks:/);
  assert.match(rendered, /week 1: no slate baseline/);
});

test('renderReport prints an arm table with the documented columns for a profile with eligible weeks', () => {
  const { profiles } = syntheticLedger();
  const arms = [
    { key: 'market-off', maxEffect: 0, shrink: 1 },
    { key: 'correct', maxEffect: 0.5, shrink: 1 },
  ];
  const result = evaluateMarketFactor({ profiles, arms });
  const rendered = renderReport(result);
  assert.match(rendered, /## half_ppr/);
  assert.match(rendered, /\| arm \| MAE \| rho \| pairwise \| cov80 \| cov50 \| weeks \|/);
  assert.match(rendered, /\| market-off \|/);
  assert.match(rendered, /\| correct \|/);
  assert.match(rendered, /week 1: no slate baseline/);
  assert.doesNotMatch(rendered, /nothing to compare/, 'a profile with eligible weeks never prints the zero-eligible sentence');
});
