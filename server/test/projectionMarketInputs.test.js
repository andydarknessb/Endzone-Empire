const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../services/projectionModel');
const vegas = require('../services/vegasOdds.provider');

// ---------------------------------------------------------------------------
// The inert-merge contract
//
// Both new inputs ship at a value that structurally cannot reach the output
// (gameEnvironment.maxEffect 0, expertConsensus.blendWeight 0). That is the
// entire reason neither bumps MODEL_VERSION, so it is the first thing tested
// and it is tested against real payloads rather than absent ones: "we did not
// pass the data" would prove nothing about what happens when the data arrives.
// ---------------------------------------------------------------------------

const PRIOR_GAMES = [
  { points: 14.2, weeksAgo: 1, sameSeason: true },
  { points: 8.6, weeksAgo: 2, sameSeason: true },
  { points: 19.4, weeksAgo: 3, sameSeason: true },
  { points: 11.1, weeksAgo: 4, sameSeason: true },
];

function project(extra = {}) {
  return model.projectPlayer({
    playerId: 42,
    position: 'WR',
    season: 2026,
    week: 8,
    scoringHashValue: 'abc123',
    priorGames: PRIOR_GAMES,
    priorSeasonPerGame: 12.0,
    positionBaselinePerGame: 10.5,
    playerResiduals: [-3.2, 1.4, -0.8, 4.6, 2.1],
    pooledResiduals: [-5, -2, 0, 2, 5],
    ...extra,
  });
}

const QUOTED = model.gameEnvironmentEffect({
  impliedPoints: 29.5,
  opponentImplied: 17.5,
  slateAverageImplied: 22.0,
  position: 'WR',
});

test('a live market quote does not move a single output number at shipped constants', () => {
  const without = project();
  const withMarket = project({ gameEnvironment: QUOTED });

  for (const key of ['mean', 'median', 'p10', 'p25', 'p75', 'p90']) {
    assert.equal(withMarket[key], without[key], `${key} moved`);
  }
  // The quote is still REPORTED — inert means it cannot score, not that it is
  // discarded. The UI is meant to show the market as context.
  assert.equal(withMarket.factors.gameEnvironment.available, true);
  assert.equal(withMarket.factors.gameEnvironment.scored, false);
  assert.equal(withMarket.factors.gameEnvironment.impliedPoints, 29.5);
  assert.equal(withMarket.factors.gameEnvironment.pointsContribution, 0);
  // And the uncapped derivation is disclosed, so what the cap suppressed is
  // visible rather than having to be recomputed by a reviewer.
  assert.ok(withMarket.factors.gameEnvironment.rawEffect > 0.16);
});

test('an expert quote does not move a single output number at shipped constants', () => {
  const without = project();
  const withExpert = project({ expert: { points: 21.7, source: 'test-consensus' } });

  for (const key of ['mean', 'median', 'p10', 'p25', 'p75', 'p90']) {
    assert.equal(withExpert[key], without[key], `${key} moved`);
  }
  assert.equal(withExpert.factors.expertConsensus.available, true);
  assert.equal(withExpert.factors.expertConsensus.scored, false);
  assert.equal(withExpert.factors.expertConsensus.blendWeight, 0);
  assert.equal(withExpert.factors.expertConsensus.expertPoints, 21.7);
});

test('both inputs together still move nothing', () => {
  const without = project();
  const withBoth = project({
    gameEnvironment: QUOTED,
    expert: { points: 3.1, source: 'test-consensus' },
  });
  for (const key of ['mean', 'median', 'p10', 'p25', 'p75', 'p90']) {
    assert.equal(withBoth[key], without[key], `${key} moved`);
  }
});

// The negative control for the three tests above: if the caps were NOT what is
// holding the number still, raising them would also change nothing and those
// assertions would be vacuous.
test('raising either cap DOES move the number - the inertness above is load-bearing', () => {
  const base = project();

  const scoredMarket = model.projectPlayer({
    playerId: 42,
    position: 'WR',
    season: 2026,
    week: 8,
    scoringHashValue: 'abc123',
    priorGames: PRIOR_GAMES,
    priorSeasonPerGame: 12.0,
    positionBaselinePerGame: 10.5,
    playerResiduals: [-3.2, 1.4, -0.8, 4.6, 2.1],
    pooledResiduals: [-5, -2, 0, 2, 5],
    gameEnvironment: model.gameEnvironmentEffect({
      impliedPoints: 29.5,
      opponentImplied: 17.5,
      slateAverageImplied: 22.0,
      position: 'WR',
      constants: { ...model.MODEL_CONSTANTS.gameEnvironment, maxEffect: 0.08 },
    }),
    constants: model.MODEL_CONSTANTS,
  });
  assert.notEqual(scoredMarket.median, base.median);
  assert.ok(scoredMarket.median > base.median, 'a shootout should raise a WR');

  const scoredExpert = model.projectPlayer({
    playerId: 42,
    position: 'WR',
    season: 2026,
    week: 8,
    scoringHashValue: 'abc123',
    priorGames: PRIOR_GAMES,
    priorSeasonPerGame: 12.0,
    positionBaselinePerGame: 10.5,
    playerResiduals: [-3.2, 1.4, -0.8, 4.6, 2.1],
    pooledResiduals: [-5, -2, 0, 2, 5],
    expert: { points: 3.1, source: 'test-consensus' },
    constants: {
      ...model.MODEL_CONSTANTS,
      expertConsensus: { ...model.MODEL_CONSTANTS.expertConsensus, blendWeight: 0.5 },
    },
  });
  assert.notEqual(scoredExpert.median, base.median);
  assert.ok(scoredExpert.median < base.median, 'a much lower expert number should pull down');
});

