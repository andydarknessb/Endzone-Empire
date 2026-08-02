const test = require('node:test');
const assert = require('node:assert/strict');

const controlCellEvaluator = require('../../scripts/backtest/lib/controlCellEvaluator');
const arms = require('../../scripts/backtest/lib/arms');
const rosters = require('../../scripts/backtest/lib/rosters');
const metrics = require('../../scripts/backtest/lib/metrics');

// The REAL production wrapper pieces, exactly as backtestPolicy.test.js injects
// them: the whole point of the deployed-policy estimand is that it runs
// production's own availability rule and optimizer.
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');

const SLOTS = rosters.DEFAULT_ROSTER_SLOTS;

/** A minimal MODEL_CONSTANTS shape - just enough for arms.resolveConstants to work on. */
const BASE_CONSTANTS = Object.freeze({
  usage: { blendWeight: 0.4 },
  homeAway: { enabled: true },
  versusOpponent: { crossSeason: false },
});

/** A legal 16-man roster: 1 starting QB + 1 bench, 2 starting RB + 3 bench, etc. */
function makeRoster({ season, week, replicate = 0, teamIndex = 0 }) {
  const starters = [];
  const bench = [];
  let id = 1;
  const add = (position, starterSlots, benchCount) => {
    for (const slot of starterSlots) {
      starters.push({ slot, playerId: id, teamKey: `T${id}`, position, isDefense: position === 'DEF' });
      id++;
    }
    for (let i = 0; i < benchCount; i++) {
      bench.push({ playerId: id, teamKey: `T${id}`, position, isDefense: position === 'DEF' });
      id++;
    }
  };
  add('QB', ['QB'], 1);
  add('RB', ['RB', 'RB'], 3);
  add('WR', ['WR', 'WR'], 3);
  add('TE', ['TE'], 1);
  add('K', ['K'], 0);
  add('DEF', ['DEF'], 0);
  const players = [...starters, ...bench].map((p) => ({ ...p }));
  return {
    season, week, replicate, teamIndex, draftSlot: teamIndex, players, starters, bench,
  };
}

function makeRosterWeek({ season, week }) {
  const roster = makeRoster({ season, week });
  return { season, week, poolSize: 16, rosters: [roster] };
}

function makeCohortWeek({ season, week, rosterWeek, actualFor = (id) => id }) {
  const roster = rosterWeek.rosters[0];
  const members = [...roster.starters, ...roster.bench].map((p) => ({
    season,
    week,
    gsisId: p.isDefense ? null : `gsis-${p.playerId}`,
    playerId: p.playerId,
    position: p.position,
    team: p.teamKey,
    teamKey: p.teamKey,
    injuryStatus: null,
    onBye: false,
    isDefense: p.isDefense,
    contradiction: null,
  }));
  const actualPointsByPlayerId = new Map(members.map((m) => [m.playerId, actualFor(m.playerId)]));
  return {
    season, week, members, actualPointsByPlayerId,
  };
}

function makeRanks(rosterWeek) {
  const roster = rosterWeek.rosters[0];
  const positionRank = new Map([['QB', 1], ['RB', 2], ['WR', 3], ['TE', 4], ['K', 5], ['DEF', 6]]);
  const nameRankById = new Map(roster.players.map((p) => [p.playerId, p.playerId]));
  return { positionRank, nameRankById };
}

// ---------------------------------------------------------------------------
// resolveControlConstants: the bit-identity guard
// ---------------------------------------------------------------------------

test('resolveControlConstants resolves the shipped control cell, two ways, and they agree', () => {
  const resolved = controlCellEvaluator.resolveControlConstants({ baseConstants: BASE_CONSTANTS });
  assert.equal(resolved.usage.blendWeight, arms.CONTROL_BLEND_WEIGHT);
  assert.equal(resolved.homeAway.enabled, false, 'the control cell always resolves homeAway off');
});

test('resolveControlConstants requires baseConstants to be injected', () => {
  assert.throws(() => controlCellEvaluator.resolveControlConstants({}), /MODEL_CONSTANTS must be injected/);
});

test('MUTATION TEST: a divergent control-constants derivation is caught, not silently accepted', () => {
  // This is the guard the plan requires: "a mutant that lets the evaluator
  // accept a non-control cell must fail a test." Simulated here by monkey-
  // patching arms.buildFamily so its control entry silently disagrees with the
  // direct derivation - exactly the class of drift `resolveControlConstants`
  // exists to catch on every call rather than trust from a one-time review.
  const original = arms.buildFamily;
  arms.buildFamily = ({ baseConstants, label }) => {
    const family = original({ baseConstants, label });
    return {
      ...family,
      control: {
        ...family.control,
        resolvedConstants: {
          ...family.control.resolvedConstants,
          usage: { ...family.control.resolvedConstants.usage, blendWeight: 0.6 },
        },
      },
    };
  };
  try {
    assert.throws(
      () => controlCellEvaluator.resolveControlConstants({ baseConstants: BASE_CONSTANTS }),
      /not bit-identical to the control/
    );
  } finally {
    arms.buildFamily = original;
  }
});

