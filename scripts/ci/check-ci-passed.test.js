const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decide, checkCommit, main } = require('./check-ci-passed');

const SHA = '8e698b64aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const run = (status, conclusion, createdAt = '2026-10-27T15:50:00Z', id = 1) => ({
  id,
  status,
  conclusion,
  created_at: createdAt,
  html_url: `https://github.com/o/r/actions/runs/${id}`,
});

// ---------------------------------------------------------------------------
// decide: only a completed run with conclusion success passes.
// ---------------------------------------------------------------------------
test('decide passes a completed successful run', () => {
  const result = decide([run('completed', 'success')], SHA);
  assert.equal(result.ok, true);
});

test('decide refuses a failed run and names the commit and the state', () => {
  const result = decide([run('completed', 'failure')], SHA);
  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(SHA));
  assert.match(result.message, /failure/);
});

test('decide refuses a run that is still in progress (the 8e698b64 case)', () => {
  for (const status of ['in_progress', 'queued', 'waiting']) {
    const result = decide([run(status, null)], SHA);
    assert.equal(result.ok, false, status);
    assert.match(result.message, new RegExp(SHA));
    assert.match(result.message, /still running|not finished/i);
  }
});

test('decide refuses a commit with no CI run at all', () => {
  for (const runs of [[], undefined]) {
    const result = decide(runs, SHA);
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(SHA));
    assert.match(result.message, /no CI run/i);
  }
});

test('decide refuses every non-success conclusion', () => {
  for (const conclusion of ['cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'startup_failure', null]) {
    assert.equal(decide([run('completed', conclusion)], SHA).ok, false, String(conclusion));
  }
});

test('decide judges the newest run: a later green run clears an earlier red one, and the reverse does not', () => {
  const red = run('completed', 'failure', '2026-10-27T15:00:00Z', 1);
  const green = run('completed', 'success', '2026-10-27T16:00:00Z', 2);
  assert.equal(decide([red, green], SHA).ok, true);
  assert.equal(decide([green, red], SHA).ok, true);
  const greenOld = run('completed', 'success', '2026-10-27T15:00:00Z', 1);
  const redNew = run('completed', 'failure', '2026-10-27T16:00:00Z', 2);
  assert.equal(decide([greenOld, redNew], SHA).ok, false);
});

// ---------------------------------------------------------------------------
// checkCommit: the API call. fetch is injected.
// ---------------------------------------------------------------------------
const okFetch = (runs) => async (url, init) => {
  okFetch.last = { url: String(url), init };
  return { ok: true, status: 200, async json() { return { workflow_runs: runs }; } };
};

test('checkCommit asks the CI workflow for runs of exactly this sha', async () => {
  const fetch = okFetch([run('completed', 'success')]);
  const result = await checkCommit({ sha: SHA, repo: 'o/r', token: 't0k', fetch });
  assert.equal(result.ok, true);
  const { url, init } = okFetch.last;
  assert.match(url, /\/repos\/o\/r\/actions\/workflows\/ci\.yml\/runs\?/);
  assert.match(url, new RegExp(`head_sha=${SHA}`));
  assert.match(url, /event=push/);
  assert.equal(init.headers.authorization, 'Bearer t0k');
});

test('checkCommit refuses when the API answers an error, rather than passing on nothing', async () => {
  const fetch = async () => ({ ok: false, status: 403, async json() { return {}; } });
  const result = await checkCommit({ sha: SHA, repo: 'o/r', token: 't', fetch });
  assert.equal(result.ok, false);
  assert.match(result.message, /403/);
});

test('checkCommit refuses when the request throws', async () => {
  const fetch = async () => { throw new Error('network down'); };
  const result = await checkCommit({ sha: SHA, repo: 'o/r', token: 't', fetch });
  assert.equal(result.ok, false);
  assert.match(result.message, /network down/);
});

// ---------------------------------------------------------------------------
// --branch (#2596): the hooks build the provider branch tip, so refuse unless
// that tip is the checked sha.
// ---------------------------------------------------------------------------
const TIP = '1234567abbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// Routes the ref lookup and the CI run lookup; `ref` is the git/ref answer.
const routedFetch = (ref) => async (url) => {
  routedFetch.urls.push(String(url));
  if (String(url).includes('/git/ref/')) return ref();
  return { ok: true, status: 200, async json() { return { workflow_runs: [run('completed', 'success')] }; } };
};
routedFetch.urls = [];
const refAt = (sha) => () => ({ ok: true, status: 200, async json() { return { object: { sha } }; } });

test('checkCommit with a branch passes when the branch tip is the checked sha', async () => {
  routedFetch.urls = [];
  const result = await checkCommit({ sha: SHA, branch: 'main', repo: 'o/r', token: 't', fetch: routedFetch(refAt(SHA)) });
  assert.equal(result.ok, true);
  assert.ok(routedFetch.urls.some((u) => u.endsWith('/repos/o/r/git/ref/heads/main')), routedFetch.urls.join('\n'));
});

test('checkCommit with a branch refuses a different tip and names the branch, the tip and the sha', async () => {
  const result = await checkCommit({ sha: SHA, branch: 'main', repo: 'o/r', token: 't', fetch: routedFetch(refAt(TIP)) });
  assert.equal(result.ok, false);
  assert.match(result.message, /main/);
  assert.match(result.message, new RegExp(TIP));
  assert.match(result.message, new RegExp(SHA));
});

test('checkCommit with a branch refuses when the ref lookup answers an error or throws', async () => {
  const httpError = routedFetch(() => ({ ok: false, status: 404, async json() { return {}; } }));
  const failed = await checkCommit({ sha: SHA, branch: 'main', repo: 'o/r', token: 't', fetch: httpError });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /404/);
  const thrown = routedFetch(() => { throw new Error('ref down'); });
  const threw = await checkCommit({ sha: SHA, branch: 'main', repo: 'o/r', token: 't', fetch: thrown });
  assert.equal(threw.ok, false);
  assert.match(threw.message, /ref down/);
});

