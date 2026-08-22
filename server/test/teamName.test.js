const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM_NAME_MAX,
  TEAM_NAME_REQUIRED,
  TEAM_NAME_TOO_LONG,
  validateTeamName,
} = require('../services/teamName');

test('validateTeamName trims and accepts a normal name', () => {
  assert.deepEqual(validateTeamName('  Eve Picks  '), { value: 'Eve Picks' });
});

test('validateTeamName accepts a name at exactly the 120-character boundary', () => {
  const name = 'x'.repeat(TEAM_NAME_MAX);
  assert.deepEqual(validateTeamName(name), { value: name });
});

test('validateTeamName refuses missing, blank and whitespace-only names', () => {
  assert.deepEqual(validateTeamName(undefined), { error: TEAM_NAME_REQUIRED });
  assert.deepEqual(validateTeamName(null), { error: TEAM_NAME_REQUIRED });
  assert.deepEqual(validateTeamName(''), { error: TEAM_NAME_REQUIRED });
  assert.deepEqual(validateTeamName('   '), { error: TEAM_NAME_REQUIRED });
  assert.deepEqual(validateTeamName('\t\n'), { error: TEAM_NAME_REQUIRED });
});

test('validateTeamName refuses a non-string value without throwing', () => {
  assert.deepEqual(validateTeamName(42), { error: TEAM_NAME_REQUIRED });
  assert.deepEqual(validateTeamName({}), { error: TEAM_NAME_REQUIRED });
  assert.deepEqual(validateTeamName(['x']), { error: TEAM_NAME_REQUIRED });
});

test('validateTeamName refuses a name over 120 characters after trimming', () => {
  const tooLong = `  ${'x'.repeat(TEAM_NAME_MAX + 1)}  `;
  assert.deepEqual(validateTeamName(tooLong), { error: TEAM_NAME_TOO_LONG });
});

test('validateTeamName never rejects a duplicate: it has no notion of uniqueness at all', () => {
  // Nothing to assert against a database here; this pins the contract that
  // this module takes no "existing names" input and therefore cannot refuse
  // on that basis (CONTEXT.md's Team identity: a duplicate name is still
  // valid identity).
  assert.equal(validateTeamName.length, 1);
});