test('STRUCTURAL: evaluateControlCell takes no "cell" parameter at all', () => {
  // The blinding here is structural, mirroring lib/mde.js's own require-graph
  // proof: there is no parameter through which a caller could hand in a
  // candidate cell, even by mistake.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'controlCellEvaluator.js'), 'utf8'
  );
  const fnStart = src.indexOf('async function evaluateControlCell({');
  assert.ok(fnStart >= 0, 'evaluateControlCell must be defined');
  const fnParams = src.slice(fnStart, src.indexOf('}) {', fnStart));
  assert.ok(!/\bcell\s*[,:]/.test(fnParams), 'evaluateControlCell must not accept a "cell" parameter');
  assert.match(src, /assertControlBitIdentity/, 'it must call the bit-identity guard');
});

// ---------------------------------------------------------------------------
// evaluateControlWeek
// ---------------------------------------------------------------------------

test('evaluateControlWeek computes non-negative regret and a pairwise score using the real production wrapper', () => {
  const season = 2025;
  const week = 5;
  const rosterWeek = makeRosterWeek({ season, week });
  const cohortWeek = makeCohortWeek({ season, week, rosterWeek, actualFor: (id) => 20 - (id % 7) });
  const { positionRank, nameRankById } = makeRanks(rosterWeek);
  // A projection that is a poor guess (constant 5 for everyone) so the arm's
  // start choices differ from what perfect information would choose, and
  // regret is provably nonzero for at least some slot.
  const projectionsByPlayerId = new Map(rosterWeek.rosters[0].players.map((p) => [p.playerId, { median: 5 }]));

  const result = controlCellEvaluator.evaluateControlWeek({
    season,
    week,
    rosterWeek,
    cohortWeek,
    projectionsByPlayerId,
    positionRank,
    nameRankById,
    rosterSlots: SLOTS,
    availabilityFor,
    optimize: optimalAssignment,
  });

  assert.equal(result.season, season);
  assert.equal(result.week, week);
  assert.ok(result.regret >= 0, 'regret is non-negative by construction');
  assert.equal(result.rosterCount, 1);
  assert.equal(result.cohortSize, 16);
  assert.equal(result.perRosterDetail.length, 1);
  // pairwise is either a finite fraction or null (if too few eligible pairs) -
  // never NaN or undefined.
  assert.ok(result.pairwise === null || (result.pairwise >= 0 && result.pairwise <= 1));
});

test('evaluateControlWeek fails closed on mismatched season/week between roster and cohort artifacts', () => {
  const rosterWeek = makeRosterWeek({ season: 2025, week: 5 });
  const cohortWeek = makeCohortWeek({ season: 2025, week: 6, rosterWeek });
  const { positionRank, nameRankById } = makeRanks(rosterWeek);
  assert.throws(() => controlCellEvaluator.evaluateControlWeek({
    season: 2025,
    week: 5,
    rosterWeek,
    cohortWeek,
    projectionsByPlayerId: new Map(),
    positionRank,
    nameRankById,
    availabilityFor,
    optimize: optimalAssignment,
  }), /cohortWeek is for 2025w6, not this week/);
});

test('evaluateControlWeek refuses the 2026 quarantine boundary', () => {
  const rosterWeek = makeRosterWeek({ season: 2026, week: 5 });
  const cohortWeek = makeCohortWeek({ season: 2026, week: 5, rosterWeek });
  const { positionRank, nameRankById } = makeRanks(rosterWeek);
  assert.throws(() => controlCellEvaluator.evaluateControlWeek({
    season: 2026,
    week: 5,
    rosterWeek,
    cohortWeek,
    projectionsByPlayerId: new Map(),
    positionRank,
    nameRankById,
    availabilityFor,
    optimize: optimalAssignment,
  }), /prospective holdout/);
});

test('evaluateControlWeek requires availabilityFor and optimize to be injected', () => {
  const rosterWeek = makeRosterWeek({ season: 2025, week: 5 });
  const cohortWeek = makeCohortWeek({ season: 2025, week: 5, rosterWeek });
  const { positionRank, nameRankById } = makeRanks(rosterWeek);
  assert.throws(() => controlCellEvaluator.evaluateControlWeek({
    season: 2025, week: 5, rosterWeek, cohortWeek, projectionsByPlayerId: new Map(), positionRank, nameRankById,
    optimize: optimalAssignment,
  }), /availabilityFor must be injected/);
  assert.throws(() => controlCellEvaluator.evaluateControlWeek({
    season: 2025, week: 5, rosterWeek, cohortWeek, projectionsByPlayerId: new Map(), positionRank, nameRankById,
    availabilityFor,
  }), /optimize must be injected/);
});

