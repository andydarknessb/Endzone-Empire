'use strict';

/**
 * Section 10.2a's IDENTIFIER-CONSISTENCY check: for every artifact that
 * quotes the spec's anchor - the preamble itself, the handoff, the memory
 * index, the reviewer scope document, the commission - extract its
 * identifier claims and compare them to `git` at the named anchor.
 *
 * Two properties 10.2a pins:
 *   - it must cover artifacts OUTSIDE the repository (the memory index sat
 *     three revisions stale while every in-repo check returned green), so
 *     `--artifact` takes arbitrary file paths, repeatably;
 *   - it must run BEFORE the anchor commit - the preamble's revision number
 *     is the one element that cannot be derived from `git`, so a post-anchor
 *     check would confirm it against itself.
 *
 * A PRESENCE test is not this check: a correct identifier somewhere in the
 * artifact passes while a wrong second occurrence sits elsewhere.  So EVERY
 * git-hash-shaped token in an artifact must resolve (`git cat-file -e`), and
 * every status-line revision number must equal the expected one.  SHA-256
 * tokens are compared against the anchored document blob's digest and
 * reported; they are informational rather than asserted because artifacts
 * legitimately quote SUPERSEDED hashes when narrating history (the preamble
 * itself quotes revision 18's).
 *
 * SCOPE, stated honestly (claims-fidelity QA on this slice): this scripted
 * form asserts token RESOLVABILITY and status-line revision equality, and
 * REPORTS digest/anchor matches.  It does not assert 10.2a's full tuple
 * equality - deciding WHICH of an artifact's hashes claim to name the
 * current anchor (as opposed to narrating a superseded one) is a reading of
 * prose this script does not attempt, so an artifact naming a
 * wrong-but-existing commit as its anchor passes the scripted form and is
 * caught by the manual half of the check.  The specification's full tuple
 * comparison remains in force as the durable half; this script is its
 * mechanical assistant, not its replacement.
 *
 * Validated against the known case (10.2a's requirement): run against
 * revision 33 (`37b9f7d`) with an expected revision of 33, it must report
 * the preamble at "31".  A run reporting no mismatch on those bytes is
 * broken.  `--self-validate` runs exactly that case.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const DEFAULT_DOC = 'backtest-artifacts/pit-sweep-2024-2025/PHASE5_EXECUTION_SPEC.md';

const KNOWN_CASE = Object.freeze({ rev: '37b9f7d', expectRevision: 33, staleValue: 31 });
const EXPECTED_NON_GIT_TOKENS = Object.freeze([
  '0123456789abcdef0123456789abcdef',
  '879c6f8eae4b',
]);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function gitObjectExists(token) {
  try {
    execFileSync('git', ['cat-file', '-e', token], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Git-hash-shaped tokens: 7-40 lowercase hex.  A token with at least one
 * letter is unambiguously hash-shaped and is ASSERTED to resolve.  An
 * all-digit token is ambiguous - `0762738` is a real anchor commit while
 * `1499811874` is the bootstrap seed - so all-digit tokens of short-hash
 * length are extracted as CANDIDATES and count only when they genuinely
 * resolve; an unresolvable all-digit token reads as a number, never a
 * malformed hash.  64-hex tokens (either case) are SHA-256 claims and are
 * extracted separately - they are not git objects.
 */
function extractTokens(text) {
  const gitHashes = new Set();
  const digitOnlyCandidates = new Set();
  const sha256s = new Set();
  const sha256Prefixes = new Set();
  for (const match of text.matchAll(/\b[0-9a-fA-F]{64}\b/g)) sha256s.add(match[0]);
  // Case-insensitive: git resolves hex case-insensitively, and these
  // artifacts genuinely write uppercase identifiers (`5EA91A5E...`), so a
  // lowercase-only pattern would skip exactly the tokens a careless
  // substitution is most likely to mangle (adversarial QA on this slice).
  // A token immediately followed by a truncation marker (`...`/`…`) is a
  // SHA-256 PREFIX claim, not a git object - asserted against the anchored
  // document digest when one is available, never against `git cat-file`.
  for (const match of text.matchAll(/\b[0-9a-fA-F]{7,63}\b/g)) {
    const token = match[0];
    if (!/[0-9]/.test(token)) continue;
    const truncated = /^(\.{3}|…)/.test(text.slice(match.index + token.length));
    if (truncated) {
      if (/[a-fA-F]/.test(token)) sha256Prefixes.add(token);
      continue;
    }
    if (token.length > 40) continue;
    if (/[a-fA-F]/.test(token)) gitHashes.add(token.toLowerCase());
    else if (token.length <= 12) digitOnlyCandidates.add(token);
  }
  return {
    gitHashes: [...gitHashes],
    digitOnlyCandidates: [...digitOnlyCandidates],
    sha256s: [...sha256s],
    sha256Prefixes: [...sha256Prefixes],
  };
}

