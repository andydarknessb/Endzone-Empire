'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const successorEval = require('../../scripts/holdout/lib/successorEval');
const model = require('../services/projectionModel');

// ---------------------------------------------------------------------------
// overridesForRow / buildOverrideMaps (ruling point 2 - the three substitutions)
// ---------------------------------------------------------------------------

test('overridesForRow freezes position/nfl_team/injury_status and replays the captured expert factor', () => {
  const noProvider = successorEval.overridesForRow({
    playerId: 1, position: 'WR', nflTeam: 'KC', injuryStatus: null, factors: {},
  });
  assert.deepEqual(noProvider.playerContext, { position: 'WR', nfl_team: 'KC', injury_status: null });
  assert.equal(noProvider.expert, null, 'no captured factor at all replays as no expert input');

  const unscored = successorEval.overridesForRow({
    playerId: 2, position: 'RB', nflTeam: 'SF', injuryStatus: 'Q',
    factors: { expertConsensus: { available: false, reason: 'no expert coverage', source: 'feedX' } },
  });
  assert.deepEqual(unscored.expert, { source: 'feedX' }, 'an unscored capture replays with no points value');

  const scored = successorEval.overridesForRow({
    playerId: 3, position: 'TE', nflTeam: 'BAL', injuryStatus: null,
    factors: {
      expertConsensus: {
        available: true, scored: true, expertPoints: 12.3, blendWeight: 0.2, source: 'feedX',
      },
    },
  });
  assert.deepEqual(scored.expert, { points: 12.3, source: 'feedX' });
});

test('buildOverrideMaps builds one entry per row, keyed by playerId', () => {
  const rows = [
    { playerId: 10, position: 'QB', nflTeam: 'DAL', injuryStatus: null, factors: {} },
    {
      playerId: 11, position: 'WR', nflTeam: 'DAL', injuryStatus: 'O',
      factors: { expertConsensus: { available: true, expertPoints: 5, source: 'feedX' } },
    },
  ];
  const { playerContextOverrideById, expertOverrideByPlayerId } = successorEval.buildOverrideMaps(rows);
  assert.equal(playerContextOverrideById.size, 2);
  assert.equal(expertOverrideByPlayerId.size, 2);
  assert.deepEqual(playerContextOverrideById.get(11), { position: 'WR', nfl_team: 'DAL', injury_status: 'O' });
  assert.deepEqual(expertOverrideByPlayerId.get(11), { points: 5, source: 'feedX' });
  assert.equal(expertOverrideByPlayerId.get(10), null);
});

// ---------------------------------------------------------------------------
// constantsFor / reprojectWeek (ruling point 1)
// ---------------------------------------------------------------------------

test('constantsFor refuses an unregistered MODEL_VERSION rather than falling back to HEAD', () => {
  assert.throws(() => successorEval.constantsFor('free_baseline_v9.9'), /no constants registered/);
  assert.equal(successorEval.constantsFor(model.MODEL_VERSION), model.MODEL_CONSTANTS);
});

test('CONSTANTS_BY_MODEL_VERSION registers both free_baseline_v3.1 and free_baseline_v3.2, from the model\'s own registry (#1442 ruling (4))', () => {
  assert.equal(
    successorEval.CONSTANTS_BY_MODEL_VERSION['free_baseline_v3.1'],
    model.MODEL_CONSTANTS,
    'v3.1 is the shipped default, unchanged'
  );
  assert.equal(
    successorEval.CONSTANTS_BY_MODEL_VERSION['free_baseline_v3.2'],
    model.MODEL_CONSTANTS_V3_2,
    'v3.2 is now registered too, since MODEL_CONSTANTS_BY_VERSION carries it'
  );
  assert.equal(successorEval.constantsFor('free_baseline_v3.2'), model.MODEL_CONSTANTS_V3_2);
});

test('reprojectWeek forwards capture_not_after as the odds bound and the version\'s own constants', async () => {
  let seenArgs = null;
  const header = { season: 2026, week: 3, scoringHash: 'hash-x', captureNotAfter: '2026-09-21T17:00:00.000Z' };
  const rows = [
    { playerId: 1, position: 'WR', nflTeam: 'KC', injuryStatus: null, sampleSize: 4, factors: {} },
  ];
  const fakeGenerateProjections = async (callArgs) => {
    seenArgs = callArgs;
    return { projections: new Map([[1, { playerId: 1, position: 'WR', mean: 9 }]]) };
  };

  const out = await successorEval.reprojectWeek({
    header, rows, rules: {}, modelVersion: model.MODEL_VERSION, generateProjections: fakeGenerateProjections,
  });

  assert.equal(seenArgs.season, 2026);
  assert.equal(seenArgs.week, 3);
  assert.equal(seenArgs.oddsObservedAtOrBefore, header.captureNotAfter);
  assert.equal(seenArgs.weatherService, false);
  assert.equal(seenArgs.modelConstants, model.MODEL_CONSTANTS);
  assert.equal(seenArgs.modelVersion, model.MODEL_VERSION, 'reprojectWeek forwards modelVersion, not just its constants');
  assert.ok(seenArgs.playerContextOverrideById instanceof Map);
  assert.ok(seenArgs.expertOverrideByPlayerId instanceof Map);
  assert.equal(out.length, 1);
  assert.equal(out[0].mean, 9);

  await assert.rejects(
    () => successorEval.reprojectWeek({
      header, rows, rules: {}, modelVersion: 'free_baseline_v9.9', generateProjections: fakeGenerateProjections,
    }),
    /no constants registered/
  );
});

// ---------------------------------------------------------------------------
// calibrateAgainstCaptured (ruling point 3)
// ---------------------------------------------------------------------------

