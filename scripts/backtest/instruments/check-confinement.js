'use strict';

/**
 * Section 10.2a's CONFINEMENT check (the PRIMARY check): map every changed
 * line of the spec between two anchors to its nearest preceding heading -
 * ANY heading level, including the document's `#` title, under which the
 * preamble falls - and compare the resulting section set against what the
 * revision claims, as a SET EQUALITY IN BOTH DIRECTIONS.
 *
 * - Every section the revision claims byte-identical must have ZERO changed
 *   lines mapped to it.
 * - Every section with changed lines mapped to it must appear in the
 *   claimed-changed list.  A subset check passes the actual defect: revision
 *   29 carried a locator repair in 8.6.0 that appeared in neither list.
 *
 * "Every level" is literal: a terminator of `/^(### |## )/` misses `####`
 * and silently swallows 8.6.2-8.6.5.  This implementation matches
 * `/^#{1,6} /`.
 *
 * Per 10.2a's own requirement, the check is validated against a known case
 * BEFORE being trusted: run over `0762738..b7ccf186` (revision 28 -> 29) it
 * must return exactly
 *   preamble, 0, 1, 3.2, 6.1, 6.2, 6.5, 8.6.0, 8.6.1, 8.6.3, 8.6.4, 8.6.5,
 *   9, 10, 10.2
 * including the 8.6.0 the prose had missed.  `--self-validate` runs exactly
 * that case; a run returning the empty set is BROKEN, not clean (the first
 * implementation returned an empty set through a hunk-header parsing error,
 * and an empty set satisfies a subset check vacuously).
 */

const { execFileSync } = require('child_process');

const DEFAULT_DOC = 'backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md';

const KNOWN_CASE = Object.freeze({
  from: '0762738',
  to: 'b7ccf186',
  expected: Object.freeze([
    'preamble', '0', '1', '3.2', '6.1', '6.2', '6.5', '8.6.0', '8.6.1',
    '8.6.3', '8.6.4', '8.6.5', '9', '10', '10.2',
  ]),
});

