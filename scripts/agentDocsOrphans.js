'use strict';

// Issue #323: docs/agents/ has no guard against a doc landing there that
// nothing routes a reader to. Before this, the only map of the directory
// was the gitignored, per-checkout CLAUDE.md, so a new doc could sit
// unreferenced from everything tracked indefinitely — that happened twice
// (production-data-state.md, stale-worktrees.md at triage; refusal-tests.md
// and agent-briefs.md by the time the ticket was picked up).
//
// The fix: docs/agents/README.md becomes the tracked routing table, and
// this module decides whether every other .md file in the directory is
// mentioned somewhere in it. "Mentioned" is a plain substring check on the
// filename — the README's job is pointing a reader at the file, and a bare
// filename, a fenced `docs/agents/x.md` path, or a markdown link target all
// do that. Requiring one exact link syntax would fail this guard on a
// stylistic choice that loses no discoverability.

const fs = require('node:fs');
const path = require('node:path');

const AGENTS_DOCS_DIR = path.resolve(__dirname, '..', 'docs', 'agents');
const README_FILENAME = 'README.md';

// Every tracked doc in the directory except the README itself. Anything
// that isn't a .md file (a stray .gitkeep, a future subdirectory) is
// ignored rather than treated as a doc that needs indexing.
function listAgentDocFiles(dir = AGENTS_DOCS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((file) => file !== README_FILENAME && file.endsWith('.md'))
    .sort();
}

// Returns the README's text, or null when the directory has no
// docs/agents/README.md at all — the "checkout owners still depend on
// their own CLAUDE.md" failure mode, distinct from "the README exists but
// missed a doc".
function readReadme(dir = AGENTS_DOCS_DIR) {
  const readmePath = path.join(dir, README_FILENAME);
  if (!fs.existsSync(readmePath)) return null;
  return fs.readFileSync(readmePath, 'utf8');
}

// Extract the substrings of the README that look like a deliberate
// reference: a backtick code span (`docs/agents/x.md`) or a markdown link
// target (`[label](docs/agents/x.md)`). A doc is only counted as indexed
// when its filename appears inside one of these, not merely anywhere in
// the file's prose.
//
// Why this matters (raised on #323's review): a plain substring match over
// the whole file is a false-green risk. A doc that later explains this very
// guard is a natural thing to write, and prose describing it ("the
// directory also has a stale-worktrees.md file") would satisfy a bare
// substring check without the README having actually routed a reader to
// it. Restricting to code spans and link targets rules that bare-prose
// case out, because writers don't accidentally wrap a filename in
// backticks or link syntax the way they accidentally type it in a
// sentence.
//
// Markdown form alone still can't tell an index entry apart from an
// ILLUSTRATION that happens to use the same form — an explanatory section
// showing "an entry looks like `docs/agents/x.md`" is indistinguishable
// from a real entry by syntax, since both are backtick code spans. That is
// solved below by extractDocsSection instead: scope extraction to the
// "## Docs" heading, the one place this repo's own README convention puts
// real entries, so an illustration written elsewhere in the file never
// counts regardless of what markdown form it uses.
function extractReferenceCandidates(content) {
  const candidates = [];
  const backtickPattern = /`([^`]*)`/g;
  const linkTargetPattern = /\]\(([^)]*)\)/g;
  let match;
  while ((match = backtickPattern.exec(content)) !== null) {
    candidates.push(match[1]);
  }
  while ((match = linkTargetPattern.exec(content)) !== null) {
    candidates.push(match[1]);
  }
  return candidates;
}

// Scope reference-extraction to the body of the "## Docs" heading (this
// repo's README convention: an intro/meta section, then "## Docs" holding
// one entry per file, see docs/agents/README.md). Everything from the
// heading up to the next "## "-level heading (or end of file) is the
// index; everything outside it — an intro paragraph, a future "how this
// guard works" section — is meta text that must not count, even if it
// quotes a real filename in backticks as an example.
//
// Falls back to the WHOLE file when no "## Docs" heading is found, rather
// than treating every doc as an orphan. That keeps this guard from
// breaking on a differently-shaped README (or a hand-written test fixture
// with no headings at all); it only narrows what counts once the
// structure it's narrowing to actually exists.
function extractDocsSection(content) {
  const text = content || '';
  const headingPattern = /^##\s+Docs\s*$/m;
  const headingMatch = headingPattern.exec(text);
  if (!headingMatch) return text;

  const afterHeading = text.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingPattern = /^##\s+/m;
  const nextHeadingMatch = nextHeadingPattern.exec(afterHeading);
  return nextHeadingMatch ? afterHeading.slice(0, nextHeadingMatch.index) : afterHeading;
}

// A doc is an orphan when its filename does not appear inside any
// reference-shaped substring (see extractReferenceCandidates) of the
// README's "## Docs" section (see extractDocsSection). Pure function of
// (filenames, string) so both directions — the guard can fail on a missing
// reference, and the identical failure clears once the reference is added
// — are testable without touching a filesystem.
function findOrphans(docFiles, readmeContent) {
  const docsSection = extractDocsSection(readmeContent);
  const candidates = extractReferenceCandidates(docsSection);
  return docFiles.filter((doc) => !candidates.some((candidate) => candidate.includes(doc)));
}

// The whole check, for one docs/agents-shaped directory. Defaults to the
// real, tracked docs/agents/ directory this repo ships, which is what makes
// this the actual guard rather than only a demonstration of the logic.
function checkAgentDocsOrphans(dir = AGENTS_DOCS_DIR) {
  const docFiles = listAgentDocFiles(dir);
  const readmeContent = readReadme(dir);

  if (readmeContent === null) {
    return { ok: false, missingReadme: true, docFiles, orphans: docFiles.slice() };
  }

  const orphans = findOrphans(docFiles, readmeContent);
  return { ok: orphans.length === 0, missingReadme: false, docFiles, orphans };
}

module.exports = {
  AGENTS_DOCS_DIR,
  README_FILENAME,
  listAgentDocFiles,
  readReadme,
  extractReferenceCandidates,
  extractDocsSection,
  findOrphans,
  checkAgentDocsOrphans,
};
