'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const entrypoint = require('../../backtest-entrypoint');

test('Dockerfile base image and runtime-identity pin are identical', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', 'backtest.Dockerfile'), 'utf8');
  assert.equal(entrypoint.assertDockerfileImageIdentity(dockerfile), true);
});

test('MUTATION TEST: a Dockerfile/runtime image-pin divergence is refused', () => {
  const mutated = 'FROM node:24-slim@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
  assert.throws(() => entrypoint.assertDockerfileImageIdentity(mutated), /does not match the runtime-identity pin/);
});

function makeArtifactTrees(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-container-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const committed = path.join(root, 'committed');
  const regenerated = path.join(root, 'regenerated');
  for (const tree of [committed, regenerated]) {
    fs.mkdirSync(path.join(tree, 'roster-weeks'), { recursive: true });
    fs.mkdirSync(path.join(tree, 'cohort-weeks'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'index.json'), '{"ok":true}\n');
    fs.writeFileSync(path.join(tree, 'roster-weeks', '2025-w2.json'), '{"rosters":[]}\n');
    fs.writeFileSync(path.join(tree, 'cohort-weeks', '2025-w2.json'), '{"members":[]}\n');
  }
  return { committedDir: committed, regeneratedDir: regenerated };
}

test('regenerated roster/cohort/index artifacts must byte-match Commit A', (t) => {
  const trees = makeArtifactTrees(t);
  assert.equal(entrypoint.assertArtifactTreesByteIdentical(trees), 3);
});

// ---------------------------------------------------------------------------
// Mode dispatch (increment 4: freeze/sweep)
// ---------------------------------------------------------------------------

test('parseMode defaults to freeze with no argv, for exact backward compatibility', () => {
  assert.equal(entrypoint.parseMode([]), 'freeze');
  assert.equal(entrypoint.parseMode(undefined), 'freeze');
});

test('parseMode recognizes every declared mode', () => {
  assert.deepEqual([...entrypoint.MODES], ['freeze', 'sweep', 'inputs']);
  for (const mode of entrypoint.MODES) {
    assert.equal(entrypoint.parseMode([mode]), mode);
  }
});

test('parseMode refuses an unrecognized mode rather than silently defaulting to freeze', () => {
  assert.throws(() => entrypoint.parseMode(['bogus']), /unknown mode 'bogus'.*freeze, sweep, inputs/s);
  assert.throws(() => entrypoint.parseMode(['Freeze']), /unknown mode 'Freeze'/, 'mode names are case-sensitive, never fuzzily matched');
});

test('inputs mode runs the canaries FIRST, then the producer, forwarding argv unchanged', () => {
  // The dispatch is read from source rather than executed: runInputs shells
  // real scripts against fixed container mounts, which a unit test has
  // neither. What must hold is structural - the canary step precedes the
  // producer step inside runInputs, the producer receives `...argv`, and the
  // require.main dispatch actually routes 'inputs' to runInputs.
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'backtest-entrypoint.js'), 'utf8');
  const body = source.match(/function runInputs\(argv\) \{([\s\S]*?)\n\}/);
  assert.ok(body, 'runInputs must exist');
  const canaryIndex = body[1].indexOf('run-backtest-canaries.js');
  const producerIndex = body[1].indexOf('run-backtest-inputs.js');
  assert.ok(canaryIndex >= 0 && producerIndex >= 0, 'runInputs must invoke the canaries and the producer');
  assert.ok(canaryIndex < producerIndex, 'the canaries must run BEFORE the producer (prereg 17 / spec 8.6.0 pinned order)');
  assert.match(body[1], /run-backtest-inputs\.js'\), \.\.\.argv\]/, 'the producer receives every argument after the mode, unchanged after the pinned heap flag');
  assert.match(source, /else runInputs\(process\.argv\.slice\(3\)\)/, "the require.main dispatch routes 'inputs' to runInputs");
});

test('large-artifact modes pin the heap capacity the real candidate run required', () => {
  assert.equal(entrypoint.LARGE_ARTIFACT_HEAP_MB, 12288);
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'backtest-entrypoint.js'), 'utf8');
  for (const functionName of ['runInputs', 'runSweep']) {
    const body = source.match(new RegExp(`function ${functionName}\\(argv\\) \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(body, `${functionName} must exist`);
    assert.match(
      body[1],
      /--max-old-space-size=\$\{LARGE_ARTIFACT_HEAP_MB\}/,
      `${functionName} must apply the reviewed 12 GiB V8 heap without an operator-supplied environment variable`,
    );
  }
});

test('MUTATION TEST: changed, missing, or extra regenerated artifact bytes are refused', (t) => {
  const changed = makeArtifactTrees(t);
  fs.writeFileSync(path.join(changed.regeneratedDir, 'index.json'), '{"ok":false}\n');
  assert.throws(() => entrypoint.assertArtifactTreesByteIdentical(changed), /not byte-identical/);

  const extra = makeArtifactTrees(t);
  fs.writeFileSync(path.join(extra.regeneratedDir, 'roster-weeks', 'extra.json'), '{}\n');
  assert.throws(() => entrypoint.assertArtifactTreesByteIdentical(extra), /paths differ/);
});