test('calibrateAgainstCaptured flags a mean drift past 0.01 and a differing sample_size', () => {
  const capturedRows = [
    { playerId: 1, mean: 10, sampleSize: 5 },
    { playerId: 2, mean: 8, sampleSize: 3 },
  ];
  const exact = successorEval.calibrateAgainstCaptured({
    capturedRows, rebuiltRows: [{ playerId: 1, mean: 10, sampleSize: 5 }, { playerId: 2, mean: 8, sampleSize: 3 }],
  });
  assert.deepEqual(exact, { checked: 2, withinTolerance: 2, share: 1, sampleSizeDiffers: 0 });

  const drifted = successorEval.calibrateAgainstCaptured({
    capturedRows,
    rebuiltRows: [{ playerId: 1, mean: 10.5, sampleSize: 5 }, { playerId: 2, mean: 8, sampleSize: 4 }],
  });
  assert.equal(drifted.withinTolerance, 1);
  assert.equal(drifted.share, 0.5);
  assert.equal(drifted.sampleSizeDiffers, 1);
});

// ---------------------------------------------------------------------------
// The whole gate, end to end, on a synthetic two-profile, two-week ledger
// ---------------------------------------------------------------------------

const SEASON = 2026;
const PROFILE_NAMES = ['half_ppr', 'standard'];
const WEEK_NUMBERS = [1, 2];

function capturedRow(playerId, week) {
  const mean = 10 + playerId + week;
  return {
    playerId,
    position: playerId % 2 === 0 ? 'RB' : 'WR',
    nflTeam: 'KC',
    injuryStatus: null,
    mean,
    median: mean,
    p10: mean - 2,
    p25: mean - 1,
    p75: mean + 1,
    p90: mean + 2,
    activeProbability: 1,
    sampleSize: 5,
    factors: { expertConsensus: null },
  };
}

/** Two profiles, two weeks, four players each - the red-tell's synthetic ledger. */
function syntheticProfiles() {
  const captured = new Map(); // 'profile:season:week:playerId' -> row, read by the mock below
  const profiles = PROFILE_NAMES.map((name) => {
    const weeks = WEEK_NUMBERS.map((week) => {
      const rows = [1, 2, 3, 4].map((playerId) => capturedRow(playerId, week));
      for (const row of rows) captured.set(`${name}:${SEASON}:${week}:${row.playerId}`, row);
      return {
        header: {
          season: SEASON, week, scoringHash: `hash-${name}`, captureNotAfter: '2026-09-08T00:00:00.000Z',
        },
        rows,
      };
    });
    const actuals = new Map();
    for (const week of weeks) {
      for (const row of week.rows) actuals.set(`${SEASON}:${week.header.week}:${row.playerId}`, row.mean);
    }
    return { name, rules: { profile: name }, weeks, actuals };
  });
  return { profiles, captured };
}

/**
 * Reproduces the captured row exactly for every requested player, keyed off
 * the fixture's own lookup table rather than the overrides passed in - so
 * the mock's OUTPUT is the red-tell's "reproduces the captured rows"
 * guarantee, while a handful of assertions on the overrides it received
 * cover that `reprojectWeek` actually wires the ruling's three
 * substitutions through to `generateProjections`.
 */
function makeMockGenerateProjections(captured, profileName) {
  return async ({
    season, week, playerIds, playerContextOverrideById, expertOverrideByPlayerId, modelConstants,
  }) => {
    // HEAD is v3.1 (#1442 ruling (4)): the rebuilt-v3.1 column and (when the
    // target IS v3.1, as this test's modelVersion is) the target column too
    // both run with model.MODEL_CONSTANTS - the same object, since it is the
    // one and only registered v3.1 entry.
    assert.equal(
      modelConstants, model.MODEL_CONSTANTS,
      'a v3.1 reprojection gets the shipped MODEL_CONSTANTS, never a stand-in'
    );
    const projections = new Map();
    for (const playerId of playerIds) {
      const row = captured.get(`${profileName}:${season}:${week}:${playerId}`);
      assert.ok(row, `fixture has a captured row for ${profileName} ${season} week ${week} player ${playerId}`);
      const ctx = playerContextOverrideById.get(playerId);
      assert.equal(ctx.position, row.position);
      assert.equal(ctx.nfl_team, row.nflTeam);
      assert.equal(expertOverrideByPlayerId.get(playerId), null, 'this fixture captured no expert factor');
      projections.set(playerId, {
        playerId,
        position: row.position,
        mean: row.mean,
        median: row.median,
        p10: row.p10,
        p25: row.p25,
        p75: row.p75,
        p90: row.p90,
        activeProbability: row.activeProbability,
        sampleSize: row.sampleSize,
        factors: {},
      });
    }
    return { projections, inputCutoff: null, sourceCoverage: {} };
  };
}

