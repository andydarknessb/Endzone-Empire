#!/usr/bin/env node
/**
 * Guard against two ADRs claiming the same numeric prefix, and against a
 * hole opening in the sequence.
 *
 * Why this exists (#307): two branches each add the next free ADR number,
 * off the same base, at the same time. Both authors correctly compute the
 * same "next free" number because neither has seen the other's branch. Git
 * does not conflict, because the file PATHS differ (0007-slug-a.md vs
 * 0007-slug-b.md are two different paths as far as git is concerned), so
 * both PRs go green and merge cleanly, leaving two ADRs numbered 0007. This
 * happened twice in one week in this repo -- see the issue for both
 * instances, one of which (two ADR 0005s, plus a 0006 collision) is sitting
 * unpushed on local main right now, deliberately left for that work's own
 * push to renumber. This script is the thing that is supposed to catch it
 * before merge instead of a reviewer happening to hold two PRs in mind at
 * once.
 *
 * UNIQUE *AND* GAPLESS, BOTH ENFORCED, AND WHY: a decision log must not
 * silently lose entries. A superseded ADR is marked Superseded IN PLACE --
 * its number stays allocated and the file stays in the tree -- it is never
 * deleted and its number is never reused. That means the numeric sequence
 * should never have a hole: every integer from 0001 up to the highest
 * number in use should be claimed by exactly one file. A gap therefore
 * means one of two things, both worth failing on: a number was skipped when
 * it should not have been, or an ADR was deleted when it should have been
 * superseded in place instead. (Ruling: maintainer, 2026-08-25.)
 *
 * SCOPE OF THE CHECK: the NUMERIC PREFIX only, not the whole filename. The
 * live collision this guard exists for is exactly two DIFFERENT filenames
 * sharing the same number (0005-fix-draft-rounds-at-start.md and
 * 0005-snapshot-draft-rounds-at-start.md) -- checking whole-filename
 * uniqueness would not have caught it, since the filenames were never
 * equal.
 *
 * NON-ADR FILES ARE IGNORED, NOT CRASHED ON: any file in docs/adr/ whose
 * name does not match `^\d+-.+\.md$` (a README, a template, a stray
 * .gitkeep) is skipped by parseAdrEntries rather than treated as a parse
 * failure. That is a stated rule, not a silent fallback -- see
 * parseAdrEntries below.
 *
 * Run: `npm run check:adr-uniqueness`
 *
 * WIRED INTO CI: the test-build job in .github/workflows/ci.yml runs
 * `npm run check:adr-uniqueness` on every push and pull request, right
 * after `npm run lint:colors`, following the check-model-constants.js
 * house pattern in the same job. A guard nothing runs is the exact defect
 * #247 tracks across this repo (see scripts/ci/check-dom-dedupe.js and
 * scripts/eslintRuleScoping.test.js for two guards that still are not
 * wired, and their own headers for why) -- this one does not join that
 * list. `.github/workflows/**` is a carve-out, so the workflow edit itself
 * still waits on a maintainer merge even though it is written; the guard
 * and test files do not depend on that merge landing to be correct or
 * reviewed.
 */
const fs = require('node:fs');
const path = require('node:path');

const ADR_DIR = path.join(__dirname, '..', '..', 'docs', 'adr');
const ADR_FILENAME_PATTERN = /^(\d+)-.+\.md$/;

// Split a directory listing into ADR entries (numeric prefix + filename)
// and everything else, which is ignored rather than treated as an error.
// This is the "non-ADR files don't crash" rule the header promises.
function parseAdrEntries(filenames) {
  const entries = [];
  const ignored = [];
  for (const file of filenames) {
    const match = ADR_FILENAME_PATTERN.exec(file);
    if (match) {
      entries.push({ number: parseInt(match[1], 10), file });
    } else {
      ignored.push(file);
    }
  }
  return { entries, ignored };
}

// Any numeric prefix claimed by more than one file is a collision. Sorted
// by number so the report reads in file order, not discovery order.
function findDuplicates(entries) {
  const byNumber = new Map();
  for (const entry of entries) {
    if (!byNumber.has(entry.number)) byNumber.set(entry.number, []);
    byNumber.get(entry.number).push(entry.file);
  }
  return Array.from(byNumber.entries())
    .filter(([, files]) => files.length > 1)
    .map(([number, files]) => ({ number, files }))
    .sort((a, b) => a.number - b.number);
}

// Every integer from 1 up to the highest number in use must be claimed by
// at least one file (a duplicate at a number still counts as that number
// being present). Any integer in that range claimed by nothing is a gap.
function findGaps(entries) {
  if (entries.length === 0) return [];
  const present = new Set(entries.map((e) => e.number));
  const max = Math.max(...present);
  const gaps = [];
  for (let n = 1; n <= max; n += 1) {
    if (!present.has(n)) gaps.push(n);
  }
  return gaps;
}

function evaluate(entries) {
  const duplicates = findDuplicates(entries);
  const gaps = findGaps(entries);
  return { ok: duplicates.length === 0 && gaps.length === 0, duplicates, gaps };
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

// The offending numbers/filenames are the actionable diagnostic, and the
// message says what to DO, not only what is wrong.
function buildViolationMessage(result) {
  const lines = ['\n❌ docs/adr/ numbering is not unique and gapless:\n'];

  if (result.duplicates.length > 0) {
    lines.push('Duplicate ADR numbers:');
    result.duplicates.forEach(({ number, files }) => {
      lines.push(`  ${pad4(number)} is used by ${files.length} files:`);
      files.forEach((f) => lines.push(`    ${f}`));
    });
    lines.push(
      '\nRenumber all but one of each group to the next free number after the ' +
        'highest one currently in docs/adr/. Two branches taking the same ' +
        '"next free" number off the same base is exactly the failure #307 ' +
        'documents -- rebase and re-check before opening the PR.\n'
    );
  }

  if (result.gaps.length > 0) {
    lines.push(
      `Missing ADR number${result.gaps.length > 1 ? 's' : ''}: ${result.gaps
        .map(pad4)
        .join(', ')}`
    );
    lines.push(
      '\nADR numbers must be gapless: every integer from 0001 up to the ' +
        'highest number in use must belong to exactly one file. This is a ' +
        'deliberate choice, not a side effect -- a decision log must not ' +
        'silently lose entries, so a retired ADR is marked Superseded IN ' +
        'PLACE and its number stays allocated forever, never reused, never ' +
        'deleted. If an ADR was deleted instead of superseded, restore it ' +
        '(or reserve its number with a stub) rather than renumbering ' +
        'everything after it down. If this number was simply never ' +
        'assigned, add the missing ADR or claim the number.\n'
    );
  }

  return lines.join('\n');
}

function main() {
  let filenames;
  try {
    filenames = fs.readdirSync(ADR_DIR);
  } catch (err) {
    console.error(`\n❌ Could not read ${ADR_DIR}: ${err.message}\n`);
    process.exit(1);
    return;
  }

  const { entries } = parseAdrEntries(filenames);
  const result = evaluate(entries);

  if (!result.ok) {
    console.error(buildViolationMessage(result));
    process.exit(1);
    return;
  }

  const numbers = entries.map((e) => e.number).sort((a, b) => a - b);
  const range =
    numbers.length > 0 ? `${pad4(numbers[0])}-${pad4(numbers[numbers.length - 1])}` : '(none)';
  console.log(`✅ docs/adr/ is unique and gapless: ${entries.length} ADRs, ${range}.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseAdrEntries,
  findDuplicates,
  findGaps,
  evaluate,
  buildViolationMessage,
};
