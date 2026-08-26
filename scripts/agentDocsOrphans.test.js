const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  README_FILENAME,
  listAgentDocFiles,
  readReadme,
  findOrphans,
  checkAgentDocsOrphans,
  AGENTS_DOCS_DIR,
} = require('./agentDocsOrphans');

// Issue #323: docs/agents/ grew from two orphaned docs at filing to four
// (agent-briefs.md, domain.md, issue-tracker.md, triage-labels.md, all
// reachable only through the gitignored, untracked CLAUDE.md) by the time
// this guard was written. A README-index-plus-guard is the fix: a tracked
// docs/agents/README.md becomes the routing table, and this check fails the
// build the next time a doc lands in the directory without a matching
// README entry, instead of the drift going unnoticed again.
//
// Per the maintainer's ruling on this ticket (posted on #323 after #247 and
// #234 unblocked it): this check joins the `guards` npm script directly —
// no scripts/ci/check-*.js runner, no `check:` wrapper, no .github/workflows
// edit. The shape to follow is scripts/eslintRuleScoping.test.js and
// scripts/jestTestMatch.test.js: a node:test file whose assertions read the
// real tree, run today by `npm run guards` (already a CI-required job), so
// nothing here waits on a maintainer-merged carve-out.

// findOrphans is pure (filenames + a string) so the "both directions" the
// guard needs to prove — it fails on an unreferenced doc, and adding the
// missing reference clears the same failure — is testable without touching
// a filesystem at all.

test('findOrphans: a doc mentioned anywhere in the README text is not an orphan', () => {
  const orphans = findOrphans(
    ['triage-labels.md'],
    'See `docs/agents/triage-labels.md` when mapping a triage role to a label.'
  );
  assert.deepEqual(orphans, []);
});

test('findOrphans: a doc added to the directory with no README entry is reported as an orphan', () => {
  const orphans = findOrphans(['refusal-tests.md'], 'This README does not mention it.');
  assert.deepEqual(orphans, ['refusal-tests.md']);
});

test('findOrphans: adding the missing reference clears the same orphan (proves the guard can go green, not just red)', () => {
  const readme = 'Read `docs/agents/refusal-tests.md` before writing a test for a refusal.';
  assert.deepEqual(findOrphans(['refusal-tests.md'], readme), []);
});

test('findOrphans: each doc is judged independently — one referenced, one not', () => {
  const readme = 'This only mentions `domain.md`.';
  assert.deepEqual(findOrphans(['domain.md', 'triage-labels.md'], readme), ['triage-labels.md']);
});

test('findOrphans: an empty or missing README treats every doc as an orphan', () => {
  assert.deepEqual(findOrphans(['a.md', 'b.md'], ''), ['a.md', 'b.md']);
  assert.deepEqual(findOrphans(['a.md', 'b.md'], null), ['a.md', 'b.md']);
});

test('findOrphans: no docs at all yields no orphans regardless of README content', () => {
  assert.deepEqual(findOrphans([], 'anything or nothing'), []);
});

// listAgentDocFiles / readReadme / checkAgentDocsOrphans touch the
// filesystem, so these are exercised against throwaway temp directories
// (never the real docs/agents/) to keep the fixture cases independent of
// whatever the real directory currently holds.

function makeAgentsDocsFixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-docs-')));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

test('listAgentDocFiles: lists every .md file except README.md, sorted', () => {
  const dir = makeAgentsDocsFixture({
    'triage-labels.md': '',
    'README.md': '',
    'domain.md': '',
    '.gitkeep': '',
  });
  assert.deepEqual(listAgentDocFiles(dir), ['domain.md', 'triage-labels.md']);
});

test('readReadme: returns null when no README.md exists in the directory', () => {
  const dir = makeAgentsDocsFixture({ 'domain.md': 'x' });
  assert.equal(readReadme(dir), null);
});

test('readReadme: returns the file contents when README.md exists', () => {
  const dir = makeAgentsDocsFixture({ [README_FILENAME]: 'hello world' });
  assert.equal(readReadme(dir), 'hello world');
});

test('checkAgentDocsOrphans: no README.md at all fails, naming every doc as an orphan', () => {
  const dir = makeAgentsDocsFixture({ 'domain.md': '', 'triage-labels.md': '' });
  const result = checkAgentDocsOrphans(dir);
  assert.equal(result.ok, false);
  assert.equal(result.missingReadme, true);
  assert.deepEqual(result.orphans.sort(), ['domain.md', 'triage-labels.md']);
});

test('checkAgentDocsOrphans: a README that indexes every doc passes', () => {
  const dir = makeAgentsDocsFixture({
    'domain.md': '',
    'triage-labels.md': '',
    [README_FILENAME]: 'See `domain.md` and `triage-labels.md`.',
  });
  const result = checkAgentDocsOrphans(dir);
  assert.equal(result.ok, true);
  assert.equal(result.missingReadme, false);
  assert.deepEqual(result.orphans, []);
});

test('checkAgentDocsOrphans: a doc the README does not mention fails, naming only that doc (both directions, on one fixture pair)', () => {
  const dir = makeAgentsDocsFixture({
    'domain.md': '',
    'triage-labels.md': '',
    [README_FILENAME]: 'See `domain.md` only.',
  });
  const failing = checkAgentDocsOrphans(dir);
  assert.equal(failing.ok, false);
  assert.deepEqual(failing.orphans, ['triage-labels.md']);

  // The exact same tree, with the missing reference added, goes green.
  fs.writeFileSync(
    path.join(dir, README_FILENAME),
    'See `domain.md` and `triage-labels.md`.'
  );
  const passing = checkAgentDocsOrphans(dir);
  assert.equal(passing.ok, true);
  assert.deepEqual(passing.orphans, []);
});

// This is the actual guard: it runs against the real, tracked
// docs/agents/ directory (the default AGENTS_DOCS_DIR), so a new .md file
// landing there with no docs/agents/README.md entry — the #323 failure mode
// — turns this test red, and it is wired into `npm run guards`.
test('the real docs/agents/ tree is fully indexed by its own README (#323)', () => {
  const result = checkAgentDocsOrphans();
  assert.equal(
    result.missingReadme,
    false,
    `docs/agents/${README_FILENAME} must exist and be tracked so discoverability does not depend on the gitignored CLAUDE.md`
  );
  assert.deepEqual(
    result.orphans,
    [],
    `docs/agents/ docs with no README.md entry: ${result.orphans.join(', ')}`
  );
});

test('AGENTS_DOCS_DIR resolves to the real, tracked docs/agents/ directory', () => {
  assert.ok(fs.existsSync(AGENTS_DOCS_DIR), `${AGENTS_DOCS_DIR} does not exist`);
  assert.equal(path.basename(AGENTS_DOCS_DIR), 'agents');
  assert.equal(path.basename(path.dirname(AGENTS_DOCS_DIR)), 'docs');
});