test('the synthetic ledger reproduces exactly under a mocked v3.1 re-projection: calibration share 1.0, three columns per profile', async () => {
  const { profiles, captured } = syntheticProfiles();

  // Each profile's mock reproduces ITS OWN captured rows - generateProjections
  // has no notion of "profile", so the harness has to route by profile name;
  // a single generateProjections stand-in wraps the per-profile mocks by the
  // rules object identity `evaluateProfile` forwards unchanged.
  const mocksByProfile = new Map(PROFILE_NAMES.map((name) => [name, makeMockGenerateProjections(captured, name)]));
  const routedGenerateProjections = async (args) => {
    const profileName = args.rules && args.rules.profile;
    return mocksByProfile.get(profileName)(args);
  };

  const result = await successorEval.evaluate({
    profiles,
    survivors: { weeks: WEEK_NUMBERS, dropped: [] },
    modelVersion: successorEval.MODEL_VERSION_V3_1,
    generateProjections: routedGenerateProjections,
    // Pinned to the literal v3.1 name so the test survives the version bump.
    constantsByModelVersion: { [successorEval.MODEL_VERSION_V3_1]: model.MODEL_CONSTANTS },
  });
  assert.equal(result.mode, 'calibration');
  assert.equal(result.verdict, null, 'a v3.1 run is the calibration run and decides nothing');

  assert.deepEqual(Object.keys(result.profiles).sort(), [...PROFILE_NAMES].sort());
  for (const name of PROFILE_NAMES) {
    const profile = result.profiles[name];
    assert.equal(profile.weeksScored, 2);
    assert.equal(profile.calibration.checked, 8, '4 players x 2 weeks');
    assert.equal(profile.calibration.share, 1, `${name}: calibration share is 1.0 when the mock reproduces captured rows exactly`);
    assert.equal(profile.calibration.sampleSizeDiffers, 0);

    // Three columns, and captured v3.1 must equal rebuilt v3.1 exactly since
    // the mock reproduces the captured row byte for byte.
    assert.ok(profile.columns.capturedV31);
    assert.ok(profile.columns.rebuiltV31);
    assert.equal(profile.columns.rebuiltTarget, undefined, 'a calibration run computes no v3.2 column');
    assert.equal(profile.gate, undefined, 'a calibration run evaluates no check');
    assert.equal(profile.columns.capturedV31.mae, profile.columns.rebuiltV31.mae);
    assert.equal(profile.columns.capturedV31.mae, 0, 'actuals were pinned to the captured mean, so MAE is exactly 0');
    assert.equal(profile.columns.capturedV31.cov80, 1, 'the captured interval always contains its own mean');
  }

  const rendered = successorEval.renderReport(result);
  for (const name of PROFILE_NAMES) assert.match(rendered, new RegExp(`## ${name}`));
  assert.match(rendered, /captured v3\.1/);
  assert.match(rendered, /rebuilt v3\.1/);
  assert.match(rendered, /v3\.1 rebuild calibration: 1\.0000 of 8 rows/);
});

test('evaluate refuses an unregistered MODEL_VERSION before calling generateProjections at all', async () => {
  const { profiles } = syntheticProfiles();
  let called = false;
  await assert.rejects(
    () => successorEval.evaluate({
      profiles,
      survivors: { weeks: WEEK_NUMBERS, dropped: [] },
      modelVersion: 'free_baseline_v9.9',
      generateProjections: async () => { called = true; },
    }),
    /no constants registered/
  );
  assert.equal(called, false);
});

// ---------------------------------------------------------------------------
// formal-001-f1: v3.1 is pinned by the LITERAL model version name, never by
// model.MODEL_VERSION - so a successor bump cannot silently relabel its own
// rebuild as "rebuilt v3.1" with no error bar (the lead's finding: stubbing
// MODEL_VERSION to a v3.2 name at review time left the registry holding only
// v3.2, and the report still printed "rebuilt v3.1" / "calibration: 1.0000"
// for what was actually the v3.2 rebuild run twice).
// ---------------------------------------------------------------------------

test('the v3.1 rebuild and calibration are pinned to MODEL_VERSION_V3_1, never to whatever model.MODEL_VERSION happens to be', async () => {
  const V3_1 = successorEval.MODEL_VERSION_V3_1;
  assert.equal(V3_1, 'free_baseline_v3.1');

  const FAKE_V3_2 = 'free_baseline_v9.9';
  const v31Constants = { marker: 'v3.1-constants' };
  const v32Constants = { marker: 'v3.2-constants' };
  const { profiles } = syntheticProfiles();
  // One profile, one week - only the constants wiring is under test here.
  const oneProfile = [{ ...profiles[0], weeks: [profiles[0].weeks[0]] }];

  const seenConstants = [];
  const stubGenerateProjections = async ({ modelConstants, playerIds }) => {
    seenConstants.push(modelConstants);
    const projections = new Map(
      playerIds.map((id) => [id, { playerId: id, position: 'WR', mean: 1, sampleSize: 1 }])
    );
    return { projections, inputCutoff: null, sourceCoverage: {} };
  };

  // Only the fake v3.2 registered (simulating a successor bump that has not
  // also preserved v3.1's constants): the run must refuse and name v3.1 -
  // never fall back to v3.2's constants for the "rebuilt v3.1" column.
  await assert.rejects(
    () => successorEval.evaluate({
      profiles: oneProfile,
      survivors: { weeks: [1], dropped: [] },
      modelVersion: FAKE_V3_2,
      generateProjections: stubGenerateProjections,
      constantsByModelVersion: { [FAKE_V3_2]: v32Constants },
    }),
    new RegExp(V3_1.replace(/\./g, '\\.'))
  );
  assert.equal(seenConstants.length, 0, 'nothing was reprojected before the refusal');

  // Both registered: the rebuilt-v3.1 column and the v3.2 target column must
  // each be run with their OWN distinct constants object, not the same one.
  const result = await successorEval.evaluate({
    profiles: oneProfile,
    survivors: { weeks: [1], dropped: [] },
    modelVersion: FAKE_V3_2,
    generateProjections: stubGenerateProjections,
    constantsByModelVersion: { [V3_1]: v31Constants, [FAKE_V3_2]: v32Constants },
  });
  assert.equal(seenConstants.length, 2, 'one reprojection for rebuilt v3.1, one for the v3.2 target');
  assert.ok(seenConstants.includes(v31Constants), 'the v3.1 column ran with v3.1\'s own constants');
  assert.ok(seenConstants.includes(v32Constants), 'the target column ran with the target\'s own constants');
  assert.notEqual(seenConstants[0], seenConstants[1], 'the two columns must not share one constants object');
  assert.equal(result.profiles[oneProfile[0].name].columns.rebuiltTarget.modelVersion, FAKE_V3_2);
  assert.equal(result.mode, 'deciding');
});

