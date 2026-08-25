const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
 * source of those two strings in each module, and these tests are what make it
 * the enforcement rather than more prose:
 *
 *  - the server export is exactly the two wire keys, and frozen;
 *  - the SQL aliases and the identity object are MINTED from it, so neither can
 *    drift from the contract; and
 *  - the client mirror exports the identical list, so the two halves of the
 *    contract cannot drift from each other.
 *
 * The last check reads the client SOURCE rather than importing it: the client
 * module is ESM under a React build and this suite is CommonJS under
 * `node --test`, so a require would not resolve. Reading the source and pinning
 * the literal is the same technique teamIdentityContracts.test.js already uses
 * to assert the join-refusal codes against draftSocket.js' source, and it keeps
 * BOTH modules' equality assertions in the server suite so the client jest
 * count is untouched by this server-side ticket (#341 removes nothing).
 */

const CLIENT_MODULE = path.join(__dirname, '..', '..', 'src', 'lib', 'teamIdentity.js');

/** The array literal a module froze into TEAM_IDENTITY_FIELDS, read from source. */
function fieldsFromSource(file) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/TEAM_IDENTITY_FIELDS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/);
  assert.ok(match, `${path.basename(file)} exports a frozen TEAM_IDENTITY_FIELDS array`);
  // Cannot pass vacuously: an empty capture yields [], which is not the two.
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

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

test('the client mirror exports the identical list, so the two contracts cannot drift', () => {
  assert.deepEqual(fieldsFromSource(CLIENT_MODULE), [...TEAM_IDENTITY_FIELDS]);
});
