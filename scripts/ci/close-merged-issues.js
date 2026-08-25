#!/usr/bin/env node
/**
 * Close the issues a merged pull request says it closes (#330).
 *
 * Why this exists: GitHub only honours closing keywords (`Closes #N`,
 * `Fixes #N`, ...) when a pull request merges into the repository's DEFAULT
 * branch. This repository's default branch is `main`, but every PR merges
 * into `integration`; promotion to `main` is a separate, human step. So
 * every closing keyword written here has been inert, and the issues it
 * named stayed open with their work fully merged -- and an open issue is
 * offered as available work. Six such issues accumulated before the shared
 * cause was found (see #330 for the list and the ruling).
 *
 * What it does: `.github/workflows/close-merged-issues.yml` runs this on
 * `pull_request: closed`. For a PR that MERGED into `integration`, the PR
 * body is parsed for the same keyword set and reference forms GitHub
 * documents for native closing keywords, and each referenced issue in this
 * repository is closed with a comment naming the PR and its merge SHA.
 *
 * Deliberate limits, each pinned by a test in close-merged-issues.test.js:
 *
 * - Same keyword set as GitHub (close/closes/closed, fix/fixes/fixed,
 *   resolve/resolves/resolved, any case), same three reference forms
 *   (`#N`, `owner/repo#N`, a full issue URL), and GitHub's own one-reference-
 *   per-keyword rule: `Closes #1, #2` closes only #1. Authors write exactly
 *   what they would write for the default branch; there is no dialect.
 * - Only the PR BODY is read, not commit messages, and not PR comments.
 * - Keywords inside fenced code blocks or inline code are ignored, so a PR
 *   that documents the convention (this one) does not trigger it.
 * - A merge into any branch other than `integration` is skipped. On `main`
 *   GitHub's native keywords already fire, and acting there too would leave
 *   a duplicate comment on every promoted issue.
 * - A closed-unmerged PR is skipped. An already-closed issue is a no-op
 *   (no comment). A reference that is a pull request, or does not exist, is
 *   reported and left alone. References to other repositories are logged
 *   and not acted on: the workflow token cannot write there anyway.
 * - A failure on one issue does not stop the others; it is recorded and
 *   the process exits non-zero at the end so the workflow run shows red.
 *
 * Shape: three pure-ish layers behind one small interface so the behaviour
 * is testable without GitHub. `parseClosingReferences` (text -> numbers),
 * `planClosures` (event payload -> what to do and why), `applyClosures`
 * (plan + injected API -> outcomes). `ghApi()` is the only piece that talks
 * to GitHub, via the `gh` CLI that every GitHub-hosted runner ships with,
 * and `main()` is the only caller that touches process state.
 */
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const TARGET_BRANCH = 'integration';

// The exact keyword list from GitHub's "Linking a pull request to an issue"
// documentation. Order here is only for readability.
const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
];

// keyword, optional colon, whitespace, then exactly one reference in one of
// GitHub's three forms. The reference must follow the keyword directly:
// "Closes #1, #2" matches once, as it does on GitHub.
const REFERENCE_PATTERN = new RegExp(
  String.raw`\b(?:${CLOSING_KEYWORDS.join('|')})\b:?\s+` +
    String.raw`(?:` +
    String.raw`https?://github\.com/([\w.-]+)/([\w.-]+)/issues/(\d+)` + // 1,2,3: URL
    String.raw`|(?:([\w.-]+)/([\w.-]+))?#(\d+)` + // 4,5,6: [owner/repo]#N
    String.raw`)(?![\w-])`,
  'gi',
);

// Remove fenced code blocks and inline code spans. A closing keyword quoted
// as text ("write `Closes #N`") is not a closure.
function stripCode(body) {
  return body
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '')
    .replace(/`+[^`\n]*`+/g, '');
}

function parseClosingReferences(body, { owner, repo }) {
  const issues = new Set();
  const foreign = [];
  if (typeof body !== 'string' || body.length === 0) {
    return { issues: [], foreign };
  }
  const text = stripCode(body);
  const here = `${owner}/${repo}`.toLowerCase();
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const [, urlOwner, urlRepo, urlNumber, refOwner, refRepo, refNumber] = match;
    const number = Number(urlNumber ?? refNumber);
    const target = urlOwner ? `${urlOwner}/${urlRepo}` : refOwner ? `${refOwner}/${refRepo}` : here;
    if (target.toLowerCase() === here) {
      issues.add(number);
    } else {
      foreign.push(`${target}#${number}`);
    }
  }
  return { issues: [...issues].sort((a, b) => a - b), foreign };
}

