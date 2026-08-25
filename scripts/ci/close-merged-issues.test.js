const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseClosingReferences,
  planClosures,
  applyClosures,
  buildCloseComment,
  CLOSING_KEYWORDS,
  TARGET_BRANCH,
  ghApi,
  main,
} = require('./close-merged-issues');

const REPO = { owner: 'andydarknessb', repo: 'Endzone-Empire' };

// -----------------------------------------------------------------------
// parseClosingReferences(): the pure parser. Mirrors the keyword set and the
// three reference forms GitHub documents for native closing keywords, so an
// author who writes what GitHub would honour on the default branch gets the
// same closure here. Nothing more permissive, nothing less.
// -----------------------------------------------------------------------

test('parse: the nine keywords GitHub honours, in any case, each close', () => {
  assert.deepEqual(CLOSING_KEYWORDS, [
    'close', 'closes', 'closed',
    'fix', 'fixes', 'fixed',
    'resolve', 'resolves', 'resolved',
  ]);
  for (const [i, keyword] of CLOSING_KEYWORDS.entries()) {
    const n = 100 + i;
    for (const form of [keyword, keyword.toUpperCase(), keyword[0].toUpperCase() + keyword.slice(1)]) {
      const { issues } = parseClosingReferences(`${form} #${n}`, REPO);
      assert.deepEqual(issues, [n], `${form} #${n}`);
    }
  }
});

test('parse: a reference without a closing keyword is untouched', () => {
  const body = [
    'Refs #10',
    'See #11 and #12.',
    'Related to #13',
    'Part of #14',
    'the fix for #15 was closed out in #16',
  ].join('\n');
  assert.deepEqual(parseClosingReferences(body, REPO).issues, []);
});

test('parse: the keyword must be its own word', () => {
  // "unfixed #3" and "fixes#4" are not closing keywords to GitHub either.
  const { issues } = parseClosingReferences('unfixed #3, prefixes #5, fixes#4', REPO);
  assert.deepEqual(issues, []);
});

test('parse: only the first reference after a keyword counts, as on GitHub', () => {
  // GitHub's docs: to close several issues, write a keyword before each one.
  const { issues } = parseClosingReferences('Closes #1, #2, #3', REPO);
  assert.deepEqual(issues, [1]);
  const many = parseClosingReferences('Closes #1, closes #2, and fixes #3', REPO);
  assert.deepEqual(many.issues, [1, 2, 3]);
});

test('parse: an optional colon after the keyword is accepted', () => {
  assert.deepEqual(parseClosingReferences('Fixes: #42', REPO).issues, [42]);
});

test('parse: owner/repo#N and full issue URLs resolve to this repo when they match', () => {
  const body = [
    'Closes andydarknessb/Endzone-Empire#20',
    'Fixes https://github.com/andydarknessb/Endzone-Empire/issues/21',
    'Resolves ANDYDARKNESSB/endzone-empire#22',
  ].join('\n');
  assert.deepEqual(parseClosingReferences(body, REPO).issues, [20, 21, 22]);
});

test('parse: references to other repositories are reported, not closed', () => {
  const body = 'Closes other-org/other-repo#7 and fixes https://github.com/x/y/issues/8';
  const result = parseClosingReferences(body, REPO);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.foreign, ['other-org/other-repo#7', 'x/y#8']);
});

test('parse: duplicates collapse and the result is ascending', () => {
  const { issues } = parseClosingReferences('Fixes #9\nCloses #3\nResolves #9', REPO);
  assert.deepEqual(issues, [3, 9]);
});

test('parse: keywords inside code fences and inline code are not honoured', () => {
  const body = [
    'Documents the convention.',
    '',
    '```',
    'Closes #50',
    '```',
    '',
    'Write `Closes #51` on its own line. Closes #52',
  ].join('\n');
  assert.deepEqual(parseClosingReferences(body, REPO).issues, [52]);
});

test('parse: an empty or missing body closes nothing', () => {
  assert.deepEqual(parseClosingReferences('', REPO).issues, []);
  assert.deepEqual(parseClosingReferences(null, REPO).issues, []);
  assert.deepEqual(parseClosingReferences(undefined, REPO).issues, []);
});

// -----------------------------------------------------------------------
// planClosures(): reads the pull_request event payload and decides whether
// anything should happen. Every "no" carries a reason so the workflow log
// says why a merge closed nothing rather than leaving it to be inferred.
// -----------------------------------------------------------------------

