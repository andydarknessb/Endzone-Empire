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
  scan,
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

// The test above passes trivially if the scan found nothing at all - a broken
// walk, a bad root, an extension filter that matches no file would each make
// it green while guarding nothing. These two pin the scan against the real
// tree from the other side: it must FIND comparisons, and it must NOTICE an
// entry that describes none.
test('the server scan actually reaches the source tree', () => {
  const { unlisted } = check(SERVER_ROOTS, { includeUsername: false, allowlist: [] });

  assert.ok(
    unlisted.length >= 10,
    `with an empty allowlist the scan must report every comparison it finds; got ${unlisted.length}`
  );
  // The three sanctioned owner-shaped actions must each be among them, or the
  // scan is missing the very shapes the guard exists for.
  assert.ok(unlisted.some((v) => v.includes('server/services/commissioner.service.js')));
  assert.ok(unlisted.some((v) => v.includes('server/services/leagueRole.service.js')));
  assert.ok(unlisted.some((v) => v.startsWith('server/routes/league.router.js')));
});

test('the scanner refuses a root outside its fixed source-tree allowlist', () => {
  assert.throws(
    () => scan(['../'], { includeUsername: false }),
    /scan root is not allowed/
  );
});

test('an allowlist entry describing no code is reported as stale', () => {
  const { stale } = check(SERVER_ROOTS, {
    includeUsername: false,
    allowlist: [{
      file: 'server/services/commissioner.service.js',
      code: 'team.owner_id === somethingThatIsNotThere',
      rule: 'a rule for a comparison that does not exist',
    }],
  });

  assert.equal(stale.length, 1);
  assert.match(stale[0], /no longer present/);
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

// The class #188 found that no comparison rule can see: addressing one
// recipient by a league's owner id. Both instances resolved the COMMISSIONER
// role as the creator, so a co-commissioner holding the very power the alert
// was about never heard it - and nothing throws when a notification reaches
// too few people, so the class has no failure mode of its own.
test('catches a commissioner alert addressed to the creator alone', () => {
  const mutant = [
    'await notify(client, {',
    '  userId: league.owner_id,',
    '  message: `Review the bracket with your commissioner tools.`,',
    '});',
    '',
  ].join('\n');

  const found = findComparisons(mutant, { includeUsername: false });
  assert.equal(found.length, 1);
  assert.match(found[0].code, /^NOTIFY userId: league\.owner_id,$/);
});

// notifyCommissioners takes `ownerId:` and fans out from there, so the fixed
// shape must NOT be reported - a guard that fires on the correct answer is a
// guard people turn off.
test('leaves the fanned-out form alone', () => {
  const fixed = 'await notifyCommissioners(client, { leagueId, ownerId: league.owner_id, type: "x" });\n';

  assert.deepEqual(findComparisons(fixed, { includeUsername: false }), []);
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
