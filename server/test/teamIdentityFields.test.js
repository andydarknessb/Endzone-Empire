const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM_IDENTITY_FIELDS,
  teamIdentityOf,
  teamIdentityColumns,
} = require('../services/teamIdentity');

/**
 * The Team identity field list, exported and pinned (#200, folded into #115).
 *
 * CONTEXT.md's Team identity rule is that every league-shared surface names a
 * participant by `teamId` / `teamName` and nothing account-shaped. Until this
 * ticket the rule lived in prose in both `server/services/teamIdentity.js` and
 * its client mirror `src/lib/teamIdentity.js`, and only the server's SQL helper
 * actually enforced the spelling. `TEAM_IDENTITY_FIELDS` is now the single
 * source of those two strings in each module. This suite owns the SERVER half:
 *
 *  - the server export is exactly the two wire keys, and frozen; and
 *  - the SQL aliases and the identity object are MINTED from it, so neither can
 *    drift from the contract.
 *
 * The cross-module equality - that the client mirror exports the identical list
 * - is pinned on the CLIENT side, in src/lib/teamIdentity.test.js, which imports
 * BOTH exports and compares them directly. That is stronger than reading the
 * client source from here would be (a source read can pass silently against a
 * comment decoy), and it needs no ESM/CJS bridge. Because that test asserts the
 * client export against the same literal this one asserts the server export
 * against, the two are pinned equal transitively as well.
 */

test('the server export is exactly the two Team identity wire keys, frozen', () => {
  assert.deepEqual(TEAM_IDENTITY_FIELDS, ['teamId', 'teamName']);
  assert.equal(Object.isFrozen(TEAM_IDENTITY_FIELDS), true, 'the shared list cannot be mutated');
});

test('teamIdentityOf names its keys from the exported list, not from restated strings', () => {
  // The object a payload carries is keyed by the field list itself, so it can
  // never name a key the contract does not.
  assert.deepEqual(Object.keys(teamIdentityOf({ id: 5, name: 'Aces' })).sort(), [...TEAM_IDENTITY_FIELDS].sort());
  assert.deepEqual(Object.keys(teamIdentityOf(null)).sort(), [...TEAM_IDENTITY_FIELDS].sort());
  assert.deepEqual(teamIdentityOf({ id: 5, name: 'Aces' }), { teamId: 5, teamName: 'Aces' });
});

test('teamIdentityColumns mints its aliases from the exported list', () => {
  const [idField, nameField] = TEAM_IDENTITY_FIELDS;
  assert.match(teamIdentityColumns(), new RegExp(`AS "${idField}", .* AS "${nameField}"`));
  // The prefixed form (the league creator's `ownerTeamId` / `ownerTeamName`) is
  // the same two source strings with a prefix, so it cannot drift either.
  const cap = (f) => `${f[0].toUpperCase()}${f.slice(1)}`;
  assert.match(
    teamIdentityColumns('owner_team', 'owner'),
    new RegExp(`AS "owner${cap(idField)}", .* AS "owner${cap(nameField)}"`)
  );
});
