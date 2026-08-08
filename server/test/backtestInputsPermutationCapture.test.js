const test = require('node:test');
const assert = require('node:assert/strict');

const captureLib = require('../../scripts/backtest/lib/inputsPermutationCapture');
const permutationControl = require('../../scripts/backtest/lib/permutationControl');
const metrics = require('../../scripts/backtest/lib/metrics');
const arms = require('../../scripts/backtest/lib/arms');
const { PRIMARY_SCORING_PROFILE } = require('../../scripts/backtest/lib/freezeManifest');
const { ORDERINGS } = require('../../scripts/backtest/lib/ordering');
const { optimalAssignment } = require('../../server/services/lineupOptimizer');
const { availabilityFor } = require('../../server/services/projectionModel');
const { DEFAULT_ROSTER_SLOTS } = require('../../server/services/lineup.service');

const { SALTS, EVALUATED_WEEKS, MACRO_POSITIONS } = metrics;

/**
 * Increment 4, the permutation-control observation capture. Everything here
 * runs on synthetic fixtures - `generate` is an injected spy, no snapshot, no
 * database, no real projection - and the fixtures DISCRIMINATE (the standing
 * QA lesson): the projected median varies with the SALT and the PLAYER, the
 * actual varies with the player, and the cohort carries members the domain
 * must exclude for two different reasons plus a bye member it must keep.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// QB ids DELIBERATELY straddle a digit-length boundary (9 vs 10): a
// lexicographic sort emits [10, 9] where the numeric sort emits [9, 10], so
// the string-sort mutant is killed by the canonical-order assertion natively
// rather than by a bespoke test (mutation-QA survivor cap-10 - the A1
// numeric/string lesson applied to the FIXTURE).
const pid = (position, n) => (position === 'QB' ? 8 + n : MACRO_POSITIONS.indexOf(position) * 100 + n);
const BYE_RB = pid('RB', 3);
const UNRESOLVED_WR = pid('WR', 4);
const NON_MACRO_ID = 9999;
const SECOND_NON_MACRO_ID = 9998;

/**
 * Injective over the fixture ids, distinct within every cell (pairwise
 * eligibility needs untied actuals), and WEEK-DEPENDENT - so a capture that
 * reuses one week's domain rows for another week emits detectably wrong
 * actuals (mutation-QA survivor cap-06's killer, made direct).
 */
const actualOf = (playerId, week) => (playerId % 100) + Math.floor(playerId / 100) / 10 + week / 100;
const saltIndexOf = (hashValueOrSalt) => {
  const salt = hashValueOrSalt.includes(':') ? hashValueOrSalt.slice(hashValueOrSalt.indexOf(':') + 1) : hashValueOrSalt;
  const index = SALTS.indexOf(salt);
  if (index < 0) throw new Error(`fixture: ${hashValueOrSalt} does not name a preregistered salt`);
  return index;
};

/**
 * Order-preserving per cell under every salt (so the flagship's control beats
 * the shuffle), but salt-DISTINCT (so a capture that reused one salt's run
 * for all 24 emits detectably wrong rows).
 */
const defaultMedian = ({ playerId, salt, week }) => actualOf(playerId, week) * 2 + saltIndexOf(salt) * 0.001;

function cohortMembers() {
  const members = MACRO_POSITIONS.flatMap((position) => [1, 2].map((n) => ({
    playerId: pid(position, n), position, teamKey: `T${pid(position, n)}`, injuryStatus: null, onBye: false,
  })));
  // In the domain DESPITE the bye: byes stay rostered, and the reducer
  // requires an observation for every rostered player.
  members.push({ playerId: BYE_RB, position: 'RB', teamKey: 'TBYE', injuryStatus: null, onBye: true });
  // Excluded: no resolved outcome truth. Unrostered, so the capture succeeds
  // and counts it rather than failing.
  members.push({ playerId: UNRESOLVED_WR, position: 'WR', teamKey: 'TUNR', injuryStatus: null, onBye: false });
  // Excluded: not a macro position (both have actuals, so the reason is the
  // position). TWO of them, against ONE unresolved member, so the exclusion
  // tallies are ASYMMETRIC - swapped counters cannot balance (mutation-QA
  // survivor cap-12, the all-favorable-fixture lesson applied to counts).
  members.push({ playerId: NON_MACRO_ID, position: 'FB', teamKey: 'TFB', injuryStatus: null, onBye: false });
  members.push({ playerId: SECOND_NON_MACRO_ID, position: 'LS', teamKey: 'TLS', injuryStatus: null, onBye: false });
  return members;
}

