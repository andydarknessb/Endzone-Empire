#!/usr/bin/env node
/**
 * Refuse to promote a commit whose `CI` workflow did not conclude `success`
 * (#2552, spec #2540 finding 11). deploy.yml runs this before any deploy hook.
 *
 * Why: on 2026-10-27 `8e698b64` was promoted at 15:53 UTC while its CI run was
 * still going; the run went red at 15:59. The `production` environment has no
 * protection rules, so nothing read CI status.
 *
 * Only a completed run with conclusion `success` passes. A failed, cancelled,
 * in-progress or missing run fails with a message naming the commit and the
 * run's state. When a commit has several runs the newest decides (a re-run
 * reuses the run id, so a stale red cannot linger behind a later green).
 * An API error fails too: passing on nothing is the bug this guards against.
 *
 * Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/repo node check-ci-passed.js --sha <sha>
 * The token needs `actions: read`.
 */

const CI_WORKFLOW_FILE = 'ci.yml';

function decide(runs, sha) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { ok: false, message: `Refusing to promote ${sha}: no CI run exists for this commit.` };
  }
  const latest = [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latest.status !== 'completed') {
    return {
      ok: false,
      message: `Refusing to promote ${sha}: its CI run is still running (${latest.status}), not finished. ${latest.html_url}`,
    };
  }
  if (latest.conclusion !== 'success') {
    return {
      ok: false,
      message: `Refusing to promote ${sha}: its CI run concluded ${latest.conclusion}. ${latest.html_url}`,
    };
  }
  return { ok: true, message: `CI passed for ${sha}. ${latest.html_url}` };
}

async function checkCommit({ sha, repo, token, fetch = (...args) => global.fetch(...args) }) {
  const url =
    `https://api.github.com/repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs` +
    `?head_sha=${encodeURIComponent(sha)}&per_page=100`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      return { ok: false, message: `Refusing to promote ${sha}: the CI run lookup answered HTTP ${res.status}.` };
    }
    const body = await res.json();
    return decide(body.workflow_runs, sha);
  } catch (err) {
    return { ok: false, message: `Refusing to promote ${sha}: the CI run lookup failed (${err.message}).` };
  }
}

// Returns an exit code so the `require.main` block below is the only place
// that touches process state.
async function main({ argv = process.argv.slice(2), env = process.env, fetch, io = console } = {}) {
  const at = argv.indexOf('--sha');
  const sha = at === -1 ? undefined : argv[at + 1];
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN;
  if (!sha || !repo || !token) {
    io.error('Usage: GH_TOKEN and GITHUB_REPOSITORY must be set, and --sha <sha> given.');
    return 1;
  }
  const result = await checkCommit({ sha, repo, token, fetch });
  (result.ok ? io.log : io.error)(result.message);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { decide, checkCommit, main };
