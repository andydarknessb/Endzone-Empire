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

// A doc is an orphan when its filename does not appear anywhere in the
// README's text. Pure function of (filenames, string) so both directions —
// the guard can fail on a missing reference, and the identical failure
// clears once the reference is added — are testable without touching a
// filesystem.
function findOrphans(docFiles, readmeContent) {
  const content = readmeContent || '';
  return docFiles.filter((doc) => !content.includes(doc));
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
  findOrphans,
  checkAgentDocsOrphans,
};
