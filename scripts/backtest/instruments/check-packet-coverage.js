'use strict';

/**
 * Section 10.2a's PACKET-COVERAGE check: enumerate every `prereg N(.M)?`
 * cited within the approval scope (sections 3-8), enumerate section
 * 11.3(a)'s supply set with ranges expanded, and assert the difference is
 * empty.  Both enumerations are in the anchored bytes, so the check runs on
 * the document alone with no external state.
 *
 * The three requirements 10.2a records, each learned from a probe that
 * failed while the check was being derived:
 *   1. RANGE EXPANSION IS MANDATORY - `4.1-4.2`, `9.1-9.7` etc. each supply
 *      every member; a range-blind pattern returned 27 against a true 35.
 *   2. MATCH `prereg N.M`, NOT BARE DECIMALS - a bare-decimal sweep harvests
 *      the SPECIFICATION section numbers out of 11.3(a)'s own dependency
 *      annotations; that returned 38 against a true 35.
 *   3. VALIDATE AGAINST THE KNOWN ANSWER - run against revision 32
 *      (`9a03721`) it must return exactly {3.3, 5.1, 6.2, 7.1, 7.2}; a run
 *      returning the empty set on those bytes is BROKEN, not clean.
 *      `--self-validate` runs exactly that case.
 *
 * Coverage semantics: a cited `N.M` is covered by an exact `N.M` supply
 * entry, by a same-major range containing it, or by a bare-`N` supply entry
 * (supplying a whole prereg section supplies its subsections).  A cited bare
 * `N` is covered by a bare-`N` entry or by ANY supplied `N.*` member -
 * 11.3(a)'s own ruling for the bare `prereg 11` citation (11.1 and 11.2
 * supplied) is the authority for that direction.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const DEFAULT_DOC = 'backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md';

const KNOWN_CASE = Object.freeze({
  rev: '9a03721',
  expected: Object.freeze(['3.3', '5.1', '6.2', '7.1', '7.2']),
});

const SCOPE_MAJORS = Object.freeze(['3', '4', '5', '6', '7', '8']);

function sectionToken(headingLine) {
  if (/^#\s/.test(headingLine)) return 'preamble';
  return headingLine.replace(/^#{1,6}\s+/, '').split(/\s+/)[0].replace(/\.$/, '');
}

/** Expand a same-major `N.a-N.b` range to its members; throws on anything unexpandable. */
function expandRange(from, to, where) {
  const [fromMajor, fromMinor] = from.split('.').map(Number);
  const [toMajor, toMinor] = to.split('.').map(Number);
  if (fromMajor !== toMajor || fromMinor === undefined || toMinor === undefined || toMinor < fromMinor) {
    throw new Error(`check-packet-coverage: unexpandable range ${from}-${to} in ${where}`);
  }
  const members = [];
  for (let minor = fromMinor; minor <= toMinor; minor++) members.push(`${fromMajor}.${minor}`);
  return members;
}

/**
 * Every `prereg N[.M][-N.M']` citation on lines whose governing spec section
 * has a major in SCOPE_MAJORS.  Ranges expand on the CITED side too - a
 * citation written `prereg 9.1-9.7` cites all seven members, and a
 * range-blind pattern would leave 9.2-9.7 unchecked (adversarial QA on this
 * slice; the same failure mode as 10.2a requirement 1, on the other side).
 */
