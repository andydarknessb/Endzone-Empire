import { teamNameLabel, teamRowKey, isLeagueCreator, FORMER_MANAGER_LABEL, TEAM_IDENTITY_FIELDS } from './teamIdentity';
// The server mirror is a pure module (no requires), so importing it here to
// compare the two exports directly is safe and cheap.
// eslint-disable-next-line import/no-relative-packages
const serverTeamIdentity = require('../../server/services/teamIdentity');

test('TEAM_IDENTITY_FIELDS mirrors the server export exactly, by import not by source text (#341)', () => {
  // The client half of "a test in each module asserts the two exports are equal"
  // (#341 AC1). It imports BOTH exports and compares them, so a drift in either
  // is a hard failure here - unlike a read of the source text, which a comment
  // decoy could make pass silently. The server suite pins the server export to
  // the same literal, so the two are pinned equal transitively as well.
  expect([...TEAM_IDENTITY_FIELDS]).toEqual(['teamId', 'teamName']);
  expect(Object.isFrozen(TEAM_IDENTITY_FIELDS)).toBe(true);
  expect([...TEAM_IDENTITY_FIELDS]).toEqual([...serverTeamIdentity.TEAM_IDENTITY_FIELDS]);
});

test('a Team name is shown as it is', () => {
  expect(teamNameLabel('Anvils')).toBe('Anvils');
});

test('an author whose Team identity is null reads as a former manager, never blank or "null"', () => {
  // League-shared reads join teams LEFT on purpose (server/services/teamIdentity.js)
  // so a manager who has left the league keeps their chat and pick'em history.
  // Their Team identity comes back null, and there is no account field left to
  // fall back to, so this label is the only thing standing between the reader
  // and a blank chip.
  for (const missing of [null, undefined, '', '   ']) {
    expect(teamNameLabel(missing)).toBe(FORMER_MANAGER_LABEL);
  }
  expect(teamNameLabel(null)).not.toBe('null');
});

test('the label is neutral copy and carries no em-dash', () => {
  expect(FORMER_MANAGER_LABEL).toBe('Former manager');
  expect(FORMER_MANAGER_LABEL).not.toMatch(/—/);
});

test('a row is keyed by its Team ID', () => {
  expect(teamRowKey(42, 3)).toBe(42);
});

test('a row with no Team ID falls back to its position, not to a shared null', () => {
  // Two departed managers in one list would otherwise collide on the same key.
  expect(teamRowKey(null, 0)).toBe('former-0');
  expect(teamRowKey(undefined, 1)).toBe('former-1');
  expect(teamRowKey(null, 0)).not.toBe(teamRowKey(null, 1));
});

test('the league creator is recognised by Team, not by account', () => {
  expect(isLeagueCreator({ ownerTeamId: 7 }, 7)).toBe(true);
  expect(isLeagueCreator({ ownerTeamId: 7 }, 8)).toBe(false);
});

test('two absent Teams are not the same manager', () => {
  // A creator who has left their own league reads ownerTeamId null, and a
  // reader with no Team on this league reads viewerTeamId null. Matching
  // those would hand every such reader the two powers the creator cannot
  // delegate: deleting the league, and granting co-commissioner.
  expect(isLeagueCreator({ ownerTeamId: null }, null)).toBe(false);
  expect(isLeagueCreator({ ownerTeamId: null }, 7)).toBe(false);
  expect(isLeagueCreator({ ownerTeamId: 7 }, null)).toBe(false);
  expect(isLeagueCreator(null, 7)).toBe(false);
});