// ---------------------------------------------------------------------------
// formal-001-f2: pg returns projection_snapshot_players' NUMERIC/decimal
// columns (mean, median, p10-p90, active_probability) as STRINGS - no
// NUMERIC type parser is registered (the same reason evaluate.js and
// coverage.js coerce with Number() at their own read paths). A captured row
// shaped that way must score identically to the same row as native numbers.
// ---------------------------------------------------------------------------

function stringDecimalRow(playerId, week) {
  const row = capturedRow(playerId, week);
  return {
    ...row,
    mean: String(row.mean),
    median: String(row.median),
    p10: String(row.p10),
    p25: String(row.p25),
    p75: String(row.p75),
    p90: String(row.p90),
    activeProbability: String(row.activeProbability),
  };
}

test('metricsForArm and calibrateAgainstCaptured treat pg-style numeric-string ledger rows the same as numbers', () => {
  const numeric = [1, 2, 3, 4].map((id) => capturedRow(id, 1));
  const strings = [1, 2, 3, 4].map((id) => stringDecimalRow(id, 1));
  const actuals = new Map(numeric.map((row) => [`${SEASON}:1:${row.playerId}`, row.mean]));

  const fromNumbers = successorEval.metricsForArm({
    rows: numeric, actuals, season: SEASON, week: 1,
  });
  const fromStrings = successorEval.metricsForArm({
    rows: strings, actuals, season: SEASON, week: 1,
  });
  assert.deepEqual(
    fromStrings, fromNumbers,
    'a string-decimal ledger row must score identically to the same row as numbers'
  );
  assert.equal(fromStrings.n, 4);
  assert.ok(fromStrings.mae !== null && fromStrings.spearman !== null);

  const calibration = successorEval.calibrateAgainstCaptured({ capturedRows: strings, rebuiltRows: numeric });
  assert.equal(calibration.checked, 4);
  assert.equal(calibration.share, 1, 'string-decimal captured means must still compare equal to the rebuilt numbers');
  assert.equal(calibration.sampleSizeDiffers, 0);
});

// ---------------------------------------------------------------------------
// The ruled decision rule (DECISION_RULE.md, #1938)
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function armWeek(week, { late = false, constantsHash = 'h', missing = [] } = {}) {
  const ids = [1, 2];
  const arm = () => ({
    isLate: late,
    capturedAt: '2026-09-01T00:00:00.000Z',
    captureNotAfter: '2026-09-02T00:00:00.000Z',
    constantsHash,
    modelVersion: 'free_baseline_v3.1',
    cohortHash: sha(ids.join(',')),
    cohortSize: ids.length,
    rows: ids.map((playerId) => ({ playerId })),
  });
  const arms = { scheduled: { ...arm(), constantsHash: 'h', isLate: false } };
  for (const kind of ['candidate:bw-20', 'candidate:bw-15']) {
    if (!missing.includes(kind)) arms[kind] = arm();
  }
  return { week, arms };
}

function armWeeks(overrides = {}) {
  return Array.from({ length: 17 }, (_, i) => armWeek(i + 1, overrides[i + 1]));
}