function citationsInScope(docText) {
  const cited = new Set();
  let current = 'preamble';
  for (const line of docText.split('\n')) {
    if (/^#{1,6} /.test(line)) current = sectionToken(line);
    const major = current.split('.')[0].replace(/[^0-9]/g, '');
    if (!SCOPE_MAJORS.includes(major)) continue;
    const pattern = /prereg\s+(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/gi;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      if (match[2]) for (const member of expandRange(match[1], match[2], 'a citation')) cited.add(member);
      else cited.add(match[1]);
    }
  }
  return cited;
}

/**
 * Section 11.3(a)'s supply set: the `**\`PREREGISTRATION.md\` sections**:`
 * bullet, read to the start of the next top-level bullet.  Number tokens
 * preceded by `section`/`sections`/`rule`/`revision` are SPECIFICATION
 * references inside the bullet's own dependency annotations, not supply
 * entries (10.2a requirement 2), and are excluded.
 */
function supplySet(docText) {
  const start = docText.indexOf('**`PREREGISTRATION.md` sections**');
  if (start < 0) throw new Error('check-packet-coverage: the 11.3(a) supply bullet was not found - the enumeration is broken, not the packet complete');
  const tail = docText.slice(start);
  const lines = tail.split('\n');
  const bulletLines = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (/^- \*\*/.test(lines[i]) || /^#{1,6} /.test(lines[i])) break;
    bulletLines.push(lines[i]);
  }
  const bullet = bulletLines.join('\n');
  // Supply ENTRIES sit at parenthesis depth 0 of the bullet; everything
  // inside parentheses is annotation ("4.1-4.2 (cohort and injury policy)",
  // "...which section 4.6 extends per rule 1...").  Harvesting by a
  // guarded-word list alone leaks any annotation number whose preceding word
  // is not on the list (adversarial QA on this slice), so annotations are
  // excluded STRUCTURALLY - depth tracking - with the word guard kept as a
  // second line for depth-0 prose like "per rule 1".
  let depth = 0;
  let depthZero = '';
  for (const ch of bullet) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else depthZero += depth === 0 ? ch : ' ';
    if (ch === '(' || ch === ')') depthZero += ' ';
  }
  const supplied = new Set();
  const pattern = /(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/g;
  let match;
  while ((match = pattern.exec(depthZero)) !== null) {
    const before = depthZero.slice(Math.max(0, match.index - 24), match.index);
    if (/(?:sections?|rule|revision)\s+$/i.test(before)) continue;
    const from = match[1];
    const to = match[2];
    if (!to) {
      supplied.add(from);
      continue;
    }
    // Range expansion (10.2a requirement 1): same-major, minor-stepped.
    for (const member of expandRange(from, to, 'the supply bullet')) supplied.add(member);
  }
  return supplied;
}

function covered(citation, supplied) {
  if (supplied.has(citation)) return true;
  if (citation.includes('.')) {
    // A whole-section supply covers its subsections.
    return supplied.has(citation.split('.')[0]);
  }
  // A bare-major citation is covered when any member of the section was
  // supplied (11.3(a)'s prereg-11 ruling).
  for (const entry of supplied) {
    if (entry === citation || entry.startsWith(`${citation}.`)) return true;
  }
  return false;
}

function packetCoverage(docText) {
  const cited = citationsInScope(docText);
  const supplied = supplySet(docText);
  const missing = [...cited].filter((citation) => !covered(citation, supplied)).sort();
  return {
    cited: [...cited].sort(),
    supplied: [...supplied].sort(),
    missing,
    ok: missing.length === 0,
  };
}

function docTextFor({ docPath, rev, doc = DEFAULT_DOC } = {}) {
  if (rev) return execFileSync('git', ['show', `${rev}:${doc}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return fs.readFileSync(docPath || doc, 'utf8');
}

function selfValidate() {
  const result = packetCoverage(docTextFor({ rev: KNOWN_CASE.rev }));
  const expected = [...KNOWN_CASE.expected];
  const ok = result.missing.length === expected.length && result.missing.every((token, index) => token === expected[index]);
  return { ok, actual: result.missing, expected, citedCount: result.cited.length };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--doc') args.docPath = argv[++i];
    else if (token === '--rev') args.rev = argv[++i];
    else if (token === '--self-validate') args.selfValidate = true;
    else throw new Error(`check-packet-coverage: unknown argument ${token}`);
  }
  if (args.selfValidate) {
    const result = selfValidate();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error('check-packet-coverage: SELF-VALIDATION FAILED against the revision-32 known answer - this instrument must not be trusted');
      return 1;
    }
    return 0;
  }
  const result = packetCoverage(docTextFor(args));
  if (result.cited.length === 0) {
    console.error('check-packet-coverage: extracted ZERO citations in scope - the enumeration is broken, not the packet complete');
    return 1;
  }
  console.log(JSON.stringify(result, null, 2));
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

module.exports = {
  DEFAULT_DOC, KNOWN_CASE, SCOPE_MAJORS, expandRange, citationsInScope, supplySet, covered,
  packetCoverage, docTextFor, selfValidate, main,
};
