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

test('MUTATION TEST: changed, missing, or extra regenerated artifact bytes are refused', (t) => {
  const changed = makeArtifactTrees(t);
  fs.writeFileSync(path.join(changed.regeneratedDir, 'index.json'), '{"ok":false}\n');
  assert.throws(() => entrypoint.assertArtifactTreesByteIdentical(changed), /not byte-identical/);

  const extra = makeArtifactTrees(t);
  fs.writeFileSync(path.join(extra.regeneratedDir, 'roster-weeks', 'extra.json'), '{}\n');
  assert.throws(() => entrypoint.assertArtifactTreesByteIdentical(extra), /paths differ/);
});
