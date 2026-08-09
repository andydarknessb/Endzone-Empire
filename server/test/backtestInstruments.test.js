'use strict';

/**
 * Section 10.2a's four instruments, landed at the B3 re-cut per the bar
 * paragraph: "The specifications above are the durable half and are in
 * force now"; the scripts are "a convenience that rides with the other
 * batched guards at B3".
 *
 * 10.2a's own meta-requirement governs every test here: an instrument must
 * be VALIDATED AGAINST A KNOWN ANSWER before being trusted - "a second run
 * of a broken probe is not a check", and a probe returning a well-formed
 * empty set is broken, not clean.  The three instruments with sealed known
 * cases run them live against git history; the locator check, whose known
 * answer the spec does not pin, is validated against planted fixtures whose
 * answer is known by construction.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const confinement = require('../../scripts/backtest/instruments/check-confinement');
const locators = require('../../scripts/backtest/instruments/check-locators');
const packet = require('../../scripts/backtest/instruments/check-packet-coverage');
const identifiers = require('../../scripts/backtest/instruments/check-identifier-consistency');

// ---------------------------------------------------------------------------
// Confinement (the PRIMARY check)
// ---------------------------------------------------------------------------

test('confinement: the sealed known case (revision 28 -> 29) returns exactly the recorded set, including the 8.6.0 the prose missed', () => {
  const result = confinement.selfValidate();
  assert.equal(result.ok, true, `expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`);
  assert.ok(result.actual.includes('8.6.0'), 'the omission that established the second direction must be reproduced');
});

test('confinement: hunk parsing splits new-side lines from pure-deletion old-side lines - an empty set from a real diff is a broken probe', () => {
  const diff = [
    '@@ -10,2 +10,3 @@ context',
    '@@ -30 +31 @@ context',
    '@@ -40,5 +41,0 @@ context',
  ].join('\n');
  assert.deepEqual(confinement.changedLineSets(diff), {
    newSide: [10, 11, 12, 31],
    deletedOldSide: [40, 41, 42, 43, 44],
  });
  assert.deepEqual(confinement.changedLineSets('not a diff'), { newSide: [], deletedOldSide: [] });
});

test('confinement: a whole-section deletion is attributed to the DELETED section via the FROM side, so it cannot be claimed byte-identical (adversarial QA)', () => {
  // Mapping deleted lines through the surviving document attributes them to
  // a neighbor; only the FROM side still carries the deleted heading.
  const fromDoc = [
    '# Title',
    '## 4. Kept',
    'body four',
    '## 5. Deleted entirely',
    'body five',
    'more five',
    '## 6. Kept too',
    'body six',
  ];
  const deletedOldSide = [4, 5, 6];
  const sections = confinement.mapLinesToSections(fromDoc, deletedOldSide);
  assert.deepEqual([...sections].sort(), ['5']);
  // The both-direction equality then catches the false claim.
  const claim = confinement.compareAgainstClaims({ actual: ['4', '5'], claimedChanged: ['4'], claimedIdentical: ['5', '6'] });
  assert.equal(claim.ok, false);
});

test('confinement: every heading level maps, including #### subsections and the # title as preamble', () => {
  const doc = [
    '# Title line',
    'preamble text',
    '## 1. First',
    'body one',
    '### 1.1 Sub',
    'body one-one',
    '#### 8.6.0 Deep',
    'body deep',
  ];
  const sections = confinement.mapLinesToSections(doc, [2, 4, 6, 8]);
  assert.deepEqual([...sections].sort(), ['1', '1.1', '8.6.0', 'preamble']);
  assert.equal(confinement.sectionToken('### 10.2a Instrument specifications'), '10.2a');
  assert.equal(confinement.sectionToken('## 0. Classes of addition'), '0');
});

test('confinement: the set equality runs in BOTH directions - a subset check passes the actual defect', () => {
  const actual = ['3.2', '8.6.0'];
  // Direction 1: claimed-identical section changed.
  const identicalViolated = confinement.compareAgainstClaims({ actual, claimedIdentical: ['8.6.0'] });
  assert.equal(identicalViolated.ok, false);
  // Direction 2 (the one that has failed): a changed section absent from the
  // claimed-changed list.
  const omission = confinement.compareAgainstClaims({ actual, claimedChanged: ['3.2'] });
  assert.equal(omission.ok, false);
  assert.match(omission.violations[0], /8\.6\.0 changed but is absent/);
  // Both lists right: clean.
  assert.equal(confinement.compareAgainstClaims({ actual, claimedChanged: actual, claimedIdentical: ['4.6'] }).ok, true);
});

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

function plantedRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-locators-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'planted.js'), [
    '// line 1',
    'function plantedFunction() {',
    '  return 1;',
    '}',
    'module.exports = { plantedFunction };',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'rootLevel.js'), 'const topLevel = 1;\nmodule.exports = { topLevel };\n', 'utf8');
  return root;
}

test('locators: a planted fixture with a known answer - good citations resolve, stale and phantom ones are reported by class', (t) => {
  const root = plantedRepo(t);
  const doc = [
    'Good: `plantedFunction` (`planted.js:2`).',
    'Root-level files resolve too: `topLevel` (`rootLevel.js:1`).',
    'Ranges: `planted.js:2-4` is fine.',
    'Out of range: `planted.js:999`.',
    'Phantom file: `never-existed.js:1`.',
    'Symbol drifted away: `somewhereElseEntirely` (`planted.js:3`).',
  ].join('\n');
  const result = locators.checkLocators({ repoRoot: root, docText: doc });
  assert.equal(result.total, 6);
  const byStatus = Object.groupBy
    ? Object.groupBy(result.failures, (failure) => failure.status)
    : result.failures.reduce((acc, failure) => { (acc[failure.status] ||= []).push(failure); return acc; }, {});
  assert.equal(result.failures.length, 3);
  assert.equal((byStatus['out-of-range'] || []).length, 1);
  assert.equal((byStatus['unresolved-file'] || []).length, 1);
  assert.equal((byStatus['symbol-missing'] || []).length, 1);
});

test('locators: the claim-expression tier catches the G-A form - a line-opening citation whose claimed expression is elsewhere', (t) => {
  const root = plantedRepo(t);
  // The G-A shape: no preceding backticked identifier, claim follows the
  // citation, and the claimed expression's identifiers appear nowhere near
  // the cited line - the citation is in-range but the claim is not there.
  const stale = '`planted.js:3` instead computes `absentHelper(missingValue) > threshold`.';
  const staleRun = locators.checkLocators({ repoRoot: root, docText: stale });
  assert.equal(staleRun.failures.length, 1);
  assert.equal(staleRun.failures[0].status, 'claim-mismatch');
  // Same claim cited at the right line passes on the claim-expression basis.
  const repaired = '`planted.js:2` instead computes `plantedFunction() === 1`.';
  const repairedRun = locators.checkLocators({ repoRoot: root, docText: repaired });
  assert.equal(repairedRun.failures.length, 0);
  assert.equal(repairedRun.results[0].basis, 'claim-expression');
  // A following span that is itself a citation is a cross-reference, not a
  // claim - it must NOT engage the tier.
  const crossRef = 'See `planted.js:5` and then `other.js:12` for the rest.';
  const crossRun = locators.checkLocators({ repoRoot: root, docText: crossRef });
  assert.equal(crossRun.results[0].basis, 'range-only');
});

test('locators: bare `:NNN` citations inherit the in-paragraph file, and historical brackets are exempt', (t) => {
  const root = plantedRepo(t);
  const doc = [
    'The loop in `planted.js:2` runs; `plantedFunction` sits at `:2` too.',
    '',
    'A new paragraph breaks inheritance, so `:4` here is unattributed.',
    'Historical: `planted.js:2` **[locators re-verified at revision 99; `:777` had drifted]** stays quiet.',
  ].join('\n');
  const result = locators.checkLocators({ repoRoot: root, docText: doc });
  // `:2` inherits planted.js and passes on the identifier-window basis;
  // `:4` is unattributed (paragraph break); `:777` is inside a drift
  // bracket and never extracted.
  assert.equal(result.bareTotal, 1);
  assert.equal(result.bareResults[0].status, 'ok');
  assert.equal(result.bareUnattributed, 1);
  assert.equal(result.failures.length, 0);
});

test('locators: self-validation reproduces the sealed G-A escape in both directions', () => {
  const validation = locators.selfValidate();
  assert.equal(validation.staleReported, true, 'the sealed stale citation must be reported');
  assert.equal(validation.repairedPasses, true, 'the corrected citation must pass');
  assert.equal(validation.ok, true);
});

test('locators: run against the real spec - the revision-35 G-A stale locator is the one instrument-visible failure', () => {
  // repoRoot from this file's own location, not the cwd - the suite must
  // pass regardless of the directory it is launched from.
  const result = locators.checkLocators({ repoRoot: path.resolve(__dirname, '..', '..') });
  assert.ok(result.total > 50, `the spec cites code constantly; extracting only ${result.total} citations means the extraction is broken`);
  // The independent review of revision 35 found section 6.1's
  // `arms.js:891-892` citation stale (the comparison lives at :934-935) -
  // finding G-A - and this instrument's old proximity tier could not see
  // it. The claim-expression tier exists because of that escape. The
  // review round's OTHER two stale citations (section 8.7 rule 5's
  // `:305-308`/`:352-354`, the +7 comment shift) live in a multi-part
  // citation's non-head ranges, which carry no testable claim - the
  // semantic sweep found those, not this instrument, and the docblock
  // discloses that limit. This test pins the KNOWN STALE STATE and flips
  // to zero failures when revision 36 repairs the spec text - the same
  // pinned-defect pattern the arms.js:882 case followed into revision 35.
  // Revision 36 repaired all three (plus the out-of-scope preamble and
  // section-0 pair); full cleanliness is the pinned state from here on.
  assert.equal(result.failures.length, 0, `stale spec locators: ${JSON.stringify(result.failures)}`);
});

// ---------------------------------------------------------------------------
// Packet coverage
// ---------------------------------------------------------------------------

test('packet coverage: the sealed known case (revision 32) returns exactly the five missing sections', () => {
  const result = packet.selfValidate();
  assert.equal(result.ok, true, `expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`);
  assert.ok(result.citedCount >= 30, 'a range-blind or scope-blind enumeration undercounts (10.2a requirement 1)');
});

test('packet coverage: ranges expand, specification-section decimals are excluded, and whole-section supply covers subsections', () => {
  const doc = [
    '## 3. Scope section',
    'This rests on prereg 9.3 and prereg 16, and prereg 11 generally.',
    'Also prereg 4.1 and prereg 6.6.',
    '## 9. Out of scope',
    'prereg 1.1 cited here is OUTSIDE sections 3-8 and must not be harvested.',
    '## 11. Packet',
    '- **`PREREGISTRATION.md` sections**: 4.1-4.2 (cohort), 6.6-6.7 (which',
    '  section 4.6 extends per rule 1), 9.1-9.7, 11.1-11.2, 16 (register).',
    '- **Other bullet** ends the supply list.',
  ].join('\n');
  const supplied = packet.supplySet(doc);
  // Ranges expanded (requirement 1)...
  for (const member of ['4.1', '4.2', '6.6', '6.7', '9.1', '9.7', '11.1', '11.2', '16']) {
    assert.ok(supplied.has(member), `${member} must be supplied`);
  }
  // ...and the spec-section annotations NOT harvested (requirement 2).
  assert.equal(supplied.has('4.6'), false, 'a bare-decimal sweep harvests specification numbers out of the dependency annotations');
  assert.equal(supplied.has('1'), false, '"rule 1" is a rule number, not a supply entry');
  const result = packet.packetCoverage(doc);
  // 9.3 covered by the 9.1-9.7 range, 16 exactly, 11 by its supplied
  // members (11.3(a)\'s own prereg-11 ruling), 4.1 exactly, 6.6 exactly.
  assert.deepEqual(result.missing, []);
  // The out-of-scope citation was never harvested.
  assert.equal(result.cited.includes('1.1'), false);
});

test('packet coverage: ranges expand on the CITED side too, and annotation numbers inside parentheses never become supply entries (adversarial QA)', () => {
  // A citation written as a range cites every member.
  const rangeCited = [
    '## 5. Scope',
    'This rests on prereg 9.1-9.3 as a range.',
    '## 11. Packet',
    '- **`PREREGISTRATION.md` sections**: 9.1-9.2.',
    '- **Other**.',
  ].join('\n');
  const rangeResult = packet.packetCoverage(rangeCited);
  assert.ok(rangeResult.cited.includes('9.3'), 'a range-blind citation pattern leaves 9.2-9.7-class members unchecked');
  assert.deepEqual(rangeResult.missing, ['9.3']);

  // An annotation number guarded by a word OUTSIDE the excluded list must
  // still not become a phantom supply entry - depth-0 harvesting, not a
  // word list, is what excludes it.
  const leak = [
    '## 5. Scope',
    'This rests on prereg 4.6 somehow.',
    '## 11. Packet',
    '- **`PREREGISTRATION.md` sections**: 9.1-9.7 (kept per 4.6), 16.',
    '- **Other**.',
  ].join('\n');
  const leakResult = packet.packetCoverage(leak);
  assert.equal(leakResult.supplied.includes('4.6'), false, 'a parenthetical annotation is never a supply entry');
  assert.deepEqual(leakResult.missing, ['4.6']);
});

test('packet coverage: a citation with no supply entry is reported, and zero extracted citations reads as broken, not clean', () => {
  const doc = [
    '## 5. Scope',
    'prereg 13.9 is cited and never supplied.',
    '## 11. Packet',
    '- **`PREREGISTRATION.md` sections**: 4.1-4.2.',
    '- **Other**.',
  ].join('\n');
  const result = packet.packetCoverage(doc);
  assert.deepEqual(result.missing, ['13.9']);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Identifier consistency
// ---------------------------------------------------------------------------

test('identifier consistency: the sealed known case - revision 33\'s preamble reports "31" against an anchor of 33; a clean report on those bytes is a broken probe', () => {
  const result = identifiers.selfValidate();
  assert.equal(result.ok, true, `expected the stale ${result.expectedStale} to be reported, got ${JSON.stringify(result.reported)}`);
});

test('identifier consistency: every hash-shaped token is checked - a presence test is not this check', () => {
  const { gitHashes, digitOnlyCandidates, sha256s } = identifiers.extractTokens([
    'anchored at 0762738 and blob e339020a.',
    'SHA-256 5A0D6E54B2D84494C5D39093C44204A79F32A4DD813F03909C1094339A52BCF8.',
    'the malformed one: deadbeef99 sits on another line.',
    'a bare number 14688 and the seed 1499811874 are not asserted hashes.',
  ].join('\n'));
  assert.ok(gitHashes.includes('e339020a'));
  assert.ok(gitHashes.includes('deadbeef99'), 'every hash-shaped token is a candidate, not just the ones near the right words');
  // An all-digit token is ambiguous between number and hash: `0762738` is a
  // real anchor commit, `1499811874` the bootstrap seed. Candidates, not
  // asserted - they count only when they genuinely resolve.
  assert.ok(digitOnlyCandidates.includes('0762738'));
  assert.ok(digitOnlyCandidates.includes('1499811874'));
  assert.equal(gitHashes.includes('14688'), false, 'a pure-digit run is never an ASSERTED hash');
  assert.equal(sha256s.length, 1);

  const artifact = identifiers.checkArtifact({
    name: 'fixture',
    text: 'valid 0762738 beside the malformed deadbeef99, seed 1499811874, status **Status: revision 34.**',
    expectRevision: 35,
  });
  assert.ok(artifact.unresolvable.includes('deadbeef99'), 'the careless-substitution class: a wrong token must fail even though a correct one resolves elsewhere');
  assert.deepEqual(artifact.resolvedDigitOnly, ['0762738'], 'the all-digit anchor commit resolves and is verified; the seed is a number and is not flagged');
  assert.deepEqual(artifact.staleRevisions, [34]);
  assert.equal(artifact.ok, false);
});

test('identifier consistency: uppercase hashes, capital-R status lines, and truncated SHA-256 prefixes (adversarial QA)', () => {
  // git resolves hex case-insensitively, so an uppercase wrong hash is
  // exactly as hash-shaped as a lowercase one and must fail the same way.
  const upper = identifiers.checkArtifact({ name: 'u', text: 'digest is FFFFFF99 (uppercase, wrong)' });
  assert.ok(upper.unresolvable.includes('ffffff99'), 'a lowercase-only pattern skips the tokens a careless substitution is most likely to mangle');
  // A stale revision must not hide behind a capital R.
  assert.deepEqual(identifiers.extractStatusRevisions('**Status: Revision 31.**'), [31]);
  // A truncated SHA-256 prefix is a digest claim, not a git object - it is
  // recorded and prefix-checked, never asserted against cat-file, because
  // artifacts legitimately quote superseded digests when narrating history.
  const tokens = identifiers.extractTokens('anchored SHA-256 `5EA91A5E...` and prior `16F29146...`');
  assert.deepEqual(tokens.sha256Prefixes.sort(), ['16F29146', '5EA91A5E']);
  assert.deepEqual(tokens.gitHashes, []);
});
