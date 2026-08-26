#!/usr/bin/env node
/**
 * Guard against a merged ADR being rewritten in place.
 *
 * Why this exists: scripts/ci/check-adr-uniqueness.js (#307) is the repo's
 * only ADR guard, and its only filesystem call is `readdirSync` -- it never
 * opens an ADR. So it catches a second `0010-*.md` and is STRUCTURALLY BLIND
 * to someone editing the existing one, which is the more damaging path: a
 * decision log whose entries can be quietly reworded after the fact records
 * nothing. The blind spot was named from the reviewer's seat on 2026-08-26,
 * when #432's criteria cited an ADR number that was already taken and the
 * cheapest wrong fix would have been to overwrite it.
 *
 * THE RULE, stated once so the check and the reader agree on it:
 *   A docs/adr/NNNN-*.md that exists on the base ref is APPEND-ONLY, with one
 *   exception: its `Status:` line may change (that is how an ADR is marked
 *   Superseded IN PLACE, per the uniqueness guard's own header). Everything
 *   else is frozen: no line above the base file's last line may be edited or
 *   removed, no line may be inserted between existing lines, and the file may
 *   not be deleted or renamed. New ADRs (absent on base) are not this guard's
 *   business; the uniqueness guard covers their numbering.
 *
 *   A typo in a merged ADR is fixed by appending an amendment, not by editing
 *   the line. A decision that turned out wrong is superseded by a new ADR and
 *   the old one's Status line says so. Neither path needs an escape hatch, so
 *   this guard has none: there is no environment variable that skips it.
 *
 * WHAT "BASE" MEANS, AND BE HONEST ABOUT COVERAGE: the comparison is between
 * the checked-out tree and the git ref named by ADR_BASE_REF. ci.yml passes
 * `github.event.pull_request.base.sha` on pull requests (so the merge-ref
 * checkout is compared against the PR's target) and `github.event.before` on
 * pushes to main/integration (so a merge that landed on stale checks is
 * re-examined by the push build). The same three cases the uniqueness guard
 * spells out apply here, with one difference in this guard's favour: a
 * rewrite is visible on the PR's own diff, so case 1 (two open PRs) does not
 * hide it. Case 3 (merged on stale checks) surfaces on the next push build.
 *
 * THE BASE REF IS REQUIRED. Unset, unresolvable, or the all-zero sha a push
 * event reports for a newly created branch: the guard FAILS rather than
 * passing on nothing, because a green that compared against no base would
 * certify nothing (docs/agents: green for the wrong reason). Locally, run it
 * as `ADR_BASE_REF=origin/integration npm run check:adr-immutability`.
 *
 * NORMALISATION: CRLF is folded to LF and trailing newlines are dropped
 * before comparing, so a checkout's line-ending policy is never reported as
 * a rewrite. Trailing whitespace inside a line is NOT normalised; it is part
 * of the line.
 *
 * Run: `npm run check:adr-immutability` (its own test first, then the guard).
 *
 * WIRED INTO CI: the test-build job in .github/workflows/ci.yml runs it right
 * after `npm run check:adr-uniqueness`, with ADR_BASE_REF set as described.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ADR_DIR_REL = 'docs/adr';
const ADR_FILENAME_PATTERN = /^\d+-.+\.md$/;
const STATUS_LINE = /^Status:/;
const ZERO_SHA = /^0{40}$/;

// Fold CRLF to LF and drop trailing newlines, then split. A file that ends in
// "\n" and one that does not are the same ADR.
function normaliseLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
}

function statusIndex(lines) {
  return lines.findIndex((line) => STATUS_LINE.test(line));
}

/**
 * Pure: compare one ADR's base text against its head text under the rule in
 * the header. Returns { ok: true } or { ok: false, reason, line } where
 * `line` is the 1-based line number in the BASE file the violation is at
 * (absent for a deletion).
 */
function compareAdr(baseText, headText) {
  if (headText === null || headText === undefined) {
    return { ok: false, reason: 'deleted or renamed; a retired ADR is marked Superseded in place, never removed' };
  }
  const base = normaliseLines(baseText);
  const head = normaliseLines(headText);
  const baseStatus = statusIndex(base);

  if (head.length < base.length) {
    return {
      ok: false,
      line: head.length + 1,
      reason: `shortened from ${base.length} to ${head.length} lines; existing lines may not be removed`,
    };
  }

  for (let i = 0; i < base.length; i += 1) {
    if (base[i] === head[i]) continue;
    if (i === baseStatus && STATUS_LINE.test(head[i])) continue;
    if (i === baseStatus) {
      return { ok: false, line: i + 1, reason: 'the Status: line may change its text but must stay a Status: line' };
    }
    return {
      ok: false,
      line: i + 1,
      reason: `existing line changed (base: ${JSON.stringify(base[i])}, head: ${JSON.stringify(head[i])}); merged ADRs are append-only apart from their Status: line`,
    };
  }
  return { ok: true };
}