const DOMAIN_IDS = [...MACRO_POSITIONS.flatMap((position) => [1, 2].map((n) => pid(position, n))), BYE_RB];
const DOMAIN_SIZE = DOMAIN_IDS.length; // 13

function fixtureWeekArtifacts({ mutate } = {}) {
  const map = new Map();
  for (const week of EVALUATED_WEEKS) {
    const members = cohortMembers();
    const actualPointsByPlayerId = {};
    for (const member of members) {
      if (member.playerId === UNRESOLVED_WR) continue;
      actualPointsByPlayerId[String(member.playerId)] = actualOf(member.playerId, week);
    }
    // One real STARTER, the rest bench: an all-bench roster makes the
    // starters half of the coverage assertion unreachable (mutation-QA
    // survivor cap-19 - "check what a fixture makes UNREACHABLE").
    const [starterId, ...benchIds] = DOMAIN_IDS;
    const artifact = {
      rosterWeek: {
        rosters: [{
          replicate: 1,
          teamIndex: 0,
          starters: [{ playerId: starterId, slot: 'QB' }],
          bench: benchIds.map((playerId) => ({ playerId })),
        }],
      },
      cohortWeek: {
        season: 2025, week, members, actualPointsByPlayerId,
      },
    };
    if (mutate) mutate(week, artifact);
    map.set(`2025:${week}`, artifact);
  }
  return map;
}

function makeGenerate({ medianFor = defaultMedian } = {}) {
  const calls = [];
  const generate = async (args) => {
    calls.push(args);
    const salt = args.hashValue.slice(args.hashValue.indexOf(':') + 1);
    const projections = new Map(args.playerIds.map((playerId) => {
      const median = medianFor({ playerId, salt, week: args.week });
      return [playerId, median === undefined ? undefined : { median }];
    }).filter(([, value]) => value !== undefined));
    return { projections, inputCutoff: 'cutoff', sourceCoverage: { status: 'ok' } };
  };
  return { calls, generate };
}

const defaultSeedFor = ({ hashValue, week, playerId }) => week * 1000000 + playerId * 30 + saltIndexOf(hashValue);

function captureInputs(overrides = {}) {
  const { calls, generate } = makeGenerate(overrides);
  return {
    calls,
    inputs: {
      weekArtifacts: fixtureWeekArtifacts(),
      baseConstants: { usage: { blendWeight: 0.6, halfLife: 3 }, homeAway: { enabled: true } },
      scoringHashFor: () => 'abc123',
      generate,
      seedFor: defaultSeedFor,
      ...overrides.inputs,
    },
  };
}

const canonicalRank = (row) => ((SALTS.indexOf(row.salt) * EVALUATED_WEEKS.length + EVALUATED_WEEKS.indexOf(row.week)) * MACRO_POSITIONS.length
  + MACRO_POSITIONS.indexOf(row.position)) * 1e6 + row.playerId;

// ---------------------------------------------------------------------------
// The capture itself
// ---------------------------------------------------------------------------

