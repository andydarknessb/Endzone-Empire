const test = require('node:test');
const assert = require('node:assert/strict');
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
