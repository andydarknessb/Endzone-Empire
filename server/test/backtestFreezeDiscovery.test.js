'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const discoveryScript = path.join(__dirname, '..', '..', 'scripts', 'ci', 'discover-freeze-commits.js');
const artifactPath = 'backtest-artifacts/pit-sweep-2024-2025/freeze/mde-artifact.json';
const manifestPath = 'backtest-artifacts/pit-sweep-2024-2025/freeze/FREEZE_MANIFEST.json';

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function write(repo, relativePath, contents) {
  const fullPath = path.join(repo, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents, 'utf8');
}

function commit(repo, relativePath, contents, message) {
  write(repo, relativePath, contents);
  git(repo, ['add', '--', relativePath]);
  git(repo, ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function initFreezeRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-freeze-discovery-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['config', 'user.email', 'backtest@example.invalid']);
  git(repo, ['config', 'user.name', 'Backtest Test']);
  commit(repo, 'README.md', 'fixture\n', 'base');
  const commitA = commit(repo, 'scripts/backtest/new-analysis.js', 'module.exports = true;\n', 'commit A');
  const commitM = commit(repo, artifactPath, '{"cell":"usage-25__homeaway-off"}\n', 'commit M');
  return { repo, commitA, commitM };
}

function manifestFor(commitA, commitM) {
  return `${JSON.stringify({ commitA: { sha: commitA }, commitM: { sha: commitM } })}\n`;
}

function discover(repo) {
  const result = spawnSync(process.execPath, [discoveryScript, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, stdout: JSON.parse(result.stdout), stderr: result.stderr };
}

test('discovers A/M and accepts a directly parented B plus output-only descendants', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  const commitB = commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/REPORT.md', 'report\n', 'report');

  const result = discover(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.commitA, commitA);
  assert.equal(result.stdout.commitM, commitM);
  assert.equal(result.stdout.commitB, commitB);
  assert.equal(result.stdout.bCheck.outputOnlyCommits, 1);
});

test('refuses Commit B when an intervening commit breaks parent(B)=M', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  commit(repo, 'notes.txt', 'intervening\n', 'intervening');
  commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');

  const result = discover(repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.ok, false);
  assert.match(result.stdout.reason, /parent\(B\) = M/);
});

test('refuses a non-output path changed after Commit B', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  commit(repo, 'server/services/drift.js', 'module.exports = false;\n', 'forbidden drift');

  const result = discover(repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.ok, false);
  assert.match(result.stdout.reason, /server\/services\/drift\.js/);
});
