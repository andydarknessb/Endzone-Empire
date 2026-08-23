/**
 * The client half of #188's guard: every identity comparison under src/ is on
 * the allowlist with the rule it implements.
 *
 * This runs in the CRA suite, and its server twin
 * (server/test/identityComparisonGuard.test.js) runs under `npm run
 * test:server`. Two files rather than one because the two suites do not
 * overlap: neither loads the other's tree, so a single guard test would be
 * green while half of what it guards went unscanned.
 *
 * The client scan additionally looks for username comparisons, which the
 * server scan does not. That asymmetry is deliberate and #185 is why: the
 * removable-teams guard answered "which team is mine" with `team.owner !==
 * user.username` and was uncovered by 45 tests. The server's only username
 * comparison is a typed confirmation phrase, which #188 puts out of scope.
 */
const {
  CLIENT_ROOTS,
  check,
  findComparisons,
} = require('../../scripts/check-identity-comparisons');

test('every client identity comparison is allowlisted with a rule', () => {
  const { unlisted, stale } = check(CLIENT_ROOTS, { includeUsername: true });

  // Printed rather than asserted bare, because the failure message IS the
  // instruction: the reader needs to know which comparison and which file.
  expect(unlisted).toEqual([]);
  expect(stale).toEqual([]);
});

test('catches a component that rebuilds owner-ness from an account id', () => {
  // The exact comparison src/lib/teamIdentity.js's header says it replaces.
  const mutant = 'const isOwner = user.id === league.owner_id;\n';

  expect(findComparisons(mutant, { includeUsername: true })).toEqual([
    { code: 'user.id === league.owner_id', line: 1 },
  ]);
});

test('catches a display string standing in for identity (#185)', () => {
  const mutant = 'const mine = teams.filter((team) => team.owner !== user.username);\n';

  expect(findComparisons(mutant, { includeUsername: true })).toEqual([
    { code: 'team.owner !== user.username', line: 1 },
  ]);
});

// The contract comparison, the one every migrated surface makes, must never be
// reported: a guard that fires on the correct answer is a guard people turn
// off.
test('leaves the contract comparison alone', () => {
  const contract = [
    'const mine = teams.find((team) => team.teamId === viewerTeamId);',
    'const isCreator = league.ownerTeamId === viewerTeamId;',
    'const isCommissioner = league.is_commissioner === true;',
    '',
  ].join('\n');

  expect(findComparisons(contract, { includeUsername: true })).toEqual([]);
});