test('selectSurvivors drops a late week, a week off the season-majority constants hash and a week missing a candidate arm', () => {
  const survivors = successorEval.selectSurvivors(armWeeks({
    3: { late: true },
    5: { constantsHash: 'other' },
    7: { missing: ['candidate:bw-15'] },
  }));
  assert.deepEqual(survivors.weeks, [1, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(survivors.dropped.map((d) => d.week).sort((a, b) => a - b), [3, 5, 7]);
});

// ---- section 4: served state, projection, the three exclusion classes ----

const BASELINE_FACTORS = { dataQuality: { reasons: ['position baseline'] } };
const row = (over) => ({ mean: 10, activeProbability: 1, factors: {}, ...over });
const entry = (playerId, captured, v31, target) => ({
  playerId, position: 'WR', rows: { capturedV31: captured, rebuiltV31: v31, rebuiltTarget: target },
});
const COLS = ['capturedV31', 'rebuiltV31', 'rebuiltTarget'];

test('a captured Unavailable row is scored in no column, whether its active probability is 0 or arrives as the strings 0 and 0.0000', () => {
  const entries = [0, '0', '0.0000'].map((ap, i) => entry(i + 1, row({ activeProbability: ap }), row(), row()));
  const { scored, counts } = successorEval.classifyWeek(entries, COLS);
  assert.equal(scored.length, 0);
  assert.deepEqual(counts, { unavailable: 3, servedStateDiffers: 0, servedByNoColumn: 0 });
});

test('a row served in the capture and unserved in the v3.1 rebuild is scored in no column', () => {
  const { scored, counts } = successorEval.classifyWeek([entry(1, row(), row({ mean: null }), row())], COLS);
  assert.equal(scored.length, 0);
  assert.equal(counts.servedStateDiffers, 1);
});

test('a row no column serves is scored in no column', () => {
  const none = row({ mean: null });
  const { scored, counts } = successorEval.classifyWeek([entry(1, none, none, none)], COLS);
  assert.equal(scored.length, 0);
  assert.equal(counts.servedByNoColumn, 1);
});

test('a Position-baseline row in v3.1 that v3.2 serves is scored in every column: 0 in v3.1, its projection in v3.2', () => {
  const baseline = row({ factors: BASELINE_FACTORS });
  const e = entry(1, baseline, baseline, row({ mean: 10 }));
  const { scored } = successorEval.classifyWeek([e], COLS);
  assert.equal(scored.length, 1);
  assert.deepEqual(COLS.map((c) => successorEval.projectionOf(e.rows[c])), [0, 0, 10]);
});

test('projection is mean times active probability, the mean where it is null, and 0 where unserved', () => {
  assert.equal(successorEval.projectionOf(row({ activeProbability: '0.5' })), 5, 'a fractional probability arriving as a string');
  assert.equal(successorEval.projectionOf(row({ activeProbability: 0.25 })), 2.5);
  assert.equal(successorEval.projectionOf(row({ activeProbability: null })), 10);
  assert.equal(successorEval.projectionOf(row({ activeProbability: '0.0000' })), 0);
  assert.equal(successorEval.projectionOf(row({ mean: null })), 0);
});

// ---- section 3: the per-metric week drop ----

test('a week null for a metric in one column drops from that metric in every column', () => {
  const col = (pairwise) => ({
    mae: 1, spearman: 0.1, pairwise, cov80: 0.8, cov50: 0.5,
  });
  const weekly = [
    { week: 1, byCol: { a: col(0.5), b: col(0.6) } },
    { week: 2, byCol: { a: col(0.9), b: col(null) } },
    { week: 3, byCol: { a: col(0.7), b: col(0.8) } },
  ];
  const { season, weeksUsed } = successorEval.seasonize(weekly, ['a', 'b']);
  assert.deepEqual(weeksUsed.pairwise, [1, 3]);
  assert.equal(season.a.pairwise, 0.6, 'column a is averaged over weeks 1 and 3 only');
  assert.equal(season.b.pairwise, 0.7);
  assert.deepEqual(weeksUsed.mae, [1, 2, 3], 'the drop is per metric');
});

// ---- sections 5 and 6: the four checks ----

// Fourteen distinct weekly gains, so the bootstrap is not degenerate.
const gain = (i) => 0.02 + 0.0013 * i + 0.0004 * ((i * 5) % 7);

function weeklyFor({
  pairwise = (i) => { const v31 = 0.6 + (i % 2 ? 0.005 : -0.005); return [0.6, v31, v31 + gain(i)]; },
  mae = (i) => { const v31 = 5 + (i % 2 ? 0.05 : -0.05); return [5, v31, v31 - 0.5]; },
  cov80 = [0.8, 0.8, 0.8],
  cov50 = [0.5, 0.5, 0.5],
  n = 14,
} = {}) {
  return Array.from({ length: n }, (_, i) => {
    const [pc, p1, p2] = pairwise(i);
    const [mc, m1, m2] = mae(i);
    const make = (p, m, k) => ({
      pairwise: p, mae: m, spearman: 0.5, cov80: cov80[k], cov50: cov50[k],
    });
    return {
      week: i + 1,
      byCol: { capturedV31: make(pc, mc, 0), rebuiltV31: make(p1, m1, 1), rebuiltTarget: make(p2, m2, 2) },
    };
  });
}

const passesOf = (gate) => gate.checks.map((c) => c.passes);
const PINNED_BOUND = 0.026435714285714285;

test('all four checks pass: PASS, with each check carrying its inputs', () => {
  const gate = successorEval.gateChecks(weeklyFor());
  assert.equal(gate.verdict, 'PASS');
  const [size, noise, mae, cov] = gate.checks;
  assert.ok(size.difference > size.errorBar && size.errorBar > 0);
  assert.equal(noise.alpha, 0.0125);
  assert.ok(noise.bound > 0 && noise.method);
  assert.ok(mae.difference > mae.errorBar);
  assert.equal(cov.cov80.tolerance, 0.02);
  assert.equal(cov.cov80.inBand, true);
});

test('only the pairwise size check fails when the gain is under the rebuild error bar', () => {
  const gate = successorEval.gateChecks(weeklyFor({ pairwise: (i) => [0.6, 0.65, 0.65 + gain(i)] }));
  assert.deepEqual(passesOf(gate), [false, true, true, true]);
  assert.equal(gate.verdict, 'FAIL');
});

test('only the pairwise noise check fails when the gain is real in size but not in its lower bound', () => {
  const gate = successorEval.gateChecks(weeklyFor({ pairwise: (i) => [0.6, 0.6, 0.6 + (i % 2 ? 0.06 : -0.04)] }));
  assert.deepEqual(passesOf(gate), [true, false, true, true]);
  assert.equal(gate.verdict, 'FAIL');
});

test('only the MAE size check fails when the gain is under the MAE error bar', () => {
  const gate = successorEval.gateChecks(weeklyFor({ mae: () => [5, 5.3, 5.2] }));
  assert.deepEqual(passesOf(gate), [true, true, false, true]);
  assert.equal(gate.verdict, 'FAIL');
});

test('only the coverage check fails when v3.2 leaves the band and is further from nominal than v3.1 by more than the tolerance', () => {
  const gate = successorEval.gateChecks(weeklyFor({ cov80: [0.8, 0.8, 0.9] }));
  assert.deepEqual(passesOf(gate), [true, true, true, false]);
  assert.equal(gate.checks[3].cov80.inBand, false);
  // Outside the band but within the 0.02 tolerance: still a pass.
  assert.equal(successorEval.gateChecks(weeklyFor({ cov80: [0.7, 0.7, 0.71] })).checks[3].passes, true);
});

test('fewer than 14 weeks left for pairwise accuracy is UNEVALUABLE with no check evaluated', () => {
  const weekly = weeklyFor();
  weekly[3].byCol.rebuiltV31.pairwise = null;
  const gate = successorEval.gateChecks(weekly);
  assert.equal(gate.verdict, 'UNEVALUABLE');
  assert.equal(gate.checks, null);
});

test('the noise bound uses the sealed draws, seed and exact-test trigger at alpha 0.0125: a known series pins its bound and method', () => {
  const noise = successorEval.gateChecks(weeklyFor()).checks[1];
  assert.equal(noise.method, 'percentile-cluster-bootstrap');
  assert.equal(noise.quantile, 0.0125);
  assert.equal(noise.n, 14);
  assert.ok(Math.abs(noise.bound - PINNED_BOUND) < 1e-12, `bound ${noise.bound}`);

  // A degenerate series (every week identical) switches to the exact sign test.
  const degenerate = successorEval.gateChecks(weeklyFor({ pairwise: () => [0.6, 0.6, 0.65] })).checks[1];
  assert.equal(degenerate.method, 'exact-sign-test');
  assert.equal(degenerate.triggerReason, 'degenerate bootstrap');
});

// ---- end to end: a deciding run on a synthetic half_ppr ledger ----

const FAKE_V3_2 = 'free_baseline_v9.9';
const C31 = { marker: 'v3.1' };
const C32 = { marker: 'v3.2' };
const REGISTRY = { [successorEval.MODEL_VERSION_V3_1]: C31, [FAKE_V3_2]: C32 };

// Five positions, a lead and a trailer each (actual 12 vs 6). The captured
// ranking is inverted in some positions each week, so v3.1 is imperfect and a
// v3.2 that ranks on the actuals beats it in every week. Intervals cover
// either actual, so coverage is level across columns.
function decidingLedger(weekNumbers) {
  const actuals = new Map();
  const weeks = weekNumbers.map((week) => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((playerId) => {
      const position = ['QB', 'RB', 'WR', 'TE', 'K'][Math.floor((playerId - 1) / 2)];
      const lead = playerId % 2 === 1;
      const actual = lead ? 12 : 6;
      actuals.set(`${SEASON}:${week}:${playerId}`, actual);
      const inverted = (week + Math.floor((playerId - 1) / 2)) % 3 !== 0;
      const mean = (lead !== inverted) ? 12 : 6;
      return {
        playerId, position, nflTeam: 'KC', injuryStatus: null, mean, median: mean, p10: mean - 8, p25: mean - 7, p75: mean + 7, p90: mean + 8,
        activeProbability: 1, sampleSize: 5, factors: {},
      };
    });
    return { header: { season: SEASON, week, scoringHash: 'h', captureNotAfter: '2026-09-08T00:00:00.000Z' }, rows };
  });
  return { weeks, actuals };
}

function decidingGenerate(ledger) {
  const byWeek = new Map(ledger.weeks.map((w) => [w.header.week, w.rows]));
  return async ({ week, playerIds, modelConstants }) => {
    const projections = new Map();
    for (const playerId of playerIds) {
      const captured = byWeek.get(week).find((r) => r.playerId === playerId);
      const mean = modelConstants === C32 ? ledger.actuals.get(`${SEASON}:${week}:${playerId}`) : captured.mean;
      projections.set(playerId, {
        ...captured, mean, median: mean, p10: mean - 8, p25: mean - 7, p75: mean + 7, p90: mean + 8,
      });
    }
    return { projections, inputCutoff: null, sourceCoverage: {} };
  };
}

const rangeOfWeeks = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('a deciding run reports PASS with the four checks, the section 7 items and the digests, and decides on none of the section 7 items', async () => {
  const ledger = decidingLedger(rangeOfWeeks(14));
  const result = await successorEval.evaluate({
    profiles: [{ name: 'half_ppr', rules: {}, ...ledger }],
    survivors: { weeks: rangeOfWeeks(14), dropped: [] },
    modelVersion: FAKE_V3_2,
    generateProjections: decidingGenerate(ledger),
    constantsByModelVersion: REGISTRY,
  });
  const profile = result.profiles.half_ppr;
  assert.equal(result.mode, 'deciding');
  assert.equal(result.verdict, 'PASS');
  assert.deepEqual(profile.gate.checks.map((c) => c.passes), [true, true, true, true]);
  assert.ok(profile.columns.rebuiltTarget.pairwise > profile.columns.rebuiltV31.pairwise);
  assert.equal(profile.columns.rebuiltV31.pairwise, profile.columns.capturedV31.pairwise, 'the mock rebuilds v3.1 exactly');
  assert.equal(profile.gate.checks[0].errorBar, 0);
  assert.equal(profile.rowCounts.length, 14);
  assert.deepEqual(Object.keys(profile.variants).sort(), [
    'coverageOnRowsOnlyV32Serves', 'everyColumnServes', 'positionBaselineAsServed', 'withoutWeek18',
  ]);
  assert.equal(profile.variants.everyColumnServes.verdict, 'PASS');
  assert.ok(Object.keys(profile.perPosition.rebuiltTarget).includes('QB'));
  assert.equal(profile.rebuiltV31Sha256, successorEval.digestRebuiltRows(
    ledger.weeks.map((w) => ({ week: w.header.week, rows: w.rows }))
  ), 'the digest is over the rebuilt v3.1 rows');

  // Section 7 selects nothing: a failing variant leaves the verdict alone.
  const rendered = successorEval.renderReport({ ...result, ruleSha256: 'abc123', decidingRead: 'f'.repeat(40) });
  for (const needle of ['verdict: PASS', 'pairwise-size', 'pairwise-noise', 'mae-size', 'coverage cov80', 'rows every column serves',
    'Position-baseline projections counted as served', 'without week 18', 'coverage on rows only v3.2 serves', 'rows by week and reason',
    'pairwise by position', 'DECISION_RULE.md SHA-256: abc123', `run from commit (--deciding-read): ${'f'.repeat(40)}`, 'rebuilt v3.1 rows SHA-256']) {
    assert.ok(rendered.includes(needle), `report carries "${needle}"`);
  }
});

test('13 surviving weeks reports UNEVALUABLE with no check evaluated', async () => {
  const ledger = decidingLedger(rangeOfWeeks(14));
  const result = await successorEval.evaluate({
    profiles: [{ name: 'half_ppr', rules: {}, ...ledger }],
    survivors: { weeks: rangeOfWeeks(13), dropped: [] },
    modelVersion: FAKE_V3_2,
    generateProjections: decidingGenerate(ledger),
    constantsByModelVersion: REGISTRY,
  });
  assert.equal(result.verdict, 'UNEVALUABLE');
  assert.equal(result.profiles.half_ppr.gate.checks, null);
  assert.equal(result.profiles.half_ppr.weeksScored, 13, 'only the surviving weeks are scored');
});

// ---- the digests (section 2) ----

test('digestRebuiltRows is ordered by week and player id and moves with any field; actualsDigest is ordered by week and player', () => {
  const a = { week: 1, rows: [{ playerId: 2, mean: 1 }, { playerId: 1, mean: 2, p10: 0.5 }] };
  const b = { week: 2, rows: [{ playerId: 1, mean: 3 }] };
  const digest = successorEval.digestRebuiltRows([a, b]);
  assert.equal(digest, successorEval.digestRebuiltRows([b, { ...a, rows: [...a.rows].reverse() }]));
  assert.notEqual(digest, successorEval.digestRebuiltRows([a, { ...b, rows: [{ playerId: 1, mean: 3.1 }] }]));
  const x = new Map([['2026:2:1', 5], ['2026:1:2', 7], ['2026:1:1', 3]]);
  const y = new Map([['2026:1:1', 3], ['2026:1:2', 7], ['2026:2:1', 5]]);
  assert.equal(successorEval.actualsDigest(x), successorEval.actualsDigest(y));
  assert.notEqual(successorEval.actualsDigest(x), successorEval.actualsDigest(new Map([...y, ['2026:1:1', 4]])));
});

test('rebuildV31Digest, the per-child comparison, equals the digest a full run reports for the same weeks', async () => {
  const ledger = decidingLedger(rangeOfWeeks(3));
  const generateProjections = decidingGenerate(ledger);
  const digest = await successorEval.rebuildV31Digest({
    weeks: ledger.weeks, rules: {}, generateProjections, constantsByModelVersion: REGISTRY,
  });
  const result = await successorEval.evaluate({
    profiles: [{ name: 'half_ppr', rules: {}, ...ledger }],
    survivors: { weeks: rangeOfWeeks(3), dropped: [] },
    modelVersion: successorEval.MODEL_VERSION_V3_1,
    generateProjections,
    constantsByModelVersion: REGISTRY,
  });
  assert.equal(digest, result.profiles.half_ppr.rebuiltV31Sha256);
});

// ---- the runner: the read guard (section 2) and the one week loader (section 3) ----

const runner = require('../scripts/run-successor-eval');

test('a target other than free_baseline_v3.1 without --deciding-read <HEAD sha> is refused before any query', async () => {
  const base = ['--model-version', 'free_baseline_v3.2', '--season', '2026', '--out', 'backtest-artifacts/v3.2-successor-gate/x'];
  const head = () => 'a'.repeat(40);
  await assert.rejects(() => runner.main(base, { head }), /--deciding-read <sha> equal to this checkout's HEAD/);
  await assert.rejects(() => runner.main([...base, '--deciding-read', 'b'.repeat(40)], { head }), /Refusing before any query/);
  // The calibration run needs no sha; the digest mode takes only --season.
  assert.doesNotThrow(() => runner.assertDecidingRead({ modelVersion: 'free_baseline_v3.1' }, 'a'.repeat(40)));
  assert.doesNotThrow(() => runner.assertDecidingRead({ modelVersion: 'free_baseline_v3.2', decidingRead: 'a'.repeat(40) }, 'a'.repeat(40)));
  assert.throws(
    () => runner.assertDecidingRead({ modelVersion: 'free_baseline_v3.2', decidingRead: 'a'.repeat(40) }, 'a'.repeat(40), ' M server/services/projectionModel.js'),
    /clean checkout/
  );
  await assert.rejects(
    () => runner.main([...base, '--deciding-read', 'a'.repeat(40)], { head, dirty: () => ' M x.js' }),
    /clean checkout/
  );
  assert.deepEqual(runner.parseArgs(['--v31-digest', '--season', '2026']), { season: 2026, v31Digest: true });
});

test('loadSurvivors keeps only what the sealed survivingWeeks keeps, and loadProfile (also read by compare-market-factor) is restricted to those weeks', async () => {
  const kinds = ['scheduled', 'candidate:bw-20', 'candidate:bw-15'];
  const header = (week, kind, over = {}) => ({
    id: `${week}:${kind}`,
    week,
    capture_kind: kind,
    constants_hash: 'h',
    model_version: 'free_baseline_v3.1',
    cohort_hash: sha('1,2'),
    cohort_size: 2,
    captured_at: '2026-09-01T00:00:00.000Z',
    capture_not_after: '2026-09-02T00:00:00.000Z',
    is_late: false,
    ...over,
  });
  const headers = [];
  for (const week of [1, 2, 3]) for (const kind of kinds) headers.push(header(week, kind, week === 2 && kind === 'scheduled' ? { is_late: true } : {}));
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM "projection_snapshots"') && sql.includes('capture_kind" = ANY')) return { rows: headers };
      if (sql.includes('FROM "projection_snapshot_players"')) return { rows: [{ player_id: 1 }, { player_id: 2 }] };
      return { rows: [] };
    },
  };
  const survivors = await runner.loadSurvivors({ season: 2026, client });
  assert.deepEqual(survivors.weeks, [1, 3], 'the late week is not read');

  await runner.loadProfile({
    season: 2026, profileName: 'standard', client, weekNumbers: survivors.weeks,
  });
  const scheduled = queries.filter((q) => q.sql.includes("capture_kind\" = 'scheduled'")).pop();
  assert.deepEqual(scheduled.params[3], [1, 3], 'the scheduled read is restricted to the surviving weeks');
});

