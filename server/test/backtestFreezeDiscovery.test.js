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

function initByteIdenticalWitnessRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-freeze-discovery-witness-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['config', 'user.email', 'backtest@example.invalid']);
  git(repo, ['config', 'user.name', 'Backtest Test']);
  commit(repo, artifactPath, '{"cell":"usage-25__homeaway-off"}\n', 'historical freeze');
  const commitA = commit(repo, 'scripts/backtest/new-analysis.js', 'module.exports = true;\n', 'commit A');
  const artifactBlob = git(repo, ['rev-parse', `${commitA}:${artifactPath}`]);
  git(repo, [
    'commit',
    '--allow-empty',
    '-m',
    'commit M byte-identical witness',
    '-m',
    `Backtest-MDE-Witness: byte-identical\nBacktest-MDE-Path: ${artifactPath}\nBacktest-MDE-Blob: ${artifactBlob}`,
  ]);
  const commitM = git(repo, ['rev-parse', 'HEAD']);
  return { repo, commitA, commitM };
}

function manifestFor(commitA, commitM) {
  return `${JSON.stringify({ commitA: { sha: commitA }, commitM: { sha: commitM } })}\n`;
}

// The freeze lineage's immutable final boundary (Commit F) is the script's
// second CLI argument, defaulting to the sealed production constant. Every
// fixture repo builds its own history with its own SHAs, so each test that
// reaches the post-B window passes the boundary it wants enforced; omitting
// it would fall back to the production SHA, which no fixture repo contains.
function discover(repo, finalBoundary) {
  const args = [discoveryScript, 'HEAD'];
  if (finalBoundary) args.push(finalBoundary);
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8' });
  return { status: result.status, stdout: JSON.parse(result.stdout), stderr: result.stderr };
}

test('discovers A/M and accepts a directly parented B plus output-only descendants', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  const commitB = commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  const commitF = commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/REPORT.md', 'report\n', 'report');

  const result = discover(repo, commitF);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.commitA, commitA);
  assert.equal(result.stdout.commitM, commitM);
  assert.equal(result.stdout.commitB, commitB);
  assert.equal(result.stdout.bCheck.outputOnlyCommits, 1);
  assert.equal(result.stdout.bCheck.finalBoundary, commitF);
});

test('discovers an explicit byte-identical MDE witness when regeneration keeps the existing blob', (t) => {
  const { repo, commitA, commitM } = initByteIdenticalWitnessRepo(t);
  const commitB = commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');

  // No output commit followed B in this lineage, so B is its own final
  // boundary and the quiet window B..F is empty.
  const result = discover(repo, commitB);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.commitA, commitA);
  assert.equal(result.stdout.commitM, commitM);
  assert.equal(result.stdout.commitB, commitB);
  assert.equal(result.stdout.bCheck.outputOnlyCommits, 0);
});

test('refuses a claimed byte-identical MDE witness whose blob trailer is forged', (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-freeze-discovery-forged-witness-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['config', 'user.email', 'backtest@example.invalid']);
  git(repo, ['config', 'user.name', 'Backtest Test']);
  commit(repo, artifactPath, '{"cell":"usage-25__homeaway-off"}\n', 'historical freeze');
  commit(repo, 'scripts/backtest/new-analysis.js', 'module.exports = true;\n', 'commit A');
  git(repo, [
    'commit',
    '--allow-empty',
    '-m',
    'forged M witness',
    '-m',
    `Backtest-MDE-Witness: byte-identical\nBacktest-MDE-Path: ${artifactPath}\nBacktest-MDE-Blob: ${'0'.repeat(40)}`,
  ]);

  const result = discover(repo);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.ok, false);
  assert.match(result.stdout.reason, /invalid byte-identical MDE witness/i);
});

