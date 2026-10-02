'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
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

function cohortHashOf(rows) {
  return crypto.createHash('sha256').update(rows.map((r) => r.playerId).sort((a, b) => a - b).join(',')).digest('hex');
}

/** One ledger arm in the sealed evaluator's shape; `overrides` break a rule (late, constants drift, ...). */
function armOf(rows, overrides = {}) {
  return {
    isLate: false,
    capturedAt: '2026-09-01T00:00:00.000Z',
    captureNotAfter: '2026-09-08T00:00:00.000Z',
    scoringHash: 'hash-x',
    constantsHash: 'constants-1',
    modelVersion: 'free_baseline_v3.1',
    cohortHash: cohortHashOf(rows),
    cohortSize: rows.length,
    rows,
    ...overrides,
  };
}

/** A ledger week: the scheduled arm plus the two candidate arms `survivingWeeks` also reads. */
function ledgerWeek(week, rows, overrides = {}) {
  const arm = armOf(rows, overrides);
  return { week, arms: { scheduled: arm, 'candidate:bw-20': { ...arm }, 'candidate:bw-15': { ...arm } } };
}

/** Two profiles, two weeks, four players each - the red-tell's synthetic ledger. */
function syntheticProfiles() {
  const captured = new Map(); // 'profile:season:week:playerId' -> row, read by the mock below
  const profiles = PROFILE_NAMES.map((name) => {
    const ledger = WEEK_NUMBERS.map((week) => {
      const rows = [1, 2, 3, 4].map((playerId) => capturedRow(playerId, week));
      for (const row of rows) captured.set(`${name}:${SEASON}:${week}:${row.playerId}`, row);
      return ledgerWeek(week, rows, { scoringHash: `hash-${name}` });
    });
    const actuals = new Map();
    for (const entry of ledger) {
      for (const row of entry.arms.scheduled.rows) actuals.set(`${SEASON}:${entry.week}:${row.playerId}`, row.mean);
    }
    return { name, rules: { profile: name }, season: SEASON, ledger, actuals };
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

test('a free_baseline_v3.1 run is the calibration run: calibration share 1.0, no v3.2 column and no verdict', async () => {
  const { profiles, captured } = syntheticProfiles();

  // Each profile's mock reproduces ITS OWN captured rows - generateProjections
  // has no notion of "profile", so the harness has to route by profile name;
  // a single generateProjections stand-in wraps the per-profile mocks by the
  // rules object identity the evaluation forwards unchanged.
  const mocksByProfile = new Map(PROFILE_NAMES.map((name) => [name, makeMockGenerateProjections(captured, name)]));
  const routedGenerateProjections = async (args) => {
    const profileName = args.rules && args.rules.profile;
    return mocksByProfile.get(profileName)(args);
  };

  const result = await successorEval.evaluate({
    profiles, modelVersion: model.MODEL_VERSION, generateProjections: routedGenerateProjections,
  });

  assert.deepEqual(Object.keys(result.profiles).sort(), [...PROFILE_NAMES].sort());
  for (const name of PROFILE_NAMES) {
    const profile = result.profiles[name];
    assert.equal(profile.weeksScored, 2);
    assert.equal(profile.calibration.checked, 8, '4 players x 2 weeks');
    assert.equal(profile.calibration.share, 1, `${name}: calibration share is 1.0 when the mock reproduces captured rows exactly`);
    assert.equal(profile.calibration.sampleSizeDiffers, 0);

    // Captured v3.1 must equal rebuilt v3.1 exactly since the mock reproduces
    // the captured row byte for byte; the calibration run computes no v3.2 column.
    assert.ok(profile.columns.capturedV31);
    assert.ok(profile.columns.rebuiltV31);
    assert.equal(profile.columns.rebuiltTarget, undefined);
    assert.equal(profile.gate, undefined);
    assert.equal(profile.columns.capturedV31.mae, profile.columns.rebuiltV31.mae);
    assert.equal(profile.columns.capturedV31.mae, 0, 'actuals were pinned to the captured mean, so MAE is exactly 0');
    assert.equal(profile.columns.capturedV31.cov80, 1, 'the captured interval always contains its own mean');
  }

  const rendered = successorEval.renderReport(result);
  for (const name of PROFILE_NAMES) assert.match(rendered, new RegExp(`## ${name}`));
  assert.match(rendered, /captured v3\.1/);
  assert.match(rendered, /rebuilt v3\.1/);
  assert.doesNotMatch(rendered, /Verdict/);
  assert.match(rendered, /v3\.1 rebuild calibration: 1\.0000 of 8 rows/);
});

test('evaluate refuses an unregistered MODEL_VERSION before calling generateProjections at all', async () => {
  const { profiles } = syntheticProfiles();
  let called = false;
  await assert.rejects(
    () => successorEval.evaluate({
      profiles,
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
  // The 'standard' profile: half_ppr would be UNEVALUABLE on one week.
  const oneProfile = [{ ...profiles[1], ledger: [profiles[1].ledger[0]] }];

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
    modelVersion: FAKE_V3_2,
    generateProjections: stubGenerateProjections,
    constantsByModelVersion: { [V3_1]: v31Constants, [FAKE_V3_2]: v32Constants },
  });
  assert.equal(seenConstants.length, 2, 'one reprojection for rebuilt v3.1, one for the v3.2 target');
  assert.ok(seenConstants.includes(v31Constants), 'the v3.1 column ran with v3.1\'s own constants');
  assert.ok(seenConstants.includes(v32Constants), 'the target column ran with the target\'s own constants');
  assert.notEqual(seenConstants[0], seenConstants[1], 'the two columns must not share one constants object');
  assert.equal(result.profiles[oneProfile[0].name].columns.rebuiltTarget.modelVersion, FAKE_V3_2);
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
// The gate (decision rule of 2026-10-02 on #1438): survival, as-served scoring,
// the four checks, the verdict
// ---------------------------------------------------------------------------

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const V3_2 = 'free_baseline_v9.9';
const V31_CONSTANTS = { marker: 'v3.1' };
const V32_CONSTANTS = { marker: 'v3.2' };
const GATE_REGISTRY = { [successorEval.MODEL_VERSION_V3_1]: V31_CONSTANTS, [V3_2]: V32_CONSTANTS };

/**
 * Twelve players, two per position. Players 1-6 score 10 and 7-12 score 5, but
 * the captured means put them the wrong way round: captured pairwise accuracy
 * is 0 and every captured interval misses.
 */
function gateRows() {
  return Array.from({ length: 12 }, (_, i) => {
    const playerId = i + 1;
    const mean = playerId <= 6 ? 5 : 10;
    return {
      playerId,
      position: POSITIONS[i % 6],
      nflTeam: 'KC',
      injuryStatus: null,
      mean,
      median: mean,
      p10: mean - 3,
      p25: mean - 1,
      p75: mean + 1,
      p90: mean + 3,
      activeProbability: 1,
      sampleSize: 5,
      factors: {},
    };
  });
}

function gateProfile({ weeks = 14, name = 'half_ppr', mutate = {} } = {}) {
  const ledger = [];
  const actuals = new Map();
  for (let week = 1; week <= weeks; week++) {
    const rows = gateRows();
    ledger.push(ledgerWeek(week, rows, mutate[week] || {}));
    for (const r of rows) actuals.set(`${SEASON}:${week}:${r.playerId}`, r.playerId <= 6 ? 10 : 5);
  }
  return { name, rules: {}, season: SEASON, ledger, actuals };
}

/**
 * v3.1 reproduces the capture. The v3.2 target projects each player's actual,
 * except player 12 (no mean) and player 11 (active probability 0 with a mean).
 */
function gateGenerate({ target = 'perfect', calls = [] } = {}) {
  return async ({ playerIds, modelConstants }) => {
    calls.push(modelConstants);
    const projections = new Map();
    for (const playerId of playerIds) {
      const captured = gateRows()[playerId - 1];
      if (modelConstants === V31_CONSTANTS || target === 'captured') {
        projections.set(playerId, { ...captured });
      } else if (playerId === 12) {
        projections.set(playerId, { position: captured.position, mean: null, activeProbability: 1 });
      } else if (playerId === 11) {
        projections.set(playerId, {
          ...captured, mean: 5, median: 5, p10: 2, p25: 4, p75: 6, p90: 8, activeProbability: 0,
        });
      } else {
        const actual = playerId <= 6 ? 10 : 5;
        projections.set(playerId, {
          ...captured, mean: actual, median: actual, p10: actual - 3, p25: actual - 1, p75: actual + 1, p90: actual + 3,
        });
      }
    }
    return { projections, inputCutoff: null, sourceCoverage: {} };
  };
}

function runGate(profile, generateProjections = gateGenerate()) {
  return successorEval.evaluate({
    profiles: [profile], modelVersion: V3_2, generateProjections, constantsByModelVersion: GATE_REGISTRY,
  });
}

test('only the surviving weeks are scored: a late week and a constants-drift week drop, 13 survivors are UNEVALUABLE with nothing evaluated', async () => {
  const calls = [];
  const profile = gateProfile({
    weeks: 16,
    mutate: { 3: { isLate: true }, 4: { constantsHash: 'constants-2' } },
  });
  const ok = await runGate(profile, gateGenerate({ calls }));
  const half = ok.profiles.half_ppr;
  assert.equal(half.weeksScored, 14);
  assert.deepEqual(half.droppedWeeks.map((d) => d.week).sort((a, b) => a - b), [3, 4]);
  assert.match(half.droppedWeeks.find((d) => d.week === 3).reason, /captured late/);
  assert.match(half.droppedWeeks.find((d) => d.week === 4).reason, /constants_hash differs/);
  assert.deepEqual(half.weekly.captured.map((w) => w.week), [1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  calls.length = 0;
  const short = await runGate(gateProfile({ weeks: 14, mutate: { 5: { isLate: true } } }), gateGenerate({ calls }));
  assert.equal(short.profiles.half_ppr.weeksScored, 13);
  assert.equal(short.profiles.half_ppr.gate.verdict, 'UNEVALUABLE');
  assert.equal(short.profiles.half_ppr.gate.checks, null, 'no check is evaluated');
  assert.equal(calls.length, 0, 'nothing was re-projected');
  assert.match(successorEval.renderReport(short), /Verdict: UNEVALUABLE/);
});

test('as-served scoring: a null mean or active probability 0 scores as a projection of 0, in every column, with every cohort row counted by served state', () => {
  const cohort = gateRows();
  const actuals = new Map(cohort.map((r) => [`${SEASON}:1:${r.playerId}`, r.playerId <= 6 ? 10 : 5]));
  assert.equal(successorEval.servedState({ mean: 3, activeProbability: 0 }), 'activeZero', 'a mean on an inactive row is still unserved');
  assert.equal(successorEval.servedState({ mean: null, activeProbability: 1 }), 'nullMean');
  assert.equal(successorEval.servedState(undefined), 'nullMean', 'a cohort row the column lacks is unserved');
  assert.equal(successorEval.servedState({ mean: '4.5', activeProbability: '1' }), 'served', 'pg numeric strings');

  // Perfect projections except players 1 and 7, which this column does not serve.
  const rows = cohort.map((r) => ({ ...r, mean: r.playerId <= 6 ? 10 : 5 }));
  rows[0] = { ...rows[0], mean: null };
  rows[6] = { ...rows[6], activeProbability: 0 };
  const out = successorEval.asServedWeek({ cohort, rows, actuals, season: SEASON, week: 1 });
  assert.deepEqual(out.counts, { served: 10, nullMean: 1, activeZero: 1 });
  // |0 - 10| + |0 - 5| over all 12 cohort rows, not over the 10 served.
  assert.equal(out.mae, 15 / 12);
  // QB pair {1, 7}: both project 0 while actuals differ, a tie, 0.5. RB pair {2, 8} is untouched.
  assert.equal(out.perPosition.QB, 0.5);
  assert.equal(out.perPosition.RB, 1);

  // A column lacking a cohort row scores it as 0 as well.
  const missing = successorEval.asServedWeek({ cohort, rows: rows.filter((r) => r.playerId !== 2), actuals, season: SEASON, week: 1 });
  assert.deepEqual(missing.counts, { served: 9, nullMean: 2, activeZero: 1 });
});

test('coverage is scored on the rows eligible in every column', () => {
  const cohort = gateRows();
  const actuals = new Map(cohort.map((r) => [`${SEASON}:1:${r.playerId}`, r.playerId <= 6 ? 10 : 5]));
  const perfect = cohort.map((r) => {
    const a = r.playerId <= 6 ? 10 : 5;
    return { ...r, p10: a - 3, p90: a + 3, p25: a - 1, p75: a + 1 };
  });
  const blank = perfect.map((r) => (r.playerId === 12 ? { ...r, p10: null, p90: null, p25: null, p75: null } : r));
  const inactive = perfect.map((r) => (r.playerId === 11 ? { ...r, activeProbability: 0 } : r));
  const out = successorEval.commonCoverageWeek({
    columns: { captured: perfect, rebuiltV31: blank, rebuiltTarget: inactive }, actuals, season: SEASON, week: 1,
  });
  assert.equal(out.cov80.n, 10, 'players 11 and 12 are ineligible in one column each, so in none');
  assert.equal(out.cov50.n, 10);
  assert.equal(out.cov80.captured, 1);
});

/** Aligned per-week scores for gateChecks; the target's jitter keeps the weekly deltas from being degenerate. */
function weeklyFor({
  pw = [0.6, 0.6, 0.66], mae = [5, 5, 4.5], cov80 = [0.78, 0.78, 0.79], cov50 = [0.48, 0.48, 0.49], weeks = 14, jitter,
}) {
  const out = {};
  ['captured', 'rebuiltV31', 'rebuiltTarget'].forEach((name, c) => {
    out[name] = Array.from({ length: weeks }, (_, i) => ({
      week: i + 1,
      pairwise: pw[c] + (name === 'rebuiltTarget' ? (jitter ? jitter(i) : ((i % 5) - 2) * 0.001) : 0),
      mae: mae[c],
      cov80: cov80[c],
      cov50: cov50[c],
    }));
  });
  return out;
}

const CHECKS = ['pairwiseVsCapture', 'pairwiseBeyondNoise', 'maeVsCapture', 'coverageNoHarm'];
const passes = (checks) => CHECKS.map((k) => checks[k].passes);

test('PASS only when all four checks pass, and each check has a case where only it fails', () => {
  const all = successorEval.gateChecks({ weekly: weeklyFor({}) });
  assert.deepEqual(passes(all), [true, true, true, true]);
  assert.equal(successorEval.verdictOf(all), 'PASS');

  // 1: below the capture by more than nothing, but ahead of rebuilt v3.1 every week.
  const c1 = successorEval.gateChecks({ weekly: weeklyFor({ pw: [0.7, 0.69, 0.695] }) });
  assert.deepEqual(passes(c1), [false, true, true, true]);
  assert.equal(successorEval.verdictOf(c1), 'FAIL');

  // 2: ahead of the capture on average, but the weekly gain over rebuilt v3.1 is not beyond noise.
  const c2 = successorEval.gateChecks({
    weekly: weeklyFor({ pw: [0.5, 0.5, 0.52], jitter: (i) => (i % 2 === 0 ? 0.2 : -0.16) }),
  });
  assert.deepEqual(passes(c2), [true, false, true, true]);
  assert.equal(successorEval.verdictOf(c2), 'FAIL');

  // 3: MAE within the rebuild error bar of the capture.
  const c3 = successorEval.gateChecks({ weekly: weeklyFor({ mae: [5, 5.2, 4.9] }) });
  assert.deepEqual(passes(c3), [true, true, false, true]);

  // 4: 80% coverage further from nominal than the capture's plus the error bar.
  const c4 = successorEval.gateChecks({ weekly: weeklyFor({ cov80: [0.78, 0.78, 0.7] }) });
  assert.deepEqual(passes(c4), [true, true, true, false]);
  assert.equal(c4.coverageNoHarm.cov80.passes, false);
  assert.equal(c4.coverageNoHarm.cov50.passes, true);

  // Inputs travel with every check.
  assert.equal(all.pairwiseVsCapture.errorBar, 0);
  assert.equal(all.pairwiseBeyondNoise.alpha, 0.025);
  assert.equal(all.pairwiseBeyondNoise.draws, 100000);
  assert.equal(all.pairwiseBeyondNoise.seed, 2579717975);
  assert.equal(all.coverageNoHarm.cov80.nominal, 0.8);
  assert.ok(Number.isFinite(all.coverageNoHarm.cov80.errorBar));
});

test('the noise bound is the sealed study\'s cluster bootstrap: a known weekly series pins to its bound and method', () => {
  const series = [0.02, 0.05, -0.01, 0.04, 0.03, 0.06, 0.01, 0.05, 0.02, 0.04, 0.03, 0.0, 0.05, 0.04];
  const out = successorEval.noiseCheck(series);
  assert.equal(out.method, 'percentile-cluster-bootstrap');
  assert.equal(out.quantile, 0.025, 'the lower bound at the sealed test alpha');
  assert.ok(Math.abs(out.bound - 0.02) < 1e-12);
  assert.equal(out.passes, true);

  // A degenerate bootstrap (one distinct weekly value) falls to the exact sign test, as the sealed study's does.
  const flat = successorEval.noiseCheck(Array(14).fill(0.1));
  assert.equal(flat.method, 'exact-sign-test');
  assert.equal(flat.triggerReason, 'degenerate bootstrap');
  assert.equal(flat.passes, true);
});

test('end to end a v3.2 run prints PASS for half_ppr, with the other profile reported and selecting nothing', async () => {
  const result = await successorEval.evaluate({
    profiles: [gateProfile({ name: 'half_ppr' }), gateProfile({ name: 'standard' })],
    modelVersion: V3_2,
    generateProjections: gateGenerate(),
    constantsByModelVersion: GATE_REGISTRY,
  });
  const half = result.profiles.half_ppr;
  assert.equal(half.gate.verdict, 'PASS');
  assert.equal(result.profiles.standard.gate, null, 'a non-gate profile gets no verdict');
  assert.ok(result.profiles.standard.columns.rebuiltTarget, 'but its columns are reported');

  // Row counts by served state, per column: 14 weeks x 12 cohort rows.
  assert.deepEqual(half.columns.capturedV31.counts, { served: 168, nullMean: 0, activeZero: 0 });
  assert.deepEqual(half.columns.rebuiltTarget.counts, { served: 140, nullMean: 14, activeZero: 14 });
  assert.equal(half.columns.capturedV31.pairwise, 0);
  assert.equal(half.columns.rebuiltTarget.pairwise, 1);
  assert.equal(half.coverageEligibleRows.cov80, 14 * 10, 'players 11 and 12 are ineligible in the target column');

  // Reported, not selecting: rho, per-position cells, the weeks 1 to 17 sensitivity.
  assert.ok(Number.isFinite(half.columns.rebuiltTarget.spearman));
  assert.equal(half.columns.rebuiltTarget.perPosition.QB, 1);
  assert.ok(half.gate.sensitivityWeeks1to17);
  const rendered = successorEval.renderReport(result);
  assert.match(rendered, /Verdict: PASS/);
  assert.match(rendered, /Pairwise beyond noise: PASS/);
  assert.match(rendered, /Weeks 1 to 17 sensitivity/);

  // A target no better than the capture FAILs.
  const flat = await runGate(gateProfile({}), gateGenerate({ target: 'captured' }));
  assert.equal(flat.profiles.half_ppr.gate.verdict, 'FAIL');
});

// ---------------------------------------------------------------------------
// The runner's loader keeps feeding compare-market-factor.js its `weeks`
// ---------------------------------------------------------------------------

test('loadProfile still returns the scheduled-arm weeks in the shape compare-market-factor.js reads, beside the sealed-shape ledger', async () => {
  const runner = require('../scripts/run-successor-eval');
  const header = (id, week, kind) => ({
    id, week, capture_kind: kind, scoring_hash: 'h', constants_hash: 'c', model_version: 'v', cohort_hash: 'x', cohort_size: 1,
    captured_at: 'a', capture_not_after: `nb-${week}`, is_late: false,
  });
  const child = { player_id: 7, position: 'WR', nfl_team: 'KC', injury_status: null, mean: '9.5', active_probability: '1', sample_size: 3 };
  const client = {
    async query(sql, params) {
      if (sql.includes('FROM "projection_snapshots"')) {
        return { rows: [header(1, 1, 'scheduled'), header(2, 1, 'candidate:bw-20'), header(3, 1, 'candidate:bw-15')] };
      }
      if (sql.includes('FROM "projection_snapshot_players"')) {
        return { rows: params[0] === 1 ? [child] : [{ player_id: 7 }] };
      }
      return { rows: [{ player_id: 7, season: 2026, week: 1, stats: {} }] };
    },
  };
  const profile = await runner.loadProfile({ season: 2026, profileName: 'half_ppr', client });
  assert.equal(profile.weeks.length, 1);
  assert.deepEqual(profile.weeks[0].header, {
    season: 2026, week: 1, scoringHash: 'h', captureNotAfter: 'nb-1',
  });
  assert.equal(profile.weeks[0].rows[0].mean, '9.5');
  assert.equal(profile.weeks[0].rows[0].playerId, 7);
  assert.deepEqual(Object.keys(profile.ledger[0].arms).sort(), ['candidate:bw-15', 'candidate:bw-20', 'scheduled']);
  assert.deepEqual(profile.ledger[0].arms['candidate:bw-20'].rows, [{ playerId: 7 }]);
  assert.ok(profile.actuals.has('2026:1:7'));
});