function event({ merged = true, base = TARGET_BRANCH, body = 'Closes #5', number = 325, sha = 'abc1234def' } = {}) {
  return {
    action: 'closed',
    repository: { owner: { login: REPO.owner }, name: REPO.repo },
    pull_request: {
      number,
      merged,
      merge_commit_sha: sha,
      html_url: `https://github.com/${REPO.owner}/${REPO.repo}/pull/${number}`,
      base: { ref: base },
      body,
    },
  };
}

test('plan: a merged PR into integration with Closes #N plans to close N', () => {
  const plan = planClosures(event());
  assert.equal(plan.action, 'close');
  assert.deepEqual(plan.issues, [5]);
  assert.deepEqual(plan.pullRequest, {
    number: 325,
    mergeSha: 'abc1234def',
    url: 'https://github.com/andydarknessb/Endzone-Empire/pull/325',
    base: 'integration',
  });
});

test('plan: a PR closed without merging closes nothing', () => {
  const plan = planClosures(event({ merged: false }));
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /not merged/);
});

test('plan: a PR merged into any branch other than integration closes nothing', () => {
  // On main GitHub's native keywords already fire; acting there would
  // double-comment. Any other base is out of scope for this workflow.
  for (const base of ['main', 'feature/x']) {
    const plan = planClosures(event({ base }));
    assert.equal(plan.action, 'skip', base);
    assert.match(plan.reason, new RegExp(base));
  }
});

test('plan: a merged PR whose body has no closing keyword closes nothing', () => {
  const plan = planClosures(event({ body: 'Refs #5\n\nSee #6.' }));
  assert.equal(plan.action, 'skip');
  assert.match(plan.reason, /no closing keyword/);
});

test('plan: a malformed payload throws rather than silently skipping', () => {
  assert.throws(() => planClosures({}), /pull_request/);
  assert.throws(() => planClosures({ pull_request: {} }), /repository/);
});

// -----------------------------------------------------------------------
// applyClosures(): drives an injected API. The real adapter shells out to
// `gh api`; these tests substitute a fake so the exact request sequence per
// outcome is pinned, including the ones that must NOT write.
// -----------------------------------------------------------------------

function fakeApi(issuesByNumber) {
  const calls = [];
  return {
    calls,
    async getIssue(number) {
      calls.push(['getIssue', number]);
      const issue = issuesByNumber[number];
      if (!issue) {
        const err = new Error(`HTTP 404: Not Found`);
        err.status = 404;
        throw err;
      }
      return issue;
    },
    async comment(number, body) {
      calls.push(['comment', number, body]);
    },
    async close(number) {
      calls.push(['close', number]);
    },
  };
}

const PLAN = {
  action: 'close',
  issues: [5, 6, 7, 8],
  pullRequest: {
    number: 325,
    mergeSha: 'abc1234def',
    url: 'https://github.com/andydarknessb/Endzone-Empire/pull/325',
    base: 'integration',
  },
};

