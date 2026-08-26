const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

// Issue #247: the three config guards (test:eslint-scoping, test:check-dom-dedupe,
// test:jest-discovery) existed only as npm scripts nobody's CI ever ran. CRA
// pins `jest.testMatch` to `src/` (see scripts/jestTestMatch.test.js), and
// these guards are `node:test` files anyway, so the existing client unit job
// never reaches them.
//
// The fix chains the three through one aggregating `guards` npm script and
// adds a CI job that runs it. The point of going through `npm run <name>`
// rather than inlining each guard's command is that a rename of any of the
// three leaves the aggregating script trying to run a script that no longer
// exists: `npm run <renamed-away-name>` exits non-zero with "Missing script",
// so the job goes red instead of silently doing nothing. Inlining the guards'
// underlying commands (`node --test scripts/...`) would keep passing after a
// rename of the npm script name, defeating that property.
//
// These assertions are a regression guard on that wiring, not a replacement
// for actually running the job in CI: the wall-time and renamed-script-goes-red
// acceptance criteria in #247 can only be proven by a real GitHub Actions run.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

const GUARD_SCRIPTS = ['test:eslint-scoping', 'test:check-dom-dedupe', 'test:jest-discovery'];

function loadPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
}

function loadCiWorkflow() {
  return YAML.parse(fs.readFileSync(CI_WORKFLOW_PATH, 'utf8'));
}

function findGuardsJob(doc) {
  return Object.values(doc.jobs).find((job) =>
    (job.steps || []).some((step) => typeof step.run === 'string' && step.run.trim() === 'npm run guards')
  );
}

test('each of the three guard npm scripts still exists in package.json', () => {
  const packageJson = loadPackageJson();
  for (const guard of GUARD_SCRIPTS) {
    assert.ok(guard in packageJson.scripts, `"${guard}" is missing from package.json scripts`);
  }
});

test('package.json declares an aggregating "guards" script that runs all three guard scripts by name', () => {
  const packageJson = loadPackageJson();
  assert.ok(packageJson.scripts.guards, '"guards" script is missing from package.json');
  for (const guard of GUARD_SCRIPTS) {
    assert.ok(
      packageJson.scripts.guards.includes(`npm run ${guard}`),
      `"guards" script does not invoke "npm run ${guard}" by name, so a rename of ` +
        `that script would not make "npm run guards" fail`
    );
  }
});

test('ci.yml has a job that runs the aggregating guards script', () => {
  const doc = loadCiWorkflow();
  assert.ok(findGuardsJob(doc), 'no job in ci.yml runs "npm run guards"');
});

test('the guards job runs on pull requests and on pushes to main and integration', () => {
  const doc = loadCiWorkflow();
  assert.ok(findGuardsJob(doc), 'no job in ci.yml runs "npm run guards"');
  // ci.yml has a single top-level `on:` shared by every job, so the guards
  // job inherits it automatically -- assert the trigger set stays what #247
  // asked for rather than the job existing under some other workflow.
  assert.deepEqual(doc.on.push.branches, ['main', 'integration']);
  assert.ok('pull_request' in doc.on);
});

test('the guards job installs dependencies with npm ci before running the guards', () => {
  const doc = loadCiWorkflow();
  const guardsJob = findGuardsJob(doc);
  const steps = guardsJob.steps || [];
  const ciIndex = steps.findIndex((step) => typeof step.run === 'string' && step.run.trim() === 'npm ci');
  const guardsIndex = steps.findIndex(
    (step) => typeof step.run === 'string' && step.run.trim() === 'npm run guards'
  );
  assert.ok(ciIndex !== -1, 'the guards job does not run "npm ci"');
  assert.ok(ciIndex < guardsIndex, '"npm ci" must run before "npm run guards"');
});

test('the guards job does not invoke eslint directly as a CI step', () => {
  const doc = loadCiWorkflow();
  const guardsJob = findGuardsJob(doc);
  const eslintSteps = (guardsJob.steps || []).filter(
    (step) => typeof step.run === 'string' && /\beslint\b/.test(step.run)
  );
  assert.deepEqual(
    eslintSteps.map((step) => step.run),
    [],
    'the guards job invokes eslint directly; it should only run "npm run guards" (out of scope per #247)'
  );
});
