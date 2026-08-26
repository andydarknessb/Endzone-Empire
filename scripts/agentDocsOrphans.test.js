const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  README_FILENAME,
  listAgentDocFiles,
  readReadme,
  extractReferenceCandidates,
  extractDocsSection,
  extractDocsSectionMeta,
  findOrphans,
  findDeadReferences,
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

test('findOrphans: a doc named in a backtick code span is not an orphan', () => {
  const orphans = findOrphans(
    ['triage-labels.md'],
    'See `docs/agents/triage-labels.md` when mapping a triage role to a label.'
  );
  assert.deepEqual(orphans, []);
});

test('findOrphans: a doc named as a markdown link target is not an orphan, even without backticks', () => {
  const orphans = findOrphans(
    ['triage-labels.md'],
    'See [triage labels](docs/agents/triage-labels.md).'
  );
  assert.deepEqual(orphans, []);
});

test('findOrphans: a doc added to the directory with no README entry is reported as an orphan', () => {
  const orphans = findOrphans(['refusal-tests.md'], 'This README does not mention it.');
  assert.deepEqual(orphans, ['refusal-tests.md']);
});

// A second false-green, distinct from the bare-prose one below: an
// explanatory section of the README (e.g. one that documents this very
// guard's convention) will naturally quote a real filename in backticks as
// an ILLUSTRATION of the syntax, not as an index entry for that file. That
// quote is indistinguishable from a real entry by markdown form alone (both
// are backtick code spans), so form-only matching cannot rule it out.
// Restricting reference-extraction to the "## Docs" section — the actual
// index, and the one place this repo's own README convention puts entries
// — rules it out structurally: a mention above or below that heading never
// counts, no matter what markdown form it uses.
test('findOrphans: an illustrative example outside the "## Docs" section does not count, even in a code span naming a real file', () => {
  const readme = [
    '# Agent docs',
    '',
    '## How to add an entry',
    '',
    'Write a line like: See `docs/agents/triage-labels.md` for the label map.',
    '',
    '## Docs',
    '',
    '### Domain docs',
    'Read before exploring the codebase.',
    'See `docs/agents/domain.md`.',
  ].join('\n');

  // triage-labels.md is only named in the explanatory example ABOVE
  // "## Docs" — it has no real entry in the index — so it must still read
  // as an orphan. domain.md's entry is inside "## Docs" and counts.
  assert.deepEqual(findOrphans(['triage-labels.md', 'domain.md'], readme), ['triage-labels.md']);
});

test('findOrphans: falls back to scanning the whole file when the README has no "## Docs" heading', () => {
  const readme = 'See `domain.md` here — no headings at all in this README.';
  assert.deepEqual(findOrphans(['domain.md'], readme), []);
});

// extractDocsSection directly, isolated from the reference-matching it
// feeds — these pin the boundary itself (where the section starts and
// ends) rather than only its effect on findOrphans above.
test('extractDocsSection: returns only the text between "## Docs" and the next "## " heading', () => {
  const readme = ['# Title', '', '## Docs', '', 'inside', '', '## Later', '', 'outside'].join(
    '\n'
  );
  assert.equal(extractDocsSection(readme).trim(), 'inside');
});

test('extractDocsSection: runs to end of file when "## Docs" is the last heading', () => {
  const readme = ['# Title', '', 'intro', '', '## Docs', '', 'inside, to the end'].join('\n');
  assert.equal(extractDocsSection(readme).trim(), 'inside, to the end');
});

test('extractDocsSection: falls back to the whole string when no "## Docs" heading exists', () => {
  const readme = 'no headings here at all';
  assert.equal(extractDocsSection(readme), readme);
});

test('extractDocsSection: an empty or missing README returns an empty string, not a crash', () => {
  assert.equal(extractDocsSection(''), '');
  assert.equal(extractDocsSection(null), '');
});

// extractDocsSectionMeta exposes the same scoped text as extractDocsSection,
// plus whether the "## Docs" heading was actually found. Callers that only
// want the string (findOrphans, findDeadReferences) keep using
// extractDocsSection; the real-tree test uses the flag to print which of
// the two scopes was used instead of unconditionally claiming the
// "## Docs" section, and to announce the fallback when it fires (#411).
test('extractDocsSectionMeta: found is true and text matches extractDocsSection when the heading exists', () => {
  const readme = ['# Title', '', '## Docs', '', 'inside', '', '## Later', '', 'outside'].join(
    '\n'
  );
  const meta = extractDocsSectionMeta(readme);
  assert.equal(meta.found, true);
  assert.equal(meta.text, extractDocsSection(readme));
});