/**
 * Pure over the two maps: baseFiles and headFiles are Map<filename, text>.
 * Only filenames matching the ADR pattern on BASE are examined; anything else
 * (a README, a new ADR) is ignored and reported as such.
 */
function evaluate(baseFiles, headFiles) {
  const violations = [];
  const examined = [];
  const ignored = [];
  for (const [file, baseText] of baseFiles) {
    if (!ADR_FILENAME_PATTERN.test(file)) {
      ignored.push(file);
      continue;
    }
    examined.push(file);
    const result = compareAdr(baseText, headFiles.has(file) ? headFiles.get(file) : null);
    if (!result.ok) violations.push({ file, ...result });
  }
  examined.sort();
  return { ok: violations.length === 0, violations, examined, ignored };
}

function buildViolationMessage(result, baseRef) {
  const lines = [`\n❌ docs/adr/ has a merged ADR that was rewritten (compared against ${baseRef}):\n`];
  for (const v of result.violations) {
    const where = v.line ? ` (line ${v.line})` : '';
    lines.push(`  ${v.file}${where}: ${v.reason}`);
  }
  lines.push(
    '\nA merged ADR is append-only: fix a typo by appending an amendment, retire a ' +
      'decision by changing its Status: line to Superseded and writing the new ' +
      'decision as a new ADR. Restore the original lines and put the change below ' +
      'them.\n'
  );
  return lines.join('\n');
}

function buildSuccessMessage(result, baseRef) {
  const lines = [
    `✅ docs/adr/: ${result.examined.length} merged ADR${result.examined.length === 1 ? '' : 's'} on ${baseRef} unchanged apart from Status: lines and appended text.`,
  ];
  if (result.ignored.length > 0) {
    lines.push(
      `ℹ Ignored ${result.ignored.length} file${result.ignored.length > 1 ? 's' : ''} on ${baseRef} that did not match ${ADR_FILENAME_PATTERN}: ${result.ignored.join(', ')}`
    );
  }
  return lines.join('\n');
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function refIsResolvable(ref) {
  try {
    git(['cat-file', '-e', `${ref}^{commit}`]);
    return true;
  } catch (err) {
    return false;
  }
}

// actions/checkout defaults to depth 1, so the base sha is usually absent from
// the clone. GitHub serves any sha reachable from a ref, so a single-commit
// fetch by sha is enough to read its docs/adr/ tree.
function ensureRef(ref) {
  if (refIsResolvable(ref)) return;
  try {
    git(['fetch', '--depth=1', 'origin', ref], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    // fall through to the final check below
  }
}

function readBaseFiles(ref) {
  const listing = git(['ls-tree', '--name-only', ref, `${ADR_DIR_REL}/`]).split('\n').filter(Boolean);
  const files = new Map();
  for (const relPath of listing) {
    const file = path.posix.basename(relPath);
    files.set(file, git(['show', `${ref}:${relPath}`]));
  }
  return files;
}

function readHeadFiles() {
  const dir = path.join(REPO_ROOT, ADR_DIR_REL);
  const files = new Map();
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isFile()) files.set(file, fs.readFileSync(full, 'utf8'));
  }
  return files;
}

function main() {
  const baseRef = (process.env.ADR_BASE_REF || '').trim();
  if (!baseRef || ZERO_SHA.test(baseRef)) {
    console.error(
      '\n❌ ADR_BASE_REF is not set (or is the all-zero sha of a new branch). This guard compares ' +
        'docs/adr/ against a base ref and refuses to pass on nothing. Locally: ' +
        'ADR_BASE_REF=origin/integration npm run check:adr-immutability\n'
    );
    process.exit(1);
    return;
  }

  ensureRef(baseRef);
  if (!refIsResolvable(baseRef)) {
    console.error(`\n❌ ADR_BASE_REF=${baseRef} does not resolve to a commit in this clone and could not be fetched.\n`);
    process.exit(1);
    return;
  }

  const result = evaluate(readBaseFiles(baseRef), readHeadFiles());
  if (!result.ok) {
    console.error(buildViolationMessage(result, baseRef));
    process.exit(1);
    return;
  }
  console.log(buildSuccessMessage(result, baseRef));
}

if (require.main === module) {
  main();
}

module.exports = {
  ADR_FILENAME_PATTERN,
  normaliseLines,
  compareAdr,
  evaluate,
  buildViolationMessage,
  buildSuccessMessage,
};