test('apply: an open issue gets a comment naming the PR and SHA, then is closed', async () => {
  const api = fakeApi({ 5: { number: 5, state: 'open' } });
  const results = await applyClosures({ ...PLAN, issues: [5] }, api);
  assert.deepEqual(results, [{ number: 5, outcome: 'closed' }]);
  assert.deepEqual(api.calls.map((c) => c.slice(0, 2)), [
    ['getIssue', 5],
    ['comment', 5],
    ['close', 5],
  ]);
  const commentBody = api.calls[1][2];
  assert.match(commentBody, /#325/);
  assert.match(commentBody, /abc1234def/);
  assert.match(commentBody, /integration/);
  assert.equal(commentBody, buildCloseComment(PLAN.pullRequest));
});

test('apply: an already-closed issue is a no-op, with no comment and no close', async () => {
  const api = fakeApi({ 6: { number: 6, state: 'closed' } });
  const results = await applyClosures({ ...PLAN, issues: [6] }, api);
  assert.deepEqual(results, [{ number: 6, outcome: 'already-closed' }]);
  assert.deepEqual(api.calls, [['getIssue', 6]]);
});

test('apply: a number that is a pull request, not an issue, is skipped untouched', async () => {
  const api = fakeApi({ 7: { number: 7, state: 'open', pull_request: { url: 'x' } } });
  const results = await applyClosures({ ...PLAN, issues: [7] }, api);
  assert.deepEqual(results, [{ number: 7, outcome: 'not-an-issue' }]);
  assert.deepEqual(api.calls, [['getIssue', 7]]);
});

test('apply: a number that does not exist is reported, not thrown', async () => {
  const api = fakeApi({});
  const results = await applyClosures({ ...PLAN, issues: [8] }, api);
  assert.deepEqual(results, [{ number: 8, outcome: 'missing' }]);
});

test('apply: an unexpected API failure on one issue is recorded and the rest still run', async () => {
  const api = fakeApi({ 5: { number: 5, state: 'open' }, 6: { number: 6, state: 'open' } });
  api.close = async (number) => {
    api.calls.push(['close', number]);
    if (number === 5) throw new Error('HTTP 502: Bad Gateway');
  };
  const results = await applyClosures({ ...PLAN, issues: [5, 6] }, api);
  assert.deepEqual(results, [
    { number: 5, outcome: 'error', error: 'HTTP 502: Bad Gateway' },
    { number: 6, outcome: 'closed' },
  ]);
});

test('apply: a skip plan performs no API calls', async () => {
  const api = fakeApi({ 5: { number: 5, state: 'open' } });
  const results = await applyClosures({ action: 'skip', reason: 'not merged' }, api);
  assert.deepEqual(results, []);
  assert.deepEqual(api.calls, []);
});

// -----------------------------------------------------------------------
// ghApi(): the one GitHub-touching adapter. Pins the exact `gh api`
// invocations, and that a 404 from `gh` becomes a `status: 404` error so
// applyClosures reports `missing` instead of `error`.
// -----------------------------------------------------------------------

function fakeExec(handler) {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return handler(args);
  };
  exec.calls = calls;
  return exec;
}

test('ghApi: getIssue/comment/close issue the documented REST calls through gh api', async () => {
  const exec = fakeExec(() => ({ stdout: '{"number":5,"state":"open"}' }));
  const api = ghApi(REPO, exec);
  assert.deepEqual(await api.getIssue(5), { number: 5, state: 'open' });
  await api.comment(5, 'hello');
  await api.close(5);
  const base = 'repos/andydarknessb/Endzone-Empire/issues';
  assert.deepEqual(exec.calls, [
    ['gh', 'api', `${base}/5`],
    ['gh', 'api', '--method', 'POST', `${base}/5/comments`, '-f', 'body=hello'],
    ['gh', 'api', '--method', 'PATCH', `${base}/5`, '-f', 'state=closed', '-f', 'state_reason=completed'],
  ]);
});

test('ghApi: a gh failure carrying "HTTP 404" surfaces as status 404', async () => {
  const exec = fakeExec(() => {
    const err = new Error('Command failed: gh api ...');
    err.stderr = 'gh: Not Found (HTTP 404)\n';
    err.stdout = '{"message":"Not Found"}';
    throw err;
  });
  const api = ghApi(REPO, exec);
  await assert.rejects(api.getIssue(999), (err) => err.status === 404 && /HTTP 404/.test(err.message));
  const results = await applyClosures({ ...PLAN, issues: [999] }, api);
  assert.deepEqual(results, [{ number: 999, outcome: 'missing' }]);
});

// -----------------------------------------------------------------------
// main(): event in, exit code out. The workflow's red/green is this value.
// -----------------------------------------------------------------------

test('main: closes the referenced issues and exits 0', async () => {
  const api = fakeApi({ 5: { number: 5, state: 'open' } });
  assert.equal(await main({ event: event(), api }), 0);
  assert.deepEqual(api.calls.map((c) => c[0]), ['getIssue', 'comment', 'close']);
});

test('main: a skip is exit 0 with no API calls', async () => {
  const api = fakeApi({ 5: { number: 5, state: 'open' } });
  assert.equal(await main({ event: event({ merged: false }), api }), 0);
  assert.deepEqual(api.calls, []);
});

test('main: any per-issue error makes the run exit 1 after finishing the rest', async () => {
  const api = fakeApi({ 5: { number: 5, state: 'open' }, 6: { number: 6, state: 'open' } });
  api.comment = async (number) => {
    if (number === 5) throw new Error('HTTP 502');
  };
  assert.equal(await main({ event: event({ body: 'Closes #5\nCloses #6' }), api }), 1);
  assert.deepEqual(api.calls.filter((c) => c[0] === 'close'), [['close', 6]]);
});

test('main: outside a pull_request job the missing payload is a thrown error, not a silent 0', async () => {
  await assert.rejects(main({ event: { action: 'closed' } }), /pull_request/);
});