test('extractDocsSectionMeta: found is false and text is the whole file when the heading is missing', () => {
  const readme = 'no headings here at all';
  const meta = extractDocsSectionMeta(readme);
  assert.equal(meta.found, false);
  assert.equal(meta.text, extractDocsSection(readme));
});

test('extractDocsSectionMeta: found is false on an empty or missing README', () => {
  assert.equal(extractDocsSectionMeta('').found, false);
  assert.equal(extractDocsSectionMeta(null).found, false);
});

// This is the false-green this guard must not produce: a bare prose mention
// of a filename is not the same thing as indexing it. A doc that later
// explains this very guard is a natural thing to write, and prose about it
// ("the directory also has a stale-worktrees.md file") would satisfy a
// plain substring match without the README having routed a reader to it.
// Requiring a code span or a link target rules out the bare-prose case;
// see the module header for what it does NOT rule out.
test('findOrphans: a bare prose mention of a filename, with no code span and no link, is still an orphan', () => {
  const readme = 'This project also has a stale-worktrees.md file, for what it is worth.';
  assert.deepEqual(findOrphans(['stale-worktrees.md'], readme), ['stale-worktrees.md']);
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

// findDeadReferences is findOrphans' sibling check (#411): findOrphans only
// asserts every real doc is mentioned somewhere; it never asserts that a
// mentioned path actually resolves to a file, so a README entry naming a
// deleted or misspelled docs/agents/foo.md passed green before this. Only
// the docs/agents/<file>.md PATH FORM counts as "shaped like" a
// doc-in-this-directory reference (the bare-`<file>.md` form was dropped:
// it misclassified real, non-doc mentions like `CONTEXT.md`, which lives at
// the repo root, not in docs/agents/).
test('findDeadReferences: a "## Docs" entry naming a file that does not exist is reported', () => {
  const readme = [
    '## Docs',
    '',
    'See `docs/agents/does-not-exist.md` for details.',
  ].join('\n');
  assert.deepEqual(findDeadReferences(['domain.md'], readme), [
    'docs/agents/does-not-exist.md',
  ]);
});

test('findDeadReferences: correcting the reference to an existing file clears the same finding', () => {
  const readme = ['## Docs', '', 'See `docs/agents/domain.md` for details.'].join('\n');
  assert.deepEqual(findDeadReferences(['domain.md'], readme), []);
});

test('findDeadReferences: non-doc code spans in the "## Docs" section (a label name, a repo-root CONTEXT.md) are not reported', () => {
  const readme = [
    '## Docs',
    '',
    'Triage labels include `needs-triage` and `wontfix`.',
    'Domain docs point at `CONTEXT.md`, `docs/adr/`, and `.claude/worktrees/<name>`.',
  ].join('\n');
  assert.deepEqual(findDeadReferences(['domain.md'], readme), []);
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

  // Auditability: print what the extractor found, not just pass/fail, so an
  // over- or under-eager matcher shows up as a suspicious count rather than
  // as silence. A candidate count of 0 alongside 0 orphans would mean the
  // matcher itself is broken (nothing looked like a reference), which is a
  // different failure than "matched, and every doc had one".
  const candidateCount = extractReferenceCandidates(extractDocsSection(readReadme())).length;
  console.log(
    `docs/agents/: ${result.docFiles.length} doc(s), ${candidateCount} reference-shaped ` +
      `candidate(s) found in the "## Docs" section, ${result.orphans.length} orphan(s).`
  );

  assert.equal(
    result.missingReadme,
    false,
    `docs/agents/${README_FILENAME} is missing. Create it (tracked, not gitignored) indexing ` +
      'every doc in this directory — discoverability must not depend solely on the ' +
      'gitignored, per-checkout CLAUDE.md.'
  );
  assert.deepEqual(
    result.orphans,
    [],
    result.orphans.length
      ? `docs/agents/ has ${result.orphans.length} file(s) with no docs/agents/${README_FILENAME} ` +
        `entry: ${result.orphans.join(', ')}. Fix: add a "See \`docs/agents/<file>\`" line (with a ` +
        `one-line "when an agent needs it" description) to docs/agents/${README_FILENAME} for each ` +
        'file named above.'
      : undefined
  );
});

test('AGENTS_DOCS_DIR resolves to the real, tracked docs/agents/ directory', () => {
  assert.ok(fs.existsSync(AGENTS_DOCS_DIR), `${AGENTS_DOCS_DIR} does not exist`);
  assert.equal(path.basename(AGENTS_DOCS_DIR), 'agents');
  assert.equal(path.basename(path.dirname(AGENTS_DOCS_DIR)), 'docs');
});