// ---------------------------------------------------------------------------
// gameEnvironmentEffect
// ---------------------------------------------------------------------------

const OPEN = { ...model.MODEL_CONSTANTS.gameEnvironment, maxEffect: 1 };

test('gameEnvironmentEffect is unavailable without a usable quote', () => {
  assert.equal(model.gameEnvironmentEffect({}).available, false);
  assert.equal(
    model.gameEnvironmentEffect({ impliedPoints: 25, slateAverageImplied: null }).reason,
    'no slate baseline'
  );
  assert.equal(
    model.gameEnvironmentEffect({ impliedPoints: null, slateAverageImplied: 22 }).reason,
    'no market quote'
  );
  assert.equal(
    model.gameEnvironmentEffect({ impliedPoints: 2, slateAverageImplied: 22 }).reason,
    'implausible market quote'
  );
});

test('gameEnvironmentEffect scales a team deviation by responsiveness', () => {
  // 10% above the slate average, halved by responsiveness 0.5 -> +5%.
  const up = model.gameEnvironmentEffect({
    impliedPoints: 24.2, slateAverageImplied: 22, position: 'RB', constants: OPEN,
  });
  assert.ok(Math.abs(up.effect - 0.05) < 1e-9);

  const down = model.gameEnvironmentEffect({
    impliedPoints: 19.8, slateAverageImplied: 22, position: 'RB', constants: OPEN,
  });
  assert.ok(Math.abs(down.effect + 0.05) < 1e-9);
});

test('DEF reads the OPPONENT total and inverts it', () => {
  // The same shootout that helps the offence must hurt the defence opposite it.
  const shootout = {
    impliedPoints: 17.5, opponentImplied: 26.4, slateAverageImplied: 22, constants: OPEN,
  };
  const wr = model.gameEnvironmentEffect({ ...shootout, position: 'WR' });
  const def = model.gameEnvironmentEffect({ ...shootout, position: 'DEF' });

  assert.ok(wr.effect < 0, 'a WR on the low-implied side is downgraded');
  assert.ok(def.effect < 0, 'the DEF facing the high-implied side is also downgraded');
  // And a DEF facing a weak offence is upgraded.
  const easy = model.gameEnvironmentEffect({
    impliedPoints: 26.4, opponentImplied: 17.5, slateAverageImplied: 22,
    position: 'DEF', constants: OPEN,
  });
  assert.ok(easy.effect > 0);
});

test('DEF is unavailable when only its own side is quoted', () => {
  const def = model.gameEnvironmentEffect({
    impliedPoints: 26.4, opponentImplied: null, slateAverageImplied: 22, position: 'DEF',
  });
  assert.equal(def.available, false, 'a defence priced off its own offence would be nonsense');
});

test('maxEffect caps a lopsided quote in both directions', () => {
  const capped = { ...model.MODEL_CONSTANTS.gameEnvironment, maxEffect: 0.03 };
  const huge = model.gameEnvironmentEffect({
    impliedPoints: 40, slateAverageImplied: 20, position: 'QB', constants: capped,
  });
  assert.equal(huge.effect, 0.03);
  const tiny = model.gameEnvironmentEffect({
    impliedPoints: 7, slateAverageImplied: 20, position: 'QB', constants: capped,
  });
  assert.equal(tiny.effect, -0.03);
});

// ---------------------------------------------------------------------------
// expertConsensusBlend
// ---------------------------------------------------------------------------

test('expertConsensusBlend reports NOTHING when no provider supplied anything', () => {
  // The shipped default. Must stay exactly what factors.expertConsensus has
  // always been, so this merge is inert in the serialized payload too and not
  // only in the numbers.
  const none = model.expertConsensusBlend({ value: 12.5, expert: null });
  assert.equal(none.value, 12.5);
  assert.equal(none.factor, null);
});

test('expertConsensusBlend distinguishes "nobody asked" from "asked, no coverage"', () => {
  // A provider ran and returned an entry with no usable number - materially
  // different from no provider at all, and the UI has to be able to tell them
  // apart to say "experts do not cover this player" honestly.
  const uncovered = model.expertConsensusBlend({
    value: 12.5, expert: { points: null, source: 'test-consensus' },
  });
  assert.equal(uncovered.value, 12.5);
  assert.equal(uncovered.factor.available, false);
  assert.equal(uncovered.factor.reason, 'no expert coverage');
  assert.equal(uncovered.factor.source, 'test-consensus');
});