// ---- review round: the scoring path with the rows the end-to-end fixtures never carry ----

test('scoreWeeks scores the projection (mean times a fractional active probability, 0 where unserved, 0 for an absent actual), never the raw mean', () => {
  const baseline = { dataQuality: { reasons: ['position baseline'] } };
  const mk = (over) => ({
    mean: 10, median: 10, p10: 5, p25: 8, p75: 12, p90: 15, activeProbability: 1, factors: {}, ...over,
  });
  const entry4 = (playerId, capturedV31, rebuiltV31, rebuiltTarget) => ({
    playerId, position: 'QB', rows: { capturedV31, rebuiltV31, rebuiltTarget },
  });
  const cohortWeeks = [{
    week: 1,
    season: SEASON,
    entries: [
      // fractional probability, arriving as a pg string in the capture: projection 5, actual 4
      entry4(1, mk({ activeProbability: '0.5' }), mk({ activeProbability: 0.5 }), mk({ activeProbability: 0.5 })),
      // served in captured and rebuilt v3.1, unserved in v3.2: projection 0 there, actual 8
      entry4(2, mk({ mean: 8 }), mk({ mean: 8 }), mk({ mean: null })),
      // an absent actual is 0: projection 6
      entry4(3, mk({ mean: 6 }), mk({ mean: 6 }), mk({ mean: 6 })),
      // a Position-baseline row in v3.1 that v3.2 serves: 0, 0, 9; actual 9
      entry4(4, mk({ mean: 9, factors: baseline }), mk({ mean: 9, factors: baseline }), mk({ mean: 9 })),
    ],
  }];
  const actuals = new Map([[`${SEASON}:1:1`, 4], [`${SEASON}:1:2`, 8], [`${SEASON}:1:4`, 9]]);
  const mae = (scored) => COLS.map((c) => scored.weekly[0].byCol[c].mae);

  const primary = successorEval.scoreWeeks({ cohortWeeks, cols: COLS, actuals });
  assert.deepEqual(mae(primary), [4, 4, 3.75], '(1+0+6+9)/4, (1+0+6+9)/4, (1+8+6+0)/4');
  assert.equal(primary.rowCounts[0].scored, 4);

  const everyColumn = successorEval.scoreWeeks({ cohortWeeks, cols: COLS, actuals, everyColumnServes: true });
  assert.equal(everyColumn.rowCounts[0].scored, 2, 'players 2 and 4 are not served in every column');
  assert.deepEqual(mae(everyColumn), [3.5, 3.5, 3.5]);

  const baselineServed = successorEval.scoreWeeks({
    cohortWeeks, cols: COLS, actuals, served: successorEval.hasMeanAndIsActive,
  });
  assert.deepEqual(mae(baselineServed), [1.75, 1.75, 3.75], 'the Position-baseline row now counts at its mean');
});

