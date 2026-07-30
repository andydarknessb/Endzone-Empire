const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mde = require('../../scripts/backtest/lib/mde');
const arms = require('../../scripts/backtest/lib/arms');
const metrics = require('../../scripts/backtest/lib/metrics');

/** A control-only per-week series, seeded so the tests are deterministic. */
const CONTROL_REGRET = Array.from({ length: 17 }, (unused, i) => 4 + Math.sin(i) * 0.4);
const CONTROL_PAIRWISE = Array.from({ length: 17 }, (unused, i) => 0.55 + Math.cos(i) * 0.01);

/**
 * A small grid, so the smoke run is fast; the frozen grid is asserted
 * separately. `artifacts` is always supplied because the runner REQUIRES
 * something to blind-check - being handed nothing is itself refused.
 */
const SMALL = {
  artifacts: [{ cell: arms.CONTROL_CELL }],
  correlations: [0.5],
  regretEffects: [0, -0.5],
  pairwiseEffects: [0, 0.02],
  experiments: 15,
  draws: 200,
};

// ---------------------------------------------------------------------------
// THE BLINDING
// ---------------------------------------------------------------------------

test('the runner REFUSES a candidate cell - the blinding is enforced, not promised', () => {
  // This is the property the preregistration cares about most: an MDE computed
  // after glimpsing the candidates could be used to argue a sealed margin was
  // unfair.
  assert.throws(() => mde.assertControlOnly({
    artifacts: [{ cell: 'usage-40-on' }],
  }), /BLINDED and runs on control-only artifacts.*usage-40-on/s);
  assert.throws(() => mde.assertControlOnly({
    artifacts: [{ cell: arms.CONTROL_CELL }, { cell: 'usage-60-off' }],
  }), /usage-60-off/);
  // Every non-control cell is named in the refusal.
  const err = (() => {
    try {
      mde.assertControlOnly({ artifacts: [{ cell: 'usage-00-on' }, { cell: 'usage-60-on' }] });
      return null;
    } catch (e) { return e.message; }
  })();
  assert.match(err, /usage-00-on, usage-60-on/);
  assert.match(err, /the margins are sealed/);

  // Control artifacts pass, as does an artifact with no cell field at all
  // (a raw per-week series).
  assert.equal(mde.assertControlOnly({ artifacts: [{ cell: arms.CONTROL_CELL }] }), true);
  assert.equal(mde.assertControlOnly({ artifacts: [{ weeks: [1, 2] }] }), true);
  // No artifacts at all cannot estimate anything.
  assert.throws(() => mde.assertControlOnly({ artifacts: [] }), /no control artifacts supplied/);
});

test('runMde refuses a candidate cell end to end, before any simulation runs', () => {
  assert.throws(() => mde.runMde({
    controlRegretWeeks: CONTROL_REGRET,
    controlPairwiseWeeks: CONTROL_PAIRWISE,
    // AFTER the spread, so the candidate artifact is what actually reaches the
    // runner rather than being overwritten by SMALL's control one.
    ...SMALL,
    artifacts: [{ cell: 'usage-40-on' }],
  }), /BLINDED and runs on control-only artifacts/);
});