function git(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd: cwd || process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Changed lines of every hunk from `git diff -U0 from to -- doc`, split by
 * which side of the diff can name their section.  Added/replaced content is
 * mapped through the TO-side document.  A pure deletion (`+c,0`) has no
 * new-side lines of its own, and mapping it to the surviving neighbor
 * attributes the change to the WRONG section - deleting all of section 5
 * would read as a change to its neighbor while section 5 itself could be
 * claimed byte-identical (adversarial QA on this slice).  Deleted lines are
 * therefore mapped through the FROM-side document, where the deleted
 * section's own heading still exists to claim them.
 */
function changedLineSets(diffText) {
  const newSide = [];
  const deletedOldSide = [];
  const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let match;
  while ((match = hunk.exec(diffText)) !== null) {
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    if (newCount === 0) {
      for (let i = 0; i < oldCount; i++) deletedOldSide.push(oldStart + i);
    } else {
      for (let i = 0; i < newCount; i++) newSide.push(newStart + i);
    }
  }
  return { newSide, deletedOldSide };
}

/**
 * The section token for a heading line: `## 0. Classes` -> `0`,
 * `### 10.2a Instruments` -> `10.2a`, `#### 8.6.0 ...` -> `8.6.0`.  The
 * level-1 document title (and any line before the first heading) maps to
 * `preamble`.  A heading whose first word is not number-shaped keeps that
 * word verbatim, so an unnumbered heading still names a distinct section
 * rather than inheriting its neighbor's.
 */
function sectionToken(headingLine) {
  const stripped = headingLine.replace(/^#{1,6}\s+/, '');
  if (/^#\s/.test(headingLine)) return 'preamble';
  const first = stripped.split(/\s+/)[0].replace(/\.$/, '');
  return first;
}

/**
 * Map each changed line number to its section token in the given document
 * side.  KNOWN LIMITATION (adversarial QA, latent): a heading-shaped line
 * inside a fenced code block is treated as a heading; the current spec
 * carries none, but a future revision fencing a `# comment` would need
 * fence-awareness added here.
 */
function mapLinesToSections(docLines, changedLines) {
  // Precompute the nearest preceding heading for every line, one pass.
  const sectionByLine = new Array(docLines.length + 1);
  let current = 'preamble';
  for (let i = 0; i < docLines.length; i++) {
    if (/^#{1,6} /.test(docLines[i])) current = sectionToken(docLines[i]);
    sectionByLine[i + 1] = current;
  }
  const sections = new Set();
  for (const line of changedLines) {
    // A line beyond the document end (a deletion at the very end) maps to
    // the last section rather than being dropped.
    sections.add(sectionByLine[Math.min(line, docLines.length)] || 'preamble');
  }
  return sections;
}

function confinementSet({ from, to, doc = DEFAULT_DOC, cwd } = {}) {
  const diffText = git(['diff', '-U0', from, to, '--', doc], { cwd });
  const { newSide, deletedOldSide } = changedLineSets(diffText);
  const sections = mapLinesToSections(git(['show', `${to}:${doc}`], { cwd }).split('\n'), newSide);
  if (deletedOldSide.length > 0) {
    for (const section of mapLinesToSections(git(['show', `${from}:${doc}`], { cwd }).split('\n'), deletedOldSide)) {
      sections.add(section);
    }
  }
  return [...sections].sort();
}

/**
 * The both-direction set equality.  Returns { ok, violations } where each
 * violation names its direction: a claimed-identical section that changed,
 * or a changed section absent from the claimed-changed list.
 */
function compareAgainstClaims({ actual, claimedChanged = null, claimedIdentical = null }) {
  const violations = [];
  const actualSet = new Set(actual);
  if (claimedIdentical) {
    for (const section of claimedIdentical) {
      if (actualSet.has(section)) {
        violations.push(`claimed byte-identical section ${section} has changed lines mapped to it`);
      }
    }
  }
  if (claimedChanged) {
    const claimedSet = new Set(claimedChanged);
    for (const section of actual) {
      if (!claimedSet.has(section)) {
        violations.push(`section ${section} changed but is absent from the claimed-changed list - the direction that has failed (revision 29's 8.6.0)`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

function selfValidate({ cwd } = {}) {
  const actual = confinementSet({ from: KNOWN_CASE.from, to: KNOWN_CASE.to, cwd });
  const expected = [...KNOWN_CASE.expected].sort();
  const ok = actual.length === expected.length && actual.every((section, index) => section === expected[index]);
  return { ok, actual, expected };
}

function parseCsv(value) {
  return value.split(',').map((token) => token.trim()).filter((token) => token.length > 0);
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--from') args.from = argv[++i];
    else if (token === '--to') args.to = argv[++i];
    else if (token === '--doc') args.doc = argv[++i];
    else if (token === '--claimed-changed') args.claimedChanged = parseCsv(argv[++i]);
    else if (token === '--claimed-identical') args.claimedIdentical = parseCsv(argv[++i]);
    else if (token === '--self-validate') args.selfValidate = true;
    else throw new Error(`check-confinement: unknown argument ${token}`);
  }
  if (args.selfValidate) {
    const result = selfValidate();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error('check-confinement: SELF-VALIDATION FAILED - this instrument must not be trusted on any other diff');
      return 1;
    }
    return 0;
  }
  if (!args.from || !args.to) throw new Error('check-confinement: --from and --to are required (or --self-validate)');
  const actual = confinementSet({ from: args.from, to: args.to, doc: args.doc });
  if (actual.length === 0) {
    // An empty set from a real diff is far more likely a parsing failure
    // than a byte-identical document; force the caller to look.
    const diffText = git(['diff', '-U0', args.from, args.to, '--', args.doc || DEFAULT_DOC]);
    if (diffText.trim().length > 0) {
      console.error('check-confinement: the diff is non-empty but the mapped section set is EMPTY - hunk parsing has failed, and an empty set satisfies a subset check vacuously');
      return 1;
    }
  }
  const comparison = compareAgainstClaims({ actual, claimedChanged: args.claimedChanged || null, claimedIdentical: args.claimedIdentical || null });
  console.log(JSON.stringify({ changedSections: actual, ...comparison }, null, 2));
  return comparison.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)) || 0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_DOC, KNOWN_CASE, changedLineSets, sectionToken, mapLinesToSections,
  confinementSet, compareAgainstClaims, selfValidate, main,
};