test('a bye player is excluded from the pairwise rows, per preregistration 4.1', () => {
  const season = 2025;
  const week = 5;
  const rosterWeek = makeRosterWeek({ season, week });
  const cohortWeek = makeCohortWeek({ season, week, rosterWeek });
  cohortWeek.members[0].onBye = true;
  const projectionsByPlayerId = new Map(rosterWeek.rosters[0].players.map((p) => [p.playerId, { median: 5 }]));
  const rows = controlCellEvaluator.pairwiseRowsByPosition({
    cohortMembers: cohortWeek.members,
    actualPointsByPlayerId: cohortWeek.actualPointsByPlayerId,
    projectionsByPlayerId,
    label: 'test',
  });
  const byePosition = cohortWeek.members[0].position;
  assert.ok(!rows[byePosition].some((r) => r.playerId === cohortWeek.members[0].playerId));
});

// ---------------------------------------------------------------------------
// evaluateControlCell: end to end across the 17 primary weeks
// ---------------------------------------------------------------------------

test('evaluateControlCell runs all 17 primary 2025 weeks and returns series mde.runMde can consume', async () => {
  const weekArtifacts = new Map();
  for (const week of controlCellEvaluator.PRIMARY_WEEKS) {
    const season = controlCellEvaluator.PRIMARY_SEASON;
    const rosterWeek = makeRosterWeek({ season, week });
    const cohortWeek = makeCohortWeek({ season, week, rosterWeek, actualFor: (id) => 10 + ((id + week) % 5) });
    const { positionRank, nameRankById } = makeRanks(rosterWeek);
    weekArtifacts.set(`${season}:${week}`, {
      rosterWeek, cohortWeek, positionRank, nameRankById,
    });
  }

  const seenCalls = [];
  const projectPoints = async ({ season, week, playerIds, modelConstants }) => {
    seenCalls.push({ season, week, modelConstants });
    return new Map(playerIds.map((id) => [id, { median: 5 + (id % 3) }]));
  };

  const result = await controlCellEvaluator.evaluateControlCell({
    weekArtifacts,
    baseConstants: BASE_CONSTANTS,
    projectPoints,
    availabilityFor,
    optimize: optimalAssignment,
  });

  assert.equal(result.cell, arms.CONTROL_CELL);
  assert.equal(result.season, 2025);
  assert.deepEqual(result.weeks, [...metrics.EVALUATED_WEEKS]);
  assert.equal(result.controlRegretWeeks.length, 17);
  assert.equal(result.controlPairwiseWeeks.length, 17);
  assert.equal(result.perWeekDetail.length, 17);
  for (const regret of result.controlRegretWeeks) assert.ok(regret >= 0);

  // Every projection call used the CONTROL cell's resolved constants - never a
  // caller-suppliable candidate.
  assert.equal(seenCalls.length, 17);
  for (const call of seenCalls) {
    assert.equal(call.modelConstants.usage.blendWeight, arms.CONTROL_BLEND_WEIGHT);
    assert.equal(call.modelConstants.homeAway.enabled, false);
    assert.equal(call.season, 2025);
  }
});

test('evaluateControlCell requires all 17 primary weeks - a missing week is refused, not silently dropped', async () => {
  const weekArtifacts = new Map();
  const season = controlCellEvaluator.PRIMARY_SEASON;
  // Only supply week 2, deliberately omitting the rest.
  const rosterWeek = makeRosterWeek({ season, week: 2 });
  const cohortWeek = makeCohortWeek({ season, week: 2, rosterWeek });
  const { positionRank, nameRankById } = makeRanks(rosterWeek);
  weekArtifacts.set(`${season}:2`, {
    rosterWeek, cohortWeek, positionRank, nameRankById,
  });

  await assert.rejects(
    controlCellEvaluator.evaluateControlCell({
      weekArtifacts,
      baseConstants: BASE_CONSTANTS,
      projectPoints: async ({ playerIds }) => new Map(playerIds.map((id) => [id, { median: 5 }])),
      availabilityFor,
      optimize: optimalAssignment,
    }),
    /no roster\/cohort artifacts supplied for 2025:3/
  );
});

test('evaluateControlCell requires projectPoints to be injected', async () => {
  await assert.rejects(
    controlCellEvaluator.evaluateControlCell({
      weekArtifacts: new Map(), baseConstants: BASE_CONSTANTS, availabilityFor, optimize: optimalAssignment,
    }),
    /projectPoints must be injected/
  );
});

// ---------------------------------------------------------------------------
// Isolation: no server/services, no pg, no process.env
// ---------------------------------------------------------------------------

test('controlCellEvaluator.js stays inside the pure lib tree', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'controlCellEvaluator.js'), 'utf8'
  );
  // Strip comments first (same idiom as backtestMde.test.js's own require-graph
  // scan): the docblock ABOVE explains the isolation rule in prose, which
  // necessarily names "server/services" and "process.env" as the things it is
  // NOT allowed to touch, so checking the raw text would false-positive on the
  // very sentence documenting the guarantee.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/require\(['"]pg['"]\)/.test(src));
  assert.ok(!/server\/services/.test(src));
  assert.ok(!/server\/modules\/pool/.test(src));
  assert.ok(!/process\.env/.test(src));
});