test('expertConsensusBlend refuses an out-of-range quote instead of blending it', () => {
  const wild = model.expertConsensusBlend({
    value: 12.5, expert: { points: 900, source: 'broken-feed' },
  });
  assert.equal(wild.value, 12.5, 'a malformed quote must not move the number');
  assert.equal(wild.factor.available, false);
  assert.equal(wild.factor.reason, 'expert quote out of range');
  assert.equal(wild.factor.source, 'broken-feed');
});

test('expertConsensusBlend is a weighted average at a non-zero weight', () => {
  const out = model.expertConsensusBlend({
    value: 10,
    expert: { points: 20, source: 'test' },
    constants: { ...model.MODEL_CONSTANTS.expertConsensus, blendWeight: 0.25 },
  });
  assert.equal(out.value, 12.5);
  assert.equal(out.factor.scored, true);
  assert.equal(out.factor.pointsContribution, 2.5);
});

test('expertConsensusBlend leaves a null projection null', () => {
  const out = model.expertConsensusBlend({
    value: null,
    expert: { points: 20, source: 'test' },
    constants: { ...model.MODEL_CONSTANTS.expertConsensus, blendWeight: 0.5 },
  });
  assert.equal(out.value, null, 'no evidence must stay no evidence, not become the expert number');
  assert.equal(out.factor, null);
});

// ---------------------------------------------------------------------------
// The provider boundary
// ---------------------------------------------------------------------------

test('the shipped odds provider is a no-op and says so', async () => {
  const provider = vegas.getVegasOddsProvider();
  assert.equal(provider.available, false);
  assert.equal((await provider.getWeeklyOdds()).size, 0);
  assert.deepEqual(vegas.vegasCoverage(), { status: 'unavailable', source: null });
});

test('a provider can be installed and removed through the seam', async () => {
  try {
    vegas.setVegasOddsProvider({
      name: 'test-book',
      available: true,
      async getWeeklyOdds() {
        return new Map([['2026_08_BUF_MIA', { total: 47, spread: -3, source: 'test-book' }]]);
      },
    });
    assert.deepEqual(vegas.vegasCoverage(), { status: 'available', source: 'test-book' });
    const odds = await vegas.getVegasOddsProvider().getWeeklyOdds();
    assert.equal(odds.get('2026_08_BUF_MIA').total, 47);
  } finally {
    vegas.setVegasOddsProvider();
  }
  assert.equal(vegas.vegasCoverage().status, 'unavailable');
});

test('slateAverageImplied averages per TEAM, not per game', () => {
  const odds = new Map([
    ['g1', { total: 48, spread: -4 }],   // 26 + 22
    ['g2', { total: 40, spread: 0 }],    // 20 + 20
  ]);
  // (26 + 22 + 20 + 20) / 4 teams = 22
  assert.equal(vegas.slateAverageImplied(odds), 22);
});

test('slateAverageImplied skips half-quotes rather than counting them', () => {
  const odds = new Map([
    ['g1', { total: 48, spread: -4 }],
    ['g2', { total: 40, spread: null }], // total posted, spread pulled
    ['g3', null],
  ]);
  // Only g1 contributes: (26 + 22) / 2 = 24. A half-quote counted through its
  // total alone would drag this toward 22 and mis-price every team on the
  // slate against a baseline the book never actually quoted.
  assert.equal(vegas.slateAverageImplied(odds), 24);
});

test('slateAverageImplied is null when nothing usable is left', () => {
  assert.equal(vegas.slateAverageImplied(new Map()), null);
  assert.equal(vegas.slateAverageImplied(null), null);
  assert.equal(vegas.slateAverageImplied(new Map([['g1', { total: 44 }]])), null);
});

test('impliedTeamPoints splits a total and spread back to the pair that made it', () => {
  const { home, away } = vegas.impliedTeamPoints({ total: 47, spread: -3 });
  assert.equal(home, 25);
  assert.equal(away, 22);
  assert.equal(home + away, 47, 'the two sides must sum to the total');
  // spread is the HOME line, so a -3 home favourite is implied for 3 MORE
  // points than the road team: away - home === spread.
  assert.equal(away - home, -3, 'and differ by the spread, signed home-relative');

  // A pick-em splits evenly.
  assert.deepEqual(vegas.impliedTeamPoints({ total: 44, spread: 0 }), { home: 22, away: 22 });
  // Missing input yields nulls, never a confident half-total.
  assert.deepEqual(vegas.impliedTeamPoints({ total: 44 }), { home: null, away: null });
  assert.deepEqual(vegas.impliedTeamPoints({}), { home: null, away: null });
});