test('check 4 tolerance: the drift term binds above the 0.02 floor, a small excess outside the band passes, and a cov50-only failure fails', () => {
  // captured 0.70 (distance 0.10), rebuilt v3.1 0.74 (0.06): drift 0.04, so the tolerance is 0.04, not 0.02.
  const drift = successorEval.gateChecks(weeklyFor({ cov80: [0.7, 0.74, 0.71] })).checks[3];
  assert.ok(Math.abs(drift.cov80.tolerance - 0.04) < 1e-9);
  assert.equal(drift.cov80.inBand, false);
  assert.ok(drift.cov80.excess > 0.02 && drift.cov80.excess < 0.04);
  assert.equal(drift.passes, true, 'excess 0.03 is within the drift tolerance 0.04');
  assert.equal(successorEval.gateChecks(weeklyFor({ cov80: [0.7, 0.74, 0.69] })).checks[3].passes, false, 'excess 0.05 is not');

  // 0 < excess <= 0.02, outside the band: a pass.
  const small = successorEval.gateChecks(weeklyFor({ cov80: [0.7, 0.7, 0.69] })).checks[3];
  assert.ok(small.cov80.excess > 0 && small.cov80.excess <= small.cov80.tolerance);
  assert.equal(small.cov80.inBand, false);
  assert.equal(small.passes, true);

  // 50% alone fails.
  const only50 = successorEval.gateChecks(weeklyFor({ cov50: [0.5, 0.5, 0.6] }));
  assert.equal(only50.checks[3].cov80.passes, true);
  assert.equal(only50.checks[3].cov50.passes, false);
  assert.deepEqual(passesOf(only50), [true, true, true, false]);
});

