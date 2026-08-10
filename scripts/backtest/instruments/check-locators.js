'use strict';

/**
 * Section 10.2a's LOCATOR check: extract every `file.js:NNN` citation in the
 * spec and assert the named location still resolves at or near that line.
 * Runs on every re-anchor; this scripted form lands at the B3 re-cut per
 * 10.2a's bar paragraph.
 *
 * What "resolves" means here, mechanically - three tiers, applied per
 * citation in this order:
 *   1. the cited file must resolve to exactly one tracked source file
 *      (basenames are matched against an index of `scripts/` and `server/`;
 *      a citation carrying path segments is matched by suffix), and the
 *      cited line (or range end) must lie within the file;
 *   2. IDENTIFIER-WINDOW - when the citation is immediately preceded by a
 *      backticked identifier (e.g. "`buildPriorGames` (`file.js:188`)"),
 *      that identifier must appear within WINDOW lines of the cited line -
 *      this catches a citation that drifted whole functions away, the
 *      revision-24 ten-stale-locators class;
 *   3. CLAIM-EXPRESSION - when there is no preceding identifier but the
 *      citation is followed by a backticked code EXPRESSION (the G-A form:
 *      "`file.js:NNN` instead computes `expr`"), at least one identifier
 *      from that expression must appear within SLACK lines of the cited
 *      RANGE ITSELF. The revision-35 G-A escape proved WINDOW cannot serve
 *      here: the stale `arms.js:891-892` had the claimed identifiers 3 and
 *      30 lines away, both inside a 30-line window, while the claim was
 *      about the cited lines. A claim about specific lines is tested AT
 *      those lines.
 *   A citation with neither an identifier nor a claim expression passes on
 *   tier 1 alone and is counted as basis 'range-only', so a clean report
 *   states how much of it rests on the weakest tier.
 *
 * Bare backticked `:NNN` continuation citations now ARE extracted: each
 * inherits the file of the nearest preceding qualified citation within
 * BARE_REACH characters and runs the same tiers (reported separately;
 * one with no reachable file is counted unattributed, not failed).
 * Embedded multi-part citations (one file heading comma-joined ranges)
 * are extracted too, file-only - their parts run on the in-range tier.
 * KNOWN LIMITATIONS: the proximity tests are textual, so a citation whose
 * symbol survives only in a nearby COMMENT still passes; and a multi-part
 * citation's non-head ranges have no testable claim of their own, so
 * S1-class drift in them (a uniform shift landing in-range) is invisible
 * here and belongs to the re-anchor's semantic sweep. Both are inherent to
 * a text heuristic, and the reason this check assists rather than replaces
 * the re-anchor reading.
 *
 * Per 10.2a, an instrument is validated against a known answer before being
 * trusted. --self-validate replays the sealed revision-35 G-A escape from
 * git history (spec lines around 2110 at `f87f023` against that commit's
 * `arms.js`): the stale `lib/arms.js:891-892` citation MUST be reported
 * (claim-mismatch) and the corrected `:934-935` form MUST pass - a run
 * that cannot reproduce both directions is broken, not the document clean.
 * The test suite additionally drives the exported pieces over fixtures
 * with planted stale locators.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DOC = 'backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md';
const SEARCH_ROOTS = ['scripts', 'server'];
const WINDOW = 30;
const SLACK = 2;
const BARE_REACH = 600;

// The sealed known answer for --self-validate: the revision-35 G-A escape.
// At `f87f023` the spec's section 6.1 cited `lib/arms.js:891-892` for the
// tie-rounded comparison while that code sat at `:934-935`; the citation
// opens its line, so the identifier-window tier never engaged and the run
// reported 76/0. The claim-expression tier exists because of this case and
// must reproduce it.
const KNOWN_CASE = {
  rev: 'f87f023',
  sourceFile: 'scripts/backtest/lib/arms.js',
  docSliceStart: 2100,
  docSliceEnd: 2120,
  staleStart: 891,
  staleEnd: 892,
  repairedRange: '934-935',
};

function walkJsFiles(root, out) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- readdir dirent names cannot contain path separators
    if (entry.isDirectory()) walkJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function indexJsFiles(repoRoot) {
  const files = [];
  for (const root of SEARCH_ROOTS) walkJsFiles(path.join(repoRoot, root), files); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- SEARCH_ROOTS is a frozen module constant
  // Top-level scripts (`backtest-entrypoint.js`) live beside the roots, not
  // under them; scan the repo root itself non-recursively.
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch { /* an unreadable root reports every citation unresolved, which is loud enough */ }
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(repoRoot, entry.name)); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- readdir dirent names cannot contain path separators
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
// The first backticked span shortly AFTER a citation, when it reads as a
// code expression rather than a bare name - the "`file.js:NNN` instead
// computes `expr`" form. A leading backtick (the citation's own closer) and
// a short connective phrase are allowed before the span opens.
function extractClaimExpr(text, fromIndex) {
  const after = text.slice(fromIndex, fromIndex + 200);
  const spanMatch = /^`?[^`]{0,60}`([^`\n]{4,160})`/.exec(after);
  if (!spanMatch) return null;
  const span = spanMatch[1];
  // A span opening with prose (a space, a possessive apostrophe, markdown
  // bold) is inter-span text grabbed by backtick-parity ambiguity, not code.
  if (!/^[A-Za-z_$(!]/.test(span) || /\*\*|\|/.test(span)) return null;
  // An expression, not a bare identifier: needs code punctuation and at
  // least one identifier long enough to be distinctive. A span that is
  // itself a file:line citation is a cross-reference, never a claim about
  // the cited line's content.
  if (!/[(<>=.]/.test(span)) return null;
  if (/\.js:\d/.test(span) || /^:\d+(-\d+)?$/.test(span)) return null;
  const identifiers = (span.match(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g) || []);
  return identifiers.length > 0 ? { span, identifiers } : null;
}

// A backticked code expression immediately BEFORE a citation ("`expr`
// (`file.js:NNN`)") is a claim about the cited lines exactly like a
// following one; extract it under the same rules.
function extractPrecedingClaimExpr(text, beforeIndex) {
  const before = text.slice(Math.max(0, beforeIndex - 200), beforeIndex);
  const spanMatch = /`([^`\n]{4,160})`[\s(,'`]*$/.exec(before);
  if (!spanMatch) return null;
  const span = spanMatch[1];
  // A span opening with prose (a space, a possessive apostrophe, markdown
  // bold) is inter-span text grabbed by backtick-parity ambiguity, not code.
  if (!/^[A-Za-z_$(!]/.test(span) || /\*\*|\|/.test(span)) return null;
  if (!/[(<>=.]/.test(span)) return null;
  if (/\.js:\d/.test(span) || /^:\d+(-\d+)?$/.test(span)) return null;
  const identifiers = (span.match(/[A-Za-z_$][A-Za-z0-9_$]{3,}/g) || []);
  return identifiers.length > 0 ? { span, identifiers } : null;
}

function extractCitations(text) {
  const citations = [];
  const pattern = /([A-Za-z0-9_.\/\\-]*[A-Za-z0-9_-]\.js):(\d+)(?:-(\d+))?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const identifierMatch = /`([A-Za-z_$][A-Za-z0-9_$]*)`[\s('`]*$/.exec(before);
    const identifier = identifierMatch ? identifierMatch[1] : null;
    const claimExpr = identifier
      ? null
      : (extractPrecedingClaimExpr(text, match.index)
        || extractClaimExpr(text, match.index + match[0].length));
    const base = {
      file: match[1].replace(/\\/g, '/'),
      startLine: Number(match[2]),
      endLine: match[3] === undefined ? Number(match[2]) : Number(match[3]),
      identifier,
      claimExpr,
      index: match.index,
    };
    citations.push(base);
    // The embedded multi-part form - one file heading several comma-joined
    // ranges inside a single backticked span - rides additional line ranges
    // on the head citation's file. The revision-35 S1 escape lived in
    // exactly this form: invisible to the qualified pattern (no file
    // prefix) AND to the bare pattern (no enclosing backticks of its own).
    // Each part inherits ONLY the file: a claim expression or identifier
    // describes the head citation, not the other parts - the parts usually
    // cite different aspects (a call, an accumulation, a derived value), so
    // testing them against the head's claim flags stale and repaired
    // citations alike, which discriminates nothing. Parts run on the
    // in-range tier; S1-class drift in them is the semantic sweep's to
    // catch, not this instrument's - stated in the docblock's limits.
    let cursor = match.index + match[0].length;
    let continuation;
    const contPattern = /^,\s*:(\d+)(?:-(\d+))?/;
    while ((continuation = contPattern.exec(text.slice(cursor, cursor + 24))) !== null) {
      citations.push({
        file: base.file,
        startLine: Number(continuation[1]),
        endLine: continuation[2] === undefined ? Number(continuation[1]) : Number(continuation[2]),
        identifier: null,
        claimExpr: null,
        index: cursor,
        continuation: true,
      });
      cursor += continuation[0].length;
    }
    pattern.lastIndex = cursor;
  }
  return citations;
}

// Bare backticked continuation citations - "`:NNN`" / "`:NNN-MMM`" - inherit
// the file of the nearest preceding qualified citation within BARE_REACH
// characters AND within the same paragraph (no blank line between): the
// spec's convention rides a bare citation on the file under discussion,
// and a paragraph break ends that discussion. One with no reachable
// qualified citation is returned with file null (counted unattributed by
// the caller, never failed: attributing it by guesswork would manufacture
// failures the document never earned).
// True when the given text index sits inside a `**[...]**` correction
// bracket whose content marks its locators as historical - the spec's
// convention for quoting an OLD locator while narrating its repair. Such a
// quotation is a historical fact, never a live citation.
function insideHistoricalBracket(text, index) {
  const open = text.lastIndexOf('**[', index);
  if (open === -1 || index - open > 400) return false;
  const close = text.indexOf(']**', open);
  if (close === -1 || close < index) return false;
  const span = text.slice(open, close);
  return /had drifted|historical to its issuing|re-verified at revision/.test(span);
}

function extractBareCitations(text, qualifiedCitations) {
  const bare = [];
  const pattern = /`:(\d+)(?:-(\d+))?`/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (insideHistoricalBracket(text, match.index)) continue;
    let inherited = null;
    for (const citation of qualifiedCitations) {
      if (citation.index >= match.index) break;
      if (match.index - citation.index > BARE_REACH) continue;
      if (text.slice(citation.index, match.index).includes('\n\n')) continue;
      inherited = citation.file;
    }
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const identifierMatch = /`([A-Za-z_$][A-Za-z0-9_$]*)`[\s('`]*$/.exec(before);
    const identifier = identifierMatch ? identifierMatch[1] : null;
    bare.push({
      file: inherited,
      startLine: Number(match[1]),
      endLine: match[2] === undefined ? Number(match[1]) : Number(match[2]),
      identifier,
      claimExpr: identifier ? null : extractClaimExpr(text, match.index + match[0].length),
      index: match.index,
      bare: true,
    });
  }
  return bare;
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
      return { ...citation, status: 'ok', basis: 'identifier-window', resolved: candidate };
    }
    if (citation.claimExpr) {
      const lo = Math.max(0, citation.startLine - 1 - SLACK);
      const hi = Math.min(lines.length, citation.endLine + SLACK);
      const region = lines.slice(lo, hi).join('\n');
      const found = citation.claimExpr.identifiers.some((name) => region.includes(name));
      if (!found) {
        if (!firstFailure) firstFailure = { ...citation, status: 'claim-mismatch', detail: `no identifier of the claimed expression \`${citation.claimExpr.span}\` appears within ${SLACK} lines of ${candidate}:${citation.startLine}-${citation.endLine}` };
        continue;
      }
      return { ...citation, status: 'ok', basis: 'claim-expression', resolved: candidate };
    }
    return { ...citation, status: 'ok', basis: 'range-only', resolved: candidate };
  }
  return firstFailure;
}

function checkLocators({ repoRoot = process.cwd(), docPath, docText } = {}) {
  const text = docText !== undefined ? docText : fs.readFileSync(docPath || path.join(repoRoot, DEFAULT_DOC), 'utf8'); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- DEFAULT_DOC is constant and repoRoot is the operator-selected local root
  const index = indexJsFiles(repoRoot);
  const fileLineCache = new Map();
  const qualified = extractCitations(text);
  const results = qualified.map((citation) => checkCitation(citation, index, fileLineCache));
  const bareAll = extractBareCitations(text, qualified);
  const bareAttributed = bareAll.filter((citation) => citation.file !== null);
  // A bare citation that fails IN-RANGE is far more likely a misattributed
  // inheritance (the paragraph discusses a file it never re-names) than a
  // citation that drifted past end-of-file; it demotes to unattributed
  // rather than failing. Every OTHER bare failure class stands.
  const bareChecked = bareAttributed.map((citation) => checkCitation(citation, index, fileLineCache));
  const bareResults = bareChecked.filter((result) => result.status !== 'out-of-range');
  const bareDemoted = bareChecked.length - bareResults.length;
  const bareUnchecked = bareAll.length - bareResults.length;
  const failures = results.concat(bareResults).filter((result) => result.status !== 'ok');
  const basisCounts = {};
  for (const result of results.concat(bareResults)) {
    if (result.status === 'ok') basisCounts[result.basis] = (basisCounts[result.basis] || 0) + 1;
  }
  return {
    total: results.length,
    bareFound: bareAll.length,
    bareAttributed: bareAttributed.length,
    bareReported: bareResults.length,
    bareDemoted,
    bareUnchecked,
    // Backward-compatible aliases retained for existing callers.
    bareTotal: bareResults.length,
    bareUnattributed: bareUnchecked,
    basisCounts,
    results,
    bareResults,
    failures,
    ok: failures.length === 0,
  };
}

// Replays the sealed G-A known answer from git history: both directions
// must reproduce (stale reported, repaired passing) before a live run is
// trusted. Fails closed when git or the sealed commit is unavailable.
function selfValidate() {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const specLines = git(['show', `${KNOWN_CASE.rev}:${DEFAULT_DOC}`]).split('\n');
  const docSlice = specLines.slice(KNOWN_CASE.docSliceStart - 1, KNOWN_CASE.docSliceEnd).join('\n');
  const sourceBytes = git(['show', `${KNOWN_CASE.rev}:${KNOWN_CASE.sourceFile}`]);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-locators-selfvalidate-'));
  try {
    const materialized = path.join(tmpRoot, ...KNOWN_CASE.sourceFile.split('/'));
    fs.mkdirSync(path.dirname(materialized), { recursive: true });
    fs.writeFileSync(materialized, sourceBytes, 'utf8');
    const isTarget = (r) => r.file.endsWith('arms.js') && r.startLine === KNOWN_CASE.staleStart && r.endLine === KNOWN_CASE.staleEnd;
    const staleRun = checkLocators({ repoRoot: tmpRoot, docText: docSlice });
    const staleReported = staleRun.failures.some((f) => isTarget(f) && f.status === 'claim-mismatch');
    const repairedSlice = docSlice.replace(`${KNOWN_CASE.staleStart}-${KNOWN_CASE.staleEnd}`, KNOWN_CASE.repairedRange);
    const repairedRun = checkLocators({ repoRoot: tmpRoot, docText: repairedSlice });
    const repairedTarget = repairedRun.results.find((r) => r.file.endsWith('arms.js') && `${r.startLine}-${r.endLine}` === KNOWN_CASE.repairedRange);
    const repairedPasses = Boolean(repairedTarget && repairedTarget.status === 'ok' && repairedTarget.basis === 'claim-expression');
    return { ok: staleReported && repairedPasses, staleReported, repairedPasses };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--doc') args.docPath = argv[++i];
    else if (token === '--repo-root') args.repoRoot = argv[++i];
    else if (token === '--self-validate') args.selfValidate = true;
    else throw new Error(`check-locators: unknown argument ${token}`);
  }
  if (args.selfValidate) {
    const validation = selfValidate();
    console.log(JSON.stringify(validation, null, 2));
    if (!validation.ok) {
      console.error('check-locators: SELF-VALIDATION FAILED - a run that cannot reproduce the sealed G-A escape in both directions is broken');
      return 1;
    }
    return 0;
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
    bareFound: result.bareFound,
    bareAttributed: result.bareAttributed,
    bareReported: result.bareReported,
    bareDemoted: result.bareDemoted,
    bareUnchecked: result.bareUnchecked,
    bareTotal: result.bareTotal,
    bareUnattributed: result.bareUnattributed,
    basisCounts: result.basisCounts,
    failureCount: result.failures.length,
    failures: result.failures.map(({ file, startLine, endLine, identifier, status, detail, bare }) => ({ file, startLine, endLine, identifier, status, detail, bare: Boolean(bare) })),
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

module.exports = { DEFAULT_DOC, WINDOW, SLACK, BARE_REACH, KNOWN_CASE, indexJsFiles, extractCitations, extractBareCitations, extractClaimExpr, resolveFile, checkLocators, selfValidate, main };