test('checkCommit with a branch refuses a ref response with no object.sha, naming it malformed', async () => {
  const empty = routedFetch(() => ({ ok: true, status: 200, async json() { return {}; } }));
  const result = await checkCommit({ sha: SHA, branch: 'main', repo: 'o/r', token: 't', fetch: empty });
  assert.equal(result.ok, false);
  assert.match(result.message, /malformed/);
  assert.doesNotMatch(result.message, /undefined/);
});

test('checkCommit with a branch still refuses a red CI run, even when the tip matches', async () => {
  const fetch = async (url) =>
    String(url).includes('/git/ref/')
      ? refAt(SHA)()
      : { ok: true, status: 200, async json() { return { workflow_runs: [run('completed', 'failure')] }; } };
  const result = await checkCommit({ sha: SHA, branch: 'main', repo: 'o/r', token: 't', fetch });
  assert.equal(result.ok, false);
});

test('main passes --branch through to the tip check', async () => {
  const io = { log() {}, error() {} };
  const env = { GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
  assert.equal(await main({ argv: ['--sha', SHA, '--branch', 'main'], env, fetch: routedFetch(refAt(SHA)), io }), 0);
  assert.equal(await main({ argv: ['--sha', SHA, '--branch', 'main'], env, fetch: routedFetch(refAt(TIP)), io }), 1);
  // Without --branch no ref is read, as before.
  routedFetch.urls = [];
  assert.equal(await main({ argv: ['--sha', SHA], env, fetch: routedFetch(refAt(TIP)), io }), 0);
  assert.equal(routedFetch.urls.some((u) => u.includes('/git/ref/')), false);
});

test('main exits 1 when --branch has no value', async () => {
  const io = { log() {}, error() {} };
  const env = { GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
  assert.equal(await main({ argv: ['--sha', SHA, '--branch'], env, fetch: routedFetch(refAt(SHA)), io }), 1);
});

// ---------------------------------------------------------------------------
// deploy.yml order pin (#2596): read as text; no YAML parser in scripts/.
// ---------------------------------------------------------------------------
const deployLines = fs
  .readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy.yml'), 'utf8')
  .split(/\r?\n/);
const lineOf = (re) => deployLines.findIndex((l) => re.test(l));
const GATE_STEP = /^\s*- name: Require a passing CI run for the promoted commit\s*$/;

test('deploy.yml: the gate step follows setup-node and precedes every hook POST', () => {
  const setupNode = lineOf(/uses: actions\/setup-node@/);
  const gate = lineOf(GATE_STEP);
  const posts = deployLines.flatMap((l, i) => (l.includes('--request POST') ? [i] : []));
  assert.ok(setupNode >= 0 && gate >= 0, 'setup-node and the gate step must both exist');
  assert.equal(posts.length, 3, 'the Render API, Netlify and Render worker hooks');
  assert.ok(setupNode < gate, 'setup-node must run before the gate');
  for (const post of posts) assert.ok(gate < post, `gate must precede the POST at line ${post + 1}`);
});

test('deploy.yml: the gate step and every hook step check the main tip right before their POST', () => {
  const stepStarts = deployLines.flatMap((l, i) => (/^ {6}- /.test(l) ? [i] : []));
  const stepOf = (i) => {
    const start = Math.max(...stepStarts.filter((s) => s <= i));
    const end = stepStarts.find((s) => s > i) ?? deployLines.length;
    return deployLines.slice(start, end);
  };
  // Anchored so a commented-out or `true ||` line does not count.
  const check = /^\s*(run: )?node scripts\/ci\/check-ci-passed\.js --sha "\$GITHUB_SHA" --branch main\s*$/;
  const gateStep = stepOf(lineOf(GATE_STEP));
  assert.ok(gateStep.some((l) => check.test(l)), 'the gate step passes --branch main');
  assert.ok(!gateStep.some((l) => /^\s*(if|continue-on-error):/.test(l)), 'the gate step always runs and cannot be waved through');
  const posts = deployLines.flatMap((l, i) => (l.includes('--request POST') ? [i] : []));
  for (const post of posts) {
    const step = stepOf(post);
    const checkAt = step.findIndex((l) => check.test(l));
    assert.ok(checkAt >= 0, `the step with the POST at line ${post + 1} runs the tip check`);
    // Anchored: the line directly before the POST, so no wait or setup line
    // can push the check earlier and leave the tip stale by the time it fires.
    assert.equal(
      checkAt,
      step.findIndex((l) => l.includes('--request POST')) - 1,
      `the tip check must be the line directly before the POST at line ${post + 1}`,
    );
    assert.ok(step.some((l) => /GH_TOKEN: \$\{\{ github\.token \}\}/.test(l)), 'the step passes GH_TOKEN');
  }
});

// ---------------------------------------------------------------------------
// main: argv/env wiring and exit code.
// ---------------------------------------------------------------------------
test('main exits 0 on success and 1 on failure, printing the message', async () => {
  const lines = [];
  const io = { log: (l) => lines.push(['log', l]), error: (l) => lines.push(['error', l]) };
  const env = { GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
  assert.equal(await main({ argv: ['--sha', SHA], env, fetch: okFetch([run('completed', 'success')]), io }), 0);
  assert.equal(await main({ argv: ['--sha', SHA], env, fetch: okFetch([run('completed', 'failure')]), io }), 1);
  assert.equal(lines[0][0], 'log');
  assert.equal(lines[1][0], 'error');
});

test('main exits 1 when --sha, GITHUB_REPOSITORY or GH_TOKEN is missing', async () => {
  const io = { log() {}, error() {} };
  const fetch = okFetch([run('completed', 'success')]);
  const env = { GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
  assert.equal(await main({ argv: [], env, fetch, io }), 1);
  assert.equal(await main({ argv: ['--sha', SHA], env: { GH_TOKEN: 't' }, fetch, io }), 1);
  assert.equal(await main({ argv: ['--sha', SHA], env: { GITHUB_REPOSITORY: 'o/r' }, fetch, io }), 1);
});
