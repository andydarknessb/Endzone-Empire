/**
 * The server half of #188's guard: every identity comparison under
 * server/routes, server/services and server/modules is on the allowlist with
 * the rule it implements.
 *
 * The client half is src/lib/identityComparisonGuard.test.js, and it has to be
 * a separate file because it has to run in a separate SUITE. `npm run
 * test:server` never loads anything under src/, and the CRA suite never loads
 * anything under server/test. A single guard test in either place would be
 * green while half of what it guards went unscanned - which is the exact
 * failure mode #188 is about, one level up.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWLIST,
  SERVER_ROOTS,
  check,
  findComparisons,
} = require('../../scripts/check-identity-comparisons');

test('every server identity comparison is allowlisted with a rule', () => {
  const { unlisted, stale } = check(SERVER_ROOTS, { includeUsername: false });

  assert.deepEqual(
    unlisted,
    [],
    'A comparison of owner_id (or a leagues-scoped owner_id in SQL) appeared with no rule '
    + 'recorded. Read leagueRole.service.js\'s module docstring, decide which rule it '
    + 'implements, and add it to ALLOWLIST in scripts/check-identity-comparisons.js.'
  );
  assert.deepEqual(
    stale,
    [],
    'An allowlist entry no longer matches any code. An allowlist that outlives its '
    + 'comparisons stops describing the codebase, which is how the next reader is misled.'
  );
});

test('every allowlist entry names a rule', () => {
  for (const entry of ALLOWLIST) {
    assert.ok(entry.file, 'an allowlist entry has no file');
    assert.ok(entry.code, `${entry.file}: an allowlist entry has no code`);
    assert.ok(
      typeof entry.rule === 'string' && entry.rule.trim().length > 20,
      `${entry.file}: \`${entry.code}\` has no rule worth reading. The rule is the entry's `
      + 'whole purpose: if it cannot be written down, that is the finding.'
    );
  }
});

// The guard has to actually catch something, and the mutant below is the exact
// shape #188 says a regex cannot judge: `x.owner_id === y.owner_id` is correct
// in leagueRole.service and was wrong in commissioner.service. The guard does
// not claim to tell them apart. It claims that neither can appear without
// someone writing down which one it is.
test('catches a new unlisted owner_id comparison', () => {
  const mutant = 'function mayRemove(team, league) {\n  return team.owner_id === league.owner_id;\n}\n';
  const found = findComparisons(mutant, { includeUsername: false });

  assert.deepEqual(found, [{ code: 'team.owner_id === league.owner_id', line: 2 }]);
});

test('catches a leagues-scoped owner comparison in SQL, qualified or not', () => {
  const qualified = findComparisons('  `SELECT 1 FROM "x" WHERE "leagues"."owner_id" = $1`\n', { includeUsername: false });
  assert.equal(qualified.length, 1);

  // The unqualified form is the one these queries actually use, and the one a
  // `"leagues"."owner_id"` pattern would have missed entirely.
  const bare = findComparisons('  `DELETE FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`\n', { includeUsername: false });
  assert.equal(bare.length, 1);
});

// The everyday membership lookup is deliberately out of scope. Twenty-odd of
// these exist; listing them would bury the handful that decide a role.
test('leaves a teams-scoped owner lookup alone', () => {
  const found = findComparisons('  `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`\n', { includeUsername: false });
  assert.deepEqual(found, []);
});

test('a null guard is not an identity comparison', () => {
  const found = findComparisons('const named = teams.filter((t) => t.owner_id != null);\n', { includeUsername: false });
  assert.deepEqual(found, []);
});

// DraftBoard.jsx carries a comment quoting `league.owner_id === user.id` in
// order to say the fallback was deliberately REMOVED. Reporting that as the
// thing it warns about would be the guard's own false positive, and #188 says
// plainly that a sweep whose first finding is a false positive is one nobody
// finishes.
test('a comparison quoted inside a comment is not a comparison', () => {
  const commented = [
    '// the `league.owner_id === user.id` fallback is deliberately gone',
    '/* team.owner_id === league.owner_id */',
    'const isCommissioner = resp.isCommissioner === true;',
    '',
  ].join('\n');

  assert.deepEqual(findComparisons(commented, { includeUsername: false }), []);
});

// The server's only username comparison is privacy.service's typed
// confirmation phrase, which #188 puts out of scope by name. Scanning for it
// here would teach the reader that a username comparison is ordinary server
// code; on the client, where #185 happened, it is not.
test('username comparisons are a client-side rule, not a server-side one', () => {
  const line = 'if (confirmation !== user.username) throw new Error("nope");\n';

  assert.deepEqual(findComparisons(line, { includeUsername: false }), []);
  assert.equal(findComparisons(line, { includeUsername: true }).length, 1);
});
