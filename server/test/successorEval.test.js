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
  assert.throws(() => successorEval.constantsFor('free_baseline_v3.2'), /no constants registered/);
  assert.equal(successorEval.constantsFor(model.MODEL_VERSION), model.MODEL_CONSTANTS);
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
  assert.ok(seenArgs.playerContextOverrideById instanceof Map);
  assert.ok(seenArgs.expertOverrideByPlayerId instanceof Map);
  assert.equal(out.length, 1);
  assert.equal(out[0].mean, 9);

  await assert.rejects(
    () => successorEval.reprojectWeek({
      header, rows, rules: {}, modelVersion: 'free_baseline_v3.2', generateProjections: fakeGenerateProjections,
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
    assert.equal(modelConstants, model.MODEL_CONSTANTS, 'the v3.1 constants are what a v3.1 reprojection gets');
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
    profiles, modelVersion: model.MODEL_VERSION, generateProjections: routedGenerateProjections,
  });

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
    assert.ok(profile.columns.rebuiltTarget);
    assert.equal(profile.columns.rebuiltTarget.modelVersion, model.MODEL_VERSION);
    assert.equal(profile.columns.capturedV31.mae, profile.columns.rebuiltV31.mae);
    assert.equal(profile.columns.capturedV31.mae, profile.columns.rebuiltTarget.mae);
    assert.equal(profile.columns.capturedV31.mae, 0, 'actuals were pinned to the captured mean, so MAE is exactly 0');
    assert.equal(profile.columns.capturedV31.cov80, 1, 'the captured interval always contains its own mean');
  }

  const rendered = successorEval.renderReport(result);
  for (const name of PROFILE_NAMES) assert.match(rendered, new RegExp(`## ${name}`));
  assert.match(rendered, /captured v3\.1/);
  assert.match(rendered, /rebuilt v3\.1/);
  assert.match(rendered, new RegExp(`rebuilt ${model.MODEL_VERSION.replace(/\./g, '\\.')}`));
  assert.match(rendered, /v3\.1 rebuild calibration: 1\.0000 of 8 rows/);
});

test('evaluate refuses an unregistered MODEL_VERSION before calling generateProjections at all', async () => {
  const { profiles } = syntheticProfiles();
  let called = false;
  await assert.rejects(
    () => successorEval.evaluate({
      profiles,
      modelVersion: 'free_baseline_v3.2',
      generateProjections: async () => { called = true; },
    }),
    /no constants registered/
  );
  assert.equal(called, false);
});