test('the capture emits the full canonical stream: 408 generations, per-salt medians, counted exclusions, byes in', async () => {
  const { inputs } = captureInputs();
  const result = await captureLib.capturePermutationControlObservations(inputs);

  assert.deepEqual(result.counts, {
    generations: captureLib.CAPTURE_TOTAL,
    observations: SALTS.length * EVALUATED_WEEKS.length * DOMAIN_SIZE,
    rosterRows: EVALUATED_WEEKS.length * DOMAIN_SIZE,
    // Asymmetric on purpose: two non-macro members, one unresolved member,
    // per week - swapped counters cannot balance.
    excluded: {
      nonMacroPosition: 2 * EVALUATED_WEEKS.length,
      unresolvedActual: EVALUATED_WEEKS.length,
    },
  });
  assert.equal(captureLib.CAPTURE_TOTAL, 408, 'section 5: 17 weeks x 24 salts');

  // Canonical salt -> week -> position -> playerId, strictly ascending. The
  // QB cell's ids straddle a digit boundary, so this also proves the sort is
  // NUMERIC: a lexicographic sort emits [10, 9] and fails here.
  for (let i = 1; i < result.observations.length; i++) {
    assert.ok(canonicalRank(result.observations[i - 1]) < canonicalRank(result.observations[i]), `observation ${i} out of canonical order`);
  }

  // The rows carry the PER-SALT median and the WEEK's own resolved actual -
  // not one reference salt's run, and not another week's domain, republished.
  for (const salt of [SALTS[0], SALTS[7], SALTS[23]]) {
    const row = result.observations.find((r) => r.salt === salt && r.week === 9 && r.playerId === pid('QB', 1));
    assert.deepEqual(row, {
      season: 2025,
      week: 9,
      salt,
      position: 'QB',
      playerId: pid('QB', 1),
      actual: actualOf(pid('QB', 1), 9),
      projected: defaultMedian({ playerId: pid('QB', 1), salt, week: 9 }),
    });
  }

  // The bye member is IN; the unresolved and non-macro members are OUT of
  // both arrays - excluded by COUNT above, never silently.
  const observedIds = new Set(result.observations.map((r) => r.playerId));
  assert.equal(observedIds.has(BYE_RB), true, 'a rostered bye member must carry observations');
  assert.equal(observedIds.has(UNRESOLVED_WR), false);
  assert.equal(observedIds.has(NON_MACRO_ID), false);
  assert.equal(result.rosterRows.some((r) => r.playerId === BYE_RB && r.position === 'RB'), true);
  assert.equal(result.rosterRows.length, new Set(result.rosterRows.map((r) => `${r.week}:${r.playerId}`)).size, 'one roster row per (week, player)');
});

test('byes are forced into the domain by the reducer\'s own coverage rule, not by preference', async () => {
  const { inputs } = captureInputs();
  const result = await captureLib.capturePermutationControlObservations(inputs);

  // NEGATIVE CONTROL: strip the bye member's rows - exactly what a capture
  // that copied prereg 4.1's point-accuracy exclusion would emit - and the
  // reducer's own domain assertion rejects it, because the bye is rostered.
  const withoutBye = {
    observations: result.observations.filter((row) => row.playerId !== BYE_RB),
    rosterRows: result.rosterRows.filter((row) => row.playerId !== BYE_RB),
  };
  assert.throws(
    () => permutationControl.computePermutationControlFromObservations({
      ...withoutBye, ...reducerMachinery(),
    }),
    /has no observation/
  );
});

/** The reducer-side machinery the runner injects (never document-supplied). */
function reducerMachinery() {
  const artifacts = fixtureWeekArtifacts();
  const byWeek = (pick) => Object.fromEntries(EVALUATED_WEEKS.map((week) => [week, pick(artifacts.get(`2025:${week}`))]));
  return {
    rosterWeeks: byWeek((artifact) => artifact.rosterWeek),
    cohortWeeks: byWeek((artifact) => artifact.cohortWeek),
    positionRank: new Map(MACRO_POSITIONS.map((position, i) => [position, i + 1])),
    nameRankById: new Map(cohortMembers().map((member) => [member.playerId, member.playerId])),
    rosterSlots: DEFAULT_ROSTER_SLOTS,
    availabilityFor,
    optimize: optimalAssignment,
    ordering: ORDERINGS.PRIMARY,
    expectedRosterCount: 1,
  };
}

