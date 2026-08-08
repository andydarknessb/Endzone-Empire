'use strict';

/**
 * Section 10.2a's LOCATOR check: extract every `file.js:NNN` citation in the
 * spec and assert the named location still resolves at or near that line.
 * Runs on every re-anchor; this scripted form lands at the B3 re-cut per
 * 10.2a's bar paragraph.
 *
 * What "resolves" means here, mechanically:
 *   1. the cited file must resolve to exactly one tracked source file
 *      (basenames are matched against an index of `scripts/` and `server/`;
 *      a citation carrying path segments is matched by suffix);
 *   2. the cited line (or range end) must lie within the file;
 *   3. when the citation is immediately preceded by a backticked identifier
 *      (the spec's dominant form, e.g. "`buildPriorGames` (`file.js:188`)"),
 *      that identifier must appear within WINDOW lines of the cited line -
 *      this is what catches a citation that drifted whole functions away,
 *      the revision-24 ten-stale-locators class.
 *
 * Bare `:NNN` continuation citations (a line number with no file, riding a
 * previous citation's file) are outside this check's specified form and are
 * not extracted - the spec's own wording is "every `file.js:NNN` citation".
 *
 * Per 10.2a, an instrument is validated against a known answer before being
 * trusted; this module exports its pieces so the test suite can drive it
 * over fixtures with planted stale locators and assert they are reported.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DOC = 'backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md';
const SEARCH_ROOTS = ['scripts', 'server'];
const WINDOW = 30;

function walkJsFiles(root, out) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function indexJsFiles(repoRoot) {
  const files = [];
  for (const root of SEARCH_ROOTS) walkJsFiles(path.join(repoRoot, root), files);
  // Top-level scripts (`backtest-entrypoint.js`) live beside the roots, not
  // under them; scan the repo root itself non-recursively.
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch { /* an unreadable root reports every citation unresolved, which is loud enough */ }
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(repoRoot, entry.name));
  }
  const byBasename = new Map();
  for (const file of files) {
    const base = path.basename(file);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(file);
  }
  return { files, byBasename };
}

/**
 * Every `file.js:NNN[-MMM]` citation, with the immediately preceding
 * backticked identifier when one exists within 80 characters (crossing at
 * most punctuation/whitespace - "`deriveEvidence` (`sweepEvidence.js:419`)").
 */
function extractCitations(text) {
  const citations = [];
  const pattern = /([A-Za-z0-9_.\/\\-]*[A-Za-z0-9_-]\.js):(\d+)(?:-(\d+))?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const identifierMatch = /`([A-Za-z_$][A-Za-z0-9_$]*)`[\s('`]*$/.exec(before);
    citations.push({
      file: match[1].replace(/\\/g, '/'),
      startLine: Number(match[2]),
      endLine: match[3] === undefined ? Number(match[2]) : Number(match[3]),
      identifier: identifierMatch ? identifierMatch[1] : null,
      index: match.index,
    });
  }
  return citations;
}

function resolveFile(citation, index) {
  const base = path.basename(citation.file);
  const candidates = index.byBasename.get(base) || [];
  if (citation.file.includes('/')) {
    const suffix = citation.file.split('/').join(path.sep);
    const bySuffix = candidates.filter((candidate) => candidate.endsWith(suffix));
    return bySuffix.length > 0 ? bySuffix : candidates;
  }
  return candidates;
}

function checkCitation(citation, index, fileLineCache) {
  const candidates = resolveFile(citation, index);
  if (candidates.length === 0) {
    return { ...citation, status: 'unresolved-file', detail: `no tracked file matches ${citation.file}` };
  }
  // A citation is OK if ANY resolved candidate satisfies it; ambiguity plus
  // universal failure reports the first candidate's reason.
  let firstFailure = null;
  for (const candidate of candidates) {
    if (!fileLineCache.has(candidate)) {
      fileLineCache.set(candidate, fs.readFileSync(candidate, 'utf8').split('\n'));
    }
    const lines = fileLineCache.get(candidate);
    if (citation.endLine > lines.length) {
      if (!firstFailure) firstFailure = { ...citation, status: 'out-of-range', detail: `${candidate} has ${lines.length} lines, citation ends at ${citation.endLine}` };
      continue;
    }
    if (citation.identifier) {
      const lo = Math.max(0, citation.startLine - 1 - WINDOW);
      const hi = Math.min(lines.length, citation.endLine + WINDOW);
      const found = lines.slice(lo, hi).some((line) => line.includes(citation.identifier));
      if (!found) {
        if (!firstFailure) firstFailure = { ...citation, status: 'symbol-missing', detail: `\`${citation.identifier}\` does not appear within ${WINDOW} lines of ${candidate}:${citation.startLine}` };
        continue;
      }
    }
    return { ...citation, status: 'ok', resolved: candidate };
  }
  return firstFailure;
}

function checkLocators({ repoRoot = process.cwd(), docPath, docText } = {}) {
  const text = docText !== undefined ? docText : fs.readFileSync(docPath || path.join(repoRoot, DEFAULT_DOC), 'utf8');
  const index = indexJsFiles(repoRoot);
  const fileLineCache = new Map();
  const results = extractCitations(text).map((citation) => checkCitation(citation, index, fileLineCache));
  const failures = results.filter((result) => result.status !== 'ok');
  return { total: results.length, failures, ok: failures.length === 0 };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--doc') args.docPath = argv[++i];
    else if (token === '--repo-root') args.repoRoot = argv[++i];
    else throw new Error(`check-locators: unknown argument ${token}`);
  }
  const result = checkLocators(args);
  if (result.total === 0) {
    // A document with zero extracted citations is a broken extraction, not a
    // clean document - the spec cites code constantly.
    console.error('check-locators: extracted ZERO citations - the extraction is broken, not the document clean');
    return 1;
  }
  console.log(JSON.stringify({
    total: result.total,
    failureCount: result.failures.length,
    failures: result.failures.map(({ file, startLine, endLine, identifier, status, detail }) => ({ file, startLine, endLine, identifier, status, detail })),
  }, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)) || 0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { DEFAULT_DOC, WINDOW, indexJsFiles, extractCitations, resolveFile, checkLocators, main };