function planClosures(event) {
  const pr = event && event.pull_request;
  if (!pr) {
    throw new Error('event payload has no pull_request; this script runs on pull_request events only');
  }
  const repository = event.repository;
  if (!repository || !repository.owner || !repository.owner.login || !repository.name) {
    throw new Error('event payload has no repository owner/name');
  }
  const repo = { owner: repository.owner.login, repo: repository.name };
  const pullRequest = {
    number: pr.number,
    mergeSha: pr.merge_commit_sha,
    url: pr.html_url,
    base: pr.base && pr.base.ref,
  };

  if (!pr.merged) {
    return { action: 'skip', reason: `PR #${pr.number} was closed but not merged`, pullRequest };
  }
  if (pullRequest.base !== TARGET_BRANCH) {
    return {
      action: 'skip',
      reason: `PR #${pr.number} merged into ${pullRequest.base}, not ${TARGET_BRANCH}; only ${TARGET_BRANCH} merges are handled here`,
      pullRequest,
    };
  }
  const { issues, foreign } = parseClosingReferences(pr.body, repo);
  if (issues.length === 0) {
    return {
      action: 'skip',
      reason: `PR #${pr.number} body has no closing keyword referencing an issue in this repository`,
      pullRequest,
      foreign,
    };
  }
  return { action: 'close', issues, foreign, pullRequest };
}

function buildCloseComment({ number, mergeSha, url, base }) {
  return [
    `Closed by #${number}, merged into \`${base}\` at ${mergeSha}.`,
    '',
    `Closing keywords only fire natively on the default branch; this repository merges into \`${base}\`, so ` +
      'the `close-merged-issues` workflow closed this on the merged PR\'s behalf (#330). ' +
      `PR: ${url}`,
  ].join('\n');
}

async function applyClosures(plan, api) {
  if (plan.action !== 'close') {
    return [];
  }
  const results = [];
  const commentBody = buildCloseComment(plan.pullRequest);
  for (const number of plan.issues) {
    try {
      let issue;
      try {
        issue = await api.getIssue(number);
      } catch (err) {
        if (err && (err.status === 404 || /HTTP 404/.test(err.message))) {
          results.push({ number, outcome: 'missing' });
          continue;
        }
        throw err;
      }
      if (issue.pull_request) {
        results.push({ number, outcome: 'not-an-issue' });
        continue;
      }
      if (issue.state === 'closed') {
        results.push({ number, outcome: 'already-closed' });
        continue;
      }
      await api.comment(number, commentBody);
      await api.close(number);
      results.push({ number, outcome: 'closed' });
    } catch (err) {
      results.push({ number, outcome: 'error', error: err.message });
    }
  }
  return results;
}

// The only GitHub-touching code. `gh` is preinstalled on GitHub-hosted
// runners and reads GH_TOKEN from the environment, so this needs no extra
// dependency and no token plumbing beyond the workflow's `env:`.
function ghApi({ owner, repo }, exec = execFileAsync) {
  const base = `repos/${owner}/${repo}/issues`;
  async function gh(args) {
    try {
      const { stdout } = await exec('gh', ['api', ...args], { maxBuffer: 10 * 1024 * 1024 });
      return stdout ? JSON.parse(stdout) : null;
    } catch (err) {
      const detail = `${err.stderr || ''}${err.stdout || ''}${err.message || ''}`;
      const wrapped = new Error(detail.trim());
      const status = /HTTP (\d{3})/.exec(detail);
      if (status) wrapped.status = Number(status[1]);
      throw wrapped;
    }
  }
  return {
    getIssue: (number) => gh([`${base}/${number}`]),
    comment: (number, body) => gh(['--method', 'POST', `${base}/${number}/comments`, '-f', `body=${body}`]),
    close: (number) =>
      gh(['--method', 'PATCH', `${base}/${number}`, '-f', 'state=closed', '-f', 'state_reason=completed']),
  };
}

function readEvent(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is not set; this script runs inside a GitHub Actions pull_request job');
  }
  return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
}

// Returns an exit code rather than setting it, so the `require.main` block
// below is the only place process state is touched.
async function main({ event = readEvent(), api } = {}) {
  const plan = planClosures(event);
  for (const ref of plan.foreign || []) {
    console.log(`ignoring ${ref}: this workflow only closes issues in this repository`);
  }
  if (plan.action === 'skip') {
    console.log(`nothing to close: ${plan.reason}`);
    return 0;
  }
  const { owner, name } = { owner: event.repository.owner.login, name: event.repository.name };
  const results = await applyClosures(plan, api || ghApi({ owner, repo: name }));
  let failed = 0;
  for (const result of results) {
    const line = `#${result.number}: ${result.outcome}${result.error ? ` (${result.error})` : ''}`;
    if (result.outcome === 'error') {
      failed += 1;
      console.error(line);
    } else {
      console.log(line);
    }
  }
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (err) => {
      console.error(err.message);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  CLOSING_KEYWORDS,
  TARGET_BRANCH,
  parseClosingReferences,
  planClosures,
  buildCloseComment,
  applyClosures,
  ghApi,
  main,
};