test('treats a historical B before a replacement M witness as superseded while new B is pending', (t) => {
  const { repo, commitA: historicalA, commitM: historicalM } = initFreezeRepo(t);
  commit(repo, manifestPath, manifestFor(historicalA, historicalM), 'historical B');
  const commitA = commit(repo, 'scripts/backtest/replacement.js', 'module.exports = true;\n', 'replacement A');
  const artifactBlob = git(repo, ['rev-parse', `${commitA}:${artifactPath}`]);
  git(repo, [
    'commit',
    '--allow-empty',
    '-m',
    'replacement M byte-identical witness',
    '-m',
    `Backtest-MDE-Witness: byte-identical\nBacktest-MDE-Path: ${artifactPath}\nBacktest-MDE-Blob: ${artifactBlob}`,
  ]);
  const commitM = git(repo, ['rev-parse', 'HEAD']);

  const result = discover(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.commitA, commitA);
  assert.equal(result.stdout.commitM, commitM);
  assert.equal(result.stdout.commitB, null);
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

test('refuses a non-output path changed inside the quiet window (between B and the final boundary)', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  commit(repo, 'server/services/drift.js', 'module.exports = false;\n', 'forbidden drift');
  const commitF = commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/report.json', '{}\n', 'results');

  // The drift commit sits inside the declared window B..F, so it must fail
  // loud even though a later output commit (F) closes the window.
  const result = discover(repo, commitF);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.ok, false);
  assert.match(result.stdout.reason, /server\/services\/drift\.js/);
});

test('does not create a chronic red for an unrelated change AFTER the final boundary', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  const commitB = commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  const commitF = commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/report.json', '{}\n', 'results');
  // Ordinary development resumes after the lineage is sealed. These commits
  // are outside the window B..F and must not be judged against it - this is
  // the regression that made the workflow permanently red (#468).
  commit(repo, 'server/services/unrelated.js', 'module.exports = 1;\n', 'unrelated feature');
  commit(repo, 'src/app/page.jsx', 'export default null;\n', 'more unrelated work');

  const result = discover(repo, commitF);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.commitA, commitA);
  assert.equal(result.stdout.commitM, commitM);
  assert.equal(result.stdout.commitB, commitB);
  assert.equal(result.stdout.bCheck.finalBoundary, commitF);
  // Only the single output commit F falls inside the window.
  assert.equal(result.stdout.bCheck.outputOnlyCommits, 1);
});

test('report-only changes inside the window pass', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/REPORT.md', 'report\n', 'report');
  const commitF = commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/report.json', '{"x":1}\n', 'report json');

  const result = discover(repo, commitF);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.bCheck.outputOnlyCommits, 2);
});

test('the finalized lineage stays discoverable from a much later ref', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  const commitB = commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  const commitF = commit(repo, 'backtest-artifacts/pit-sweep-2024-2025/report.json', '{}\n', 'results');
  for (let i = 0; i < 6; i += 1) {
    commit(repo, `src/feature-${i}.js`, `module.exports = ${i};\n`, `later work ${i}`);
  }

  const result = discover(repo, commitF);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.ok, true);
  assert.equal(result.stdout.commitA, commitA);
  assert.equal(result.stdout.commitM, commitM);
  assert.equal(result.stdout.commitB, commitB);
});

test('fails loud when the configured final boundary is not a descendant of Commit B', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  const commitB = commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');
  // A boundary that predates B (here, Commit B's own parent, Commit M) can
  // never bound the window - a stale or superseded constant must fail loud so
  // it gets corrected, never silently check an empty or wrong window.
  const staleBoundary = commitM;

  const result = discover(repo, staleBoundary);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.ok, false);
  assert.equal(result.stdout.commitB, commitB);
  assert.match(result.stdout.reason, /not a descendant of/i);
});

test('fails loud when the configured final boundary does not resolve to a commit', (t) => {
  const { repo, commitA, commitM } = initFreezeRepo(t);
  commit(repo, manifestPath, manifestFor(commitA, commitM), 'commit B');

  const result = discover(repo, '0'.repeat(40));
  assert.equal(result.status, 1);
  assert.equal(result.stdout.ok, false);
  assert.match(result.stdout.reason, /final boundary/i);
});
