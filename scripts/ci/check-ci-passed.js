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
 * With `--branch <name>` it also refuses unless that branch's tip is `--sha`
 * (#2596): the Render and Netlify hooks build the branch tip, so a queued
 * dispatch, or one from another branch, would otherwise ship an unchecked commit.
 *
 * Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/repo node check-ci-passed.js --sha <sha> [--branch <name>]
 * The token needs `actions: read`, and `contents: read` for --branch.
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

// The Render and Netlify hooks build the provider branch tip, not the dispatched
// sha, so refuse unless `branch` still points at `sha` (#2596).
async function checkTip({ sha, branch, repo, token, fetch }) {
  const url = `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      return { ok: false, message: `Refusing to promote ${sha}: the ${branch} tip lookup answered HTTP ${res.status}.` };
    }
    const tip = (await res.json()).object?.sha;
    if (!tip) {
      return { ok: false, message: `Refusing to promote ${sha}: the ${branch} ref response was malformed (no object.sha).` };
    }
    if (tip !== sha) {
      return {
        ok: false,
        message: `Refusing to promote ${sha}: ${branch} is at ${tip}, and the deploy hooks build the ${branch} tip.`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Refusing to promote ${sha}: the ${branch} tip lookup failed (${err.message}).` };
  }
}

async function checkCommit({ sha, branch, repo, token, fetch = (...args) => global.fetch(...args) }) {
  if (branch) {
    const tip = await checkTip({ sha, branch, repo, token, fetch });
    if (!tip.ok) return tip;
  }
  const url =
    `https://api.github.com/repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs` +
    // event=push: a pull_request run tested the merge ref, not this commit alone.
    `?head_sha=${encodeURIComponent(sha)}&event=push&per_page=100`;
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
  const branchAt = argv.indexOf('--branch');
  const branch = branchAt === -1 ? undefined : argv[branchAt + 1];
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN;
  if (!sha || !repo || !token || (branchAt !== -1 && !branch)) {
    io.error('Usage: GH_TOKEN and GITHUB_REPOSITORY must be set, and --sha <sha> given (--branch <name> optional).');
    return 1;
  }
  const result = await checkCommit({ sha, branch, repo, token, fetch });
  (result.ok ? io.log : io.error)(result.message);
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { decide, checkCommit, main };