/** Every `Status: revision N` status-line claim, case-insensitive on `revision` - a stale number must not hide behind a capital R. */
function extractStatusRevisions(text) {
  const statuses = [];
  for (const match of text.matchAll(/Status:\s*revision\s+(\d+)/gi)) statuses.push(Number(match[1]));
  return statuses;
}

function checkArtifact({ name, text, expectRevision, anchoredDocSha256 }) {
  const { gitHashes, digitOnlyCandidates, sha256s, sha256Prefixes } = extractTokens(text);
  const unresolvable = gitHashes.filter((token) => !gitObjectExists(token));
  const expectedNonGitTokens = unresolvable.filter((token) => EXPECTED_NON_GIT_TOKENS.includes(token));
  const unexpectedUnresolvable = unresolvable.filter((token) => !EXPECTED_NON_GIT_TOKENS.includes(token));
  const resolvedDigitOnly = digitOnlyCandidates.filter((token) => gitObjectExists(token));
  const prefixMatches = anchoredDocSha256
    ? sha256Prefixes.filter((token) => anchoredDocSha256.toUpperCase().startsWith(token.toUpperCase()))
    : [];
  const statusRevisions = extractStatusRevisions(text);
  const staleRevisions = expectRevision === undefined
    ? []
    : statusRevisions.filter((revision) => revision !== expectRevision);
  const sha256Matches = anchoredDocSha256
    ? sha256s.filter((token) => token.toUpperCase() === anchoredDocSha256.toUpperCase())
    : [];
  return {
    artifact: name,
    hashTokens: gitHashes.length + resolvedDigitOnly.length,
    resolvedDigitOnly,
    unresolvable,
    expectedNonGitTokens,
    unexpectedUnresolvable,
    statusRevisions,
    staleRevisions,
    sha256Tokens: sha256s.length,
    sha256Matches,
    // Prefix claims (`5EA91A5E...`) are reported, with matches against the
    // anchored digest when one was supplied; not asserted, because artifacts
    // legitimately quote SUPERSEDED revision digests when narrating history.
    sha256Prefixes,
    sha256PrefixMatches: prefixMatches,
    ok: unexpectedUnresolvable.length === 0 && staleRevisions.length === 0,
  };
}

function checkArtifacts({ artifacts, expectRevision, anchor, doc = DEFAULT_DOC }) {
  let anchoredDocSha256 = null;
  if (anchor) {
    const bytes = execFileSync('git', ['show', `${anchor}:${doc}`], { maxBuffer: 64 * 1024 * 1024 });
    anchoredDocSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  const results = artifacts.map(({ name, text }) => checkArtifact({ name, text, expectRevision, anchoredDocSha256 }));
  return { anchoredDocSha256, results, ok: results.every((result) => result.ok) };
}

function selfValidate() {
  const text = git(['show', `${KNOWN_CASE.rev}:${DEFAULT_DOC}`]);
  const outcome = checkArtifacts({
    artifacts: [{ name: `revision-33 preamble (${KNOWN_CASE.rev})`, text }],
    expectRevision: KNOWN_CASE.expectRevision,
    anchor: KNOWN_CASE.rev,
  });
  const [result] = outcome.results;
  // The known case is a NEGATIVE control: the instrument must REPORT the
  // stale "31" - a clean report on those bytes means the instrument is
  // broken, not the artifact consistent.
  const ok = result.staleRevisions.includes(KNOWN_CASE.staleValue) && !result.ok;
  return { ok, reported: result.staleRevisions, expectedStale: KNOWN_CASE.staleValue };
}

function main(argv) {
  const args = { artifacts: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--artifact') args.artifacts.push(argv[++i]);
    else if (token === '--expect-revision') args.expectRevision = Number(argv[++i]);
    else if (token === '--anchor') args.anchor = argv[++i];
    else if (token === '--doc') args.doc = argv[++i];
    else if (token === '--self-validate') args.selfValidate = true;
    else throw new Error(`check-identifier-consistency: unknown argument ${token}`);
  }
  if (args.selfValidate) {
    const result = selfValidate();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error('check-identifier-consistency: SELF-VALIDATION FAILED - a run reporting no mismatch on revision 33\'s bytes is broken');
      return 1;
    }
    return 0;
  }
  if (args.artifacts.length === 0) throw new Error('check-identifier-consistency: at least one --artifact is required (or --self-validate)');
  const artifacts = args.artifacts.map((file) => ({ name: file, text: fs.readFileSync(file, 'utf8') }));
  const outcome = checkArtifacts({ artifacts, expectRevision: args.expectRevision, anchor: args.anchor, doc: args.doc });
  console.log(JSON.stringify(outcome, null, 2));
  return outcome.ok ? 0 : 1;
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
  DEFAULT_DOC, KNOWN_CASE, EXPECTED_NON_GIT_TOKENS, extractTokens, extractStatusRevisions,
  checkArtifact, checkArtifacts, selfValidate, main,
};