test('FLAGSHIP: the captured observations drive the real permutation control end to end, and the ordered control beats the shuffle', async () => {
  const { inputs } = captureInputs();
  const result = await captureLib.capturePermutationControlObservations(inputs);

  const control = metrics.computePermutationControl({
    observations: result.observations,
    rosterRows: result.rosterRows,
    ...reducerMachinery(),
  });

  // Order-preserving projections start the best lineup under every salt, so
  // observed regret is exactly 0 and pairwise is exactly 1; every permutation
  // replicate can only degrade both, so both plus-one p-values are minimal
  // and the run is LIVE. A capture that scrambled the projection-to-player
  // pairing, or paired a player with another salt's median, moves these.
  assert.equal(control.void, false);
  assert.equal(control.regret.observed, 0);
  assert.equal(control.pairwise.observed, 1);
  assert.equal(control.regret.p, 1 / 10001);
  assert.equal(control.pairwise.p, 1 / 10001);
  assert.equal(control.replicates, 10000);
});

test('deterministic: the same artifacts and generator yield byte-identical output', async () => {
  const first = await captureLib.capturePermutationControlObservations(captureInputs().inputs);
  const second = await captureLib.capturePermutationControlObservations(captureInputs().inputs);
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// The generation calls, pinned from OUTSIDE on the spy (the module records
// nothing about its own calls on purpose - see its docblock on the dead
// self-check pattern)
// ---------------------------------------------------------------------------

test('the salt reaches generation only through the hashValue: constants resolved once, control cell, primary profile', async () => {
  const { calls, inputs } = captureInputs();
  await captureLib.capturePermutationControlObservations(inputs);

  assert.equal(calls.length, 408);
  const constants = calls[0].modelConstants;
  // The CONTROL cell's resolution of the injected base constants...
  assert.equal(constants.usage.blendWeight, arms.CONTROL_BLEND_WEIGHT);
  assert.equal(constants.usage.halfLife, 3, 'non-arm base constants must survive resolution');
  assert.equal(constants.homeAway.enabled, false);
  for (const call of calls) {
    // ...resolved ONCE: every call carries the identical object, so there is
    // nothing per-salt to drift.
    assert.equal(call.modelConstants, constants);
    assert.equal(call.scoringProfile, PRIMARY_SCORING_PROFILE);
    assert.equal(call.season, 2025);
    assert.ok(call.hashValue.startsWith('abc123:'), 'the hashValue must be the profile scoring hash, salted');
    assert.ok(SALTS.includes(call.hashValue.slice('abc123:'.length)), 'the hashValue suffix must be a preregistered salt');
    // No baseline capture: spec 6.5's callback belongs to the sweep's
    // matched-off generations, and a second source would launder provenance.
    assert.equal('onPreHomeAwayBaseline' in call, false);
    // The generation is asked for the FULL cohort, not only the domain.
    assert.equal(call.playerIds.length, cohortMembers().length);
  }
  for (const week of EVALUATED_WEEKS) {
    const weekCalls = calls.filter((call) => call.week === week);
    assert.equal(weekCalls.length, SALTS.length);
    assert.deepEqual(weekCalls.map((call) => call.hashValue.slice(7)), SALTS, 'all 24 salts, in SALTS order, per week');
  }
});

// ---------------------------------------------------------------------------
// Fail-closed boundaries
// ---------------------------------------------------------------------------

test('a rostered player outside the domain fails the capture WITH its cause attached', async () => {
  // Cause 1: rostered but no resolved outcome truth.
  const unresolvedRostered = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => artifact.rosterWeek.rosters[0].bench.push({ playerId: UNRESOLVED_WR }),
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(unresolvedRostered.inputs),
    /rostered player 204 is outside the observation domain - no resolved outcome truth/
  );

  // Cause 2: rostered but absent from the cohort entirely - and as a
  // STARTER, so the starters half of the walk is proven live (mutation-QA
  // survivor cap-19: an all-bench fixture made it dead code).
  const strangerStarting = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => artifact.rosterWeek.rosters[0].starters.push({ playerId: 5000, slot: 'FLEX' }),
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(strangerStarting.inputs),
    /rostered player 5000 is outside the observation domain - it has no cohort entry/
  );

  // Cause 3: rostered but not a macro position.
  const nonMacroRostered = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => artifact.rosterWeek.rosters[0].bench.push({ playerId: NON_MACRO_ID }),
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(nonMacroRostered.inputs),
    /rostered player 9999 is outside the observation domain - position "FB" is not one of the six macro positions/
  );
});

