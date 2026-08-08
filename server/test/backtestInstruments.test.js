'use strict';

/**
 * Section 10.2a's four instruments, landed at the B3 re-cut per the bar
 * paragraph ("the specifications above are the durable half ... the scripts
 * ride with the other batched guards at B3").
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

test('confinement: hunk parsing covers additions, replacements, and pure deletions - an empty set from a real diff is a broken probe', () => {
  const diff = [
    '@@ -10,2 +10,3 @@ context',
    '@@ -30 +31 @@ context',
    '@@ -40,5 +41,0 @@ context',
  ].join('\n');
  // 10,11,12 (three new lines), 31 (one line), 41 (deletion mapped to the
  // surviving line, never dropped).
  assert.deepEqual(confinement.changedNewSideLines(diff), [10, 11, 12, 31, 41]);
  assert.deepEqual(confinement.changedNewSideLines('not a diff'), []);
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

test('locators: run against the real spec it extracts citations and knows the one currently-stale locator (arms.js:882, riding to revision 35)', () => {
  const result = locators.checkLocators({ repoRoot: process.cwd() });
  assert.ok(result.total > 50, `the spec cites code constantly; extracting only ${result.total} citations means the extraction is broken`);
  // The step-2 tree moved component-(f) code, so the spec's revision-34
  // locator for `weeksBelowFalsifiabilityFloor` is genuinely stale.  This
  // pin DOCUMENTS the known defect the revision-35 drafting step must repair
  // - when it is repaired, update this to assert full cleanliness.
  const stale = result.failures.filter((failure) => failure.identifier === 'weeksBelowFalsifiabilityFloor');
  assert.equal(stale.length, 1, `expected exactly the one known stale locator, got ${JSON.stringify(result.failures)}`);
  assert.equal(result.failures.length, 1);
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