test('the module is structurally incapable of reaching a candidate artifact', () => {
  // The blinding is a property of the REQUIRE GRAPH: there is no filesystem
  // access, no path construction, and no snapshot loader in here, so there is
  // nothing to point at a candidate cell even with intent.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'mde.js'), 'utf8'
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const requires = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(requires.sort(), ['./arms', './metrics', './numbers'],
    'it imports only pure computation, never a loader');
  for (const forbidden of ['fs', 'path', './snapshotStore', './snapshotClient', 'loadSnapshot',
    'loadOracle', 'readFileSync']) {
    assert.ok(!code.includes(forbidden), `mde.js must not reference ${forbidden}`);
  }
  assert.ok(!/path\.(join|resolve)\(/.test(code), 'and it builds no paths');
  // It exports no loader either.
  for (const exported of Object.keys(mde)) {
    assert.ok(!/load|read|fetch|open/i.test(exported), `${exported} sounds like a loader`);
  }
});

// ---------------------------------------------------------------------------
// The frozen algorithm
// ---------------------------------------------------------------------------

test('the grid and constants are the preregistered ones', () => {
  assert.equal(mde.MDE_SEED, 184424023);
  assert.deepEqual([...mde.CORRELATION_GRID],
    [0.00, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.99]);
  assert.deepEqual([...mde.REGRET_EFFECTS], [0, -0.05, -0.10, -0.15, -0.20, -0.30, -0.50]);
  assert.deepEqual([...mde.PAIRWISE_EFFECTS], [0, 0.0025, 0.0050, 0.0075, 0.0100, 0.0150, 0.0200]);
  assert.equal(mde.EXPERIMENTS_PER_CELL, 2000);
  assert.equal(mde.EVALUATED_WEEK_COUNT, 17);
  // The simulation-only draw count is a DECLARED deviation, and the
  // authoritative analysis is untouched by it.
  assert.equal(mde.SIMULATION_DRAWS, 10000);
  assert.equal(metrics.BOOTSTRAP_DRAWS, 100000);
  assert.notEqual(mde.SIMULATION_DRAWS, metrics.BOOTSTRAP_DRAWS);
  // The full grid is 12 x 7 x 7 cells.
  assert.equal(mde.CORRELATION_GRID.length * mde.REGRET_EFFECTS.length
    * mde.PAIRWISE_EFFECTS.length, 588);
});

test('the SD estimate comes from the control weeks and needs at least two', () => {
  assert.ok(Math.abs(mde.weekSd([1, 3]) - Math.sqrt(2)) < 1e-12);
  assert.equal(mde.weekSd([5, 5, 5, 5]), 0);
  assert.throws(() => mde.weekSd([1]), /at least two weeks/);
  assert.throws(() => mde.weekSd([null, '']), /at least two weeks/);
});

// ---------------------------------------------------------------------------
// The contours
// ---------------------------------------------------------------------------

test('the runner produces joint two-primary power contours, named and deterministic', () => {
  const report = mde.runMde({
    controlRegretWeeks: CONTROL_REGRET, controlPairwiseWeeks: CONTROL_PAIRWISE, ...SMALL,
  });
  assert.equal(report.name, 'primary-component power for the seven claims');
  assert.equal(report.blinded, true);
  assert.equal(report.cell, arms.CONTROL_CELL);
  assert.equal(report.contours.length, 1 * 2 * 2);
  for (const point of report.contours) {
    assert.ok(point.power >= 0 && point.power <= 1, 'power is a fraction');
  }
  // Deterministic: the seed makes the whole grid reproducible.
  const again = mde.runMde({
    controlRegretWeeks: CONTROL_REGRET, controlPairwiseWeeks: CONTROL_PAIRWISE, ...SMALL,
  });
  assert.deepEqual(report.contours, again.contours);
});

test('power rises with the injected effect - the contours mean something', () => {
  const report = mde.runMde({
    controlRegretWeeks: new Array(17).fill(0).map((unused, i) => 4 + (i % 3) * 0.05),
    controlPairwiseWeeks: new Array(17).fill(0).map((unused, i) => 0.55 + (i % 3) * 0.001),
    artifacts: [{ cell: arms.CONTROL_CELL }],
    correlations: [0.5],
    regretEffects: [0, -0.5],
    pairwiseEffects: [0, 0.02],
    experiments: 40,
    draws: 300,
  });
  const at = (r, p) => report.contours.find((c) => c.regretEffect === r && c.pairwiseEffect === p).power;
  // A null effect must almost never be "detected" - that is the false-positive
  // rate, and it is bounded by alpha/7 on each of two conjoined inequalities.
  assert.ok(at(0, 0) <= 0.05, `a null effect was detected ${at(0, 0)} of the time`);
  // A large effect on both endpoints must be detected far more often.
  assert.ok(at(-0.5, 0.02) > at(0, 0), 'a real effect is detected more often than none');

  // THE CONJUNCTION. Component (a) needs BOTH inequalities, so a huge regret
  // effect with NO pairwise effect must still go undetected. This is what
  // distinguishes simulating the real decision rule from simulating half of
  // it - and a loosened margin would show up here too.
  assert.ok(at(-0.5, 0) <= 0.05,
    `regret-only effect was "detected" ${at(-0.5, 0)} of the time; component (a) needs both bounds`);
  assert.ok(at(-0.5, 0.02) > at(-0.5, 0),
    'adding the pairwise effect is what turns a regret-only effect into a detection');
});

test('the simulation uses the SEALED margins, not looser ones of its own', () => {
  // A discriminating fixture: an effect that sits BETWEEN a hypothetical loose
  // margin and the sealed one. With delta_R = 0.15 and delta_P = 0.005 this
  // must NOT be detected; a runner that had quietly adopted, say, -0.01 and
  // 0.0001 would detect it almost always. Tiny SDs make the bootstrap bounds
  // tight enough that the margin is the only thing deciding.
  const report = mde.runMde({
    controlRegretWeeks: Array.from({ length: 17 }, (unused, i) => 4 + (i % 2) * 0.002),
    controlPairwiseWeeks: Array.from({ length: 17 }, (unused, i) => 0.55 + (i % 2) * 0.00002),
    artifacts: [{ cell: arms.CONTROL_CELL }],
    correlations: [0.0],
    // Comfortably past a loose margin, comfortably short of the sealed one.
    regretEffects: [-0.05],
    pairwiseEffects: [0.001],
    experiments: 25,
    draws: 300,
  });
  const power = report.contours[0].power;
  assert.equal(power, 0,
    `an effect short of the sealed margins was detected ${power} of the time; the runner is not `
    + 'simulating delta_R = 0.15 and delta_P = 0.005');

  // And the same fixture with effects PAST the sealed margins is detected,
  // so the zero above is the margin biting rather than the simulation failing.
  const past = mde.runMde({
    controlRegretWeeks: Array.from({ length: 17 }, (unused, i) => 4 + (i % 2) * 0.002),
    controlPairwiseWeeks: Array.from({ length: 17 }, (unused, i) => 0.55 + (i % 2) * 0.00002),
    artifacts: [{ cell: arms.CONTROL_CELL }],
    correlations: [0.0],
    regretEffects: [-0.30],
    pairwiseEffects: [0.02],
    experiments: 25,
    draws: 300,
  });
  assert.equal(past.contours[0].power, 1, 'past the sealed margins it is detected every time');
});

test('the report states what it does NOT simulate, and that it cannot move a margin', () => {
  const report = mde.runMde({
    controlRegretWeeks: CONTROL_REGRET, controlPairwiseWeeks: CONTROL_PAIRWISE, ...SMALL,
  });
  // The preregistration requires this limitation in the same breath as the
  // contours, so it travels with the artifact rather than living in prose.
  assert.deepEqual(report.notSimulated, [
    'the naive benchmark gate (d)',
    'the safety gates (e1) and (e2)',
    'the subgroup gate (f)',
    'anything on 2024',
  ]);
  assert.equal(report.canAlterMargins, false);
  assert.match(report.note, /can NEVER alter a margin, a threshold, or a decision rule/);
  // And the settings are recorded, so a smoke run can never be mistaken for
  // the frozen grid.
  assert.equal(report.settings.experiments, SMALL.experiments);
  assert.equal(report.settings.draws, SMALL.draws);
  assert.equal(report.settings.alpha, metrics.COMPONENT_ALPHA);
});

test('the MDE uses the component-(a) inequalities and the sealed margins', () => {
  // It must simulate the REAL decision rule, or the power it reports is for a
  // test nobody runs.
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'mde.js'), 'utf8'
  );
  assert.ok(src.includes('DELTA_R') && src.includes('DELTA_P'),
    'it uses the sealed margins rather than its own');
  assert.equal(arms.DELTA_R, 0.15);
  assert.equal(arms.DELTA_P, 0.005);
  // And it takes them from arms, so a margin change cannot leave the MDE stale.
  assert.match(src, /require\('\.\/arms'\)/);
});