test('a v3.1 calibration run asks git for nothing: the guard is for the deciding read only', async () => {
  const calls = [];
  await assert.rejects(
    () => runner.main(
      ['--model-version', 'free_baseline_v3.1', '--season', '2026', '--out', '..'],
      { head: () => { calls.push('head'); return 'x'; }, dirty: () => { calls.push('dirty'); return ''; } }
    ),
    /not a directory inside this repository/
  );
  assert.deepEqual(calls, []);
});

test('the section 7 variants carry values: on a fully served ledger they equal the primary, and no row is only-v3.2-served', async () => {
  const ledger = decidingLedger(rangeOfWeeks(14));
  const result = await successorEval.evaluate({
    profiles: [{ name: 'half_ppr', rules: {}, ...ledger }],
    survivors: { weeks: rangeOfWeeks(14), dropped: [] },
    modelVersion: FAKE_V3_2,
    generateProjections: decidingGenerate(ledger),
    constantsByModelVersion: REGISTRY,
  });
  const { gate, variants } = result.profiles.half_ppr;
  for (const name of ['everyColumnServes', 'positionBaselineAsServed', 'withoutWeek18']) {
    assert.deepEqual(variants[name].season, gate.season, name);
  }
  assert.equal(variants.coverageOnRowsOnlyV32Serves.rows, 0);
});