test('a domain member with no finite projected median under ANY salt is named, week and salt attached (risk D)', async () => {
  const missing = captureInputs({
    medianFor: ({ playerId, salt, week }) => (
      playerId === BYE_RB && week === 11 && salt === SALTS[5] ? undefined : defaultMedian({ playerId, salt, week })
    ),
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(missing.inputs),
    new RegExp(`2025w11 ${SALTS[5]}: domain member ${BYE_RB} \\(RB\\) has no finite projected median`)
  );

  const nan = captureInputs({
    medianFor: ({ playerId, salt, week }) => (
      playerId === pid('K', 2) && week === 2 && salt === SALTS[0] ? NaN : defaultMedian({ playerId, salt, week })
    ),
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(nan.inputs),
    /no finite projected median/
  );

  // A projection carrying only p50: refused, never scored through a fallback
  // field the contract does not name (mutation-QA survivor cap-18), and the
  // error carries the projection's actual shape.
  const p50Only = captureInputs({
    inputs: {
      generate: async (args) => ({
        projections: new Map(args.playerIds.map((playerId) => [
          playerId, playerId === pid('QB', 1) ? { p50: 5 } : { median: 1 },
        ])),
        inputCutoff: 'cutoff',
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(p50Only.inputs),
    /no finite projected median \(the projection is \{"p50":5\}\)/
  );

  // A projections MAP keyed by string ids names the KEY-TYPE defect, not
  // missing model coverage (adversarial QA finding F7).
  const stringKeyed = captureInputs({
    inputs: {
      generate: async (args) => ({
        projections: new Map(args.playerIds.map((playerId) => [String(playerId), { median: 1 }])),
        inputCutoff: 'cutoff',
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(stringKeyed.inputs),
    /the projections Map is keyed by STRING ids/
  );
});

test('obligation 3 at the pure layer: a generator returning the Map, or no projections, is refused by name', async () => {
  const mapReturning = captureInputs({
    inputs: { generate: async ({ playerIds }) => new Map(playerIds.map((id) => [id, { median: 1 }])) },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(mapReturning.inputs),
    /returned the projections Map itself - it must return the WHOLE run object/
  );

  const bare = captureInputs({ inputs: { generate: async () => ({ inputCutoff: 'x' }) } });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(bare.inputs),
    /must return a run object carrying a projections map/
  );
});

test('cohort ids are ASSERTED numeric and duplicate-free, never coerced', async () => {
  const stringId = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => { if (week === 3) artifact.cohortWeek.members[0].playerId = '1'; },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(stringId.inputs),
    /playerId is "1" \(string\), not a finite number/
  );

  const duplicate = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => {
          if (week === 4) artifact.cohortWeek.members.push({ ...artifact.cohortWeek.members[0] });
        },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(duplicate.inputs),
    /twice - a duplicate raw id must be rejected before any run is generated/
  );
});

test('a PRESENT but malformed outcome truth throws by name; only ABSENT excludes (adversarial finding F2)', async () => {
  // A string actual would coerce cleanly through Number() and emit a clean
  // row - the laundering the strict check exists to stop.
  const stringActual = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => {
          if (week === 5) artifact.cohortWeek.actualPointsByPlayerId[String(pid('TE', 1))] = '7.5';
        },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(stringActual.inputs),
    new RegExp(`2025w5: member ${pid('TE', 1)}'s outcome truth is "7.5" \\(string\\), not a finite number`)
  );

  // NaN cannot come from the JSON artifact at all, so present-but-NaN is an
  // in-memory defect: THROWN, never excluded-and-counted (mutation-QA
  // survivor cap-20, resolved to the stricter side).
  const nanActual = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => {
          if (week === 5) artifact.cohortWeek.actualPointsByPlayerId[String(pid('TE', 1))] = NaN;
        },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(nanActual.inputs),
    /outcome truth is null \(number\), not a finite number/
  );
});

test('a mis-shaped roster artifact fails the coverage check, never makes it vacuous (adversarial finding F3)', async () => {
  const emptyRosters = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => { if (week === 3) artifact.rosterWeek.rosters = []; },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(emptyRosters.inputs),
    /2025w3: the roster artifact carries no rosters array/
  );

  // A roster carrying only `players` (no starters/bench) is exactly the shape
  // the wiring's assertNumericPlayerIds walks and this check does not - the
  // split-coverage trap, closed by requiring the fields this check reads.
  const playersOnly = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => {
          if (week === 3) artifact.rosterWeek.rosters = [{ players: [{ playerId: pid('QB', 1) }] }];
        },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(playersOnly.inputs),
    /rosters\[0\] lacks starters\/bench arrays/
  );
});

test('a generator that mutates its inputs fails loudly, never quietly diverges the salts (adversarial finding F4)', async () => {
  const { generate } = makeGenerate();
  const idPusher = captureInputs({
    inputs: {
      generate: async (args) => {
        const run = await generate(args);
        args.playerIds.push(424242);
        return run;
      },
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(idPusher.inputs),
    /mutated the playerIds array between salts/
  );

  const { generate: generate2 } = makeGenerate();
  const constantsMutator = captureInputs({
    inputs: {
      generate: async (args) => {
        const run = await generate2(args);
        args.modelConstants.usage.blendWeight = 0.9;
        return run;
      },
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(constantsMutator.inputs),
    /mutated the shared resolved constants/
  );
});

test('an empty (week, position) cell, a missing week artifact, and a bad scoring hash each fail by name', async () => {
  const noKickers = captureInputs({
    inputs: {
      weekArtifacts: fixtureWeekArtifacts({
        mutate: (week, artifact) => {
          if (week !== 6) return;
          artifact.cohortWeek.members = artifact.cohortWeek.members.filter((m) => m.position !== 'K');
          artifact.rosterWeek.rosters[0].bench = artifact.rosterWeek.rosters[0].bench.filter(
            (p) => p.playerId !== pid('K', 1) && p.playerId !== pid('K', 2)
          );
        },
      }),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(noKickers.inputs),
    /2025w6: no K member has a resolved outcome truth/
  );

  const artifacts = fixtureWeekArtifacts();
  artifacts.delete('2025:7');
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(captureInputs({ inputs: { weekArtifacts: artifacts } }).inputs),
    /2025w7: no roster\/cohort artifacts supplied for 2025:7/
  );

  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(captureInputs({ inputs: { scoringHashFor: () => 'ABC' } }).inputs),
    /must return a lowercase hexadecimal scoring hash/
  );
});

test('the mandatory runtime seed guard covers these generations too (spec 3.4.5)', async () => {
  // A seedFor that ignores the salt collides immediately.
  const colliding = captureInputs({
    inputs: { seedFor: ({ week, playerId }) => week * 1000 + playerId },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(colliding.inputs),
    /produced the identical final seed/
  );

  // The guard covers the FULL cohort - 3.4.5 is "for EVERY evaluated
  // player-week it actually computes", and the generation is asked for every
  // member, so a collision on a domain-EXCLUDED member still aborts
  // (mutation-QA survivor cap-14).
  const collideExcludedOnly = captureInputs({
    inputs: {
      seedFor: ({ hashValue, week, playerId }) => (
        playerId === NON_MACRO_ID ? 7 : defaultSeedFor({ hashValue, week, playerId })
      ),
    },
  });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(collideExcludedOnly.inputs),
    new RegExp(`playerId ${NON_MACRO_ID} salt seeds.*identical final seed`, 's')
  );

  // And a non-u32 seed is refused before the collision scan.
  const fractional = captureInputs({ inputs: { seedFor: () => 1.5 } });
  await assert.rejects(
    () => captureLib.capturePermutationControlObservations(fractional.inputs),
    /a final seed must be an unsigned 32-bit integer/
  );
});
