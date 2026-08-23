import { teamDisplayName, FORMER_MANAGER_LABEL } from './teamIdentity';

test('a Team name is shown as it is', () => {
  expect(teamDisplayName('Anvils')).toBe('Anvils');
});

test('an author whose Team identity is null reads as a former manager, never blank or "null"', () => {
  // League-shared reads join teams LEFT on purpose (server/services/teamIdentity.js)
  // so a manager who has left the league keeps their chat and pick'em history.
  // Their Team identity comes back null, and there is no account field left to
  // fall back to, so this label is the only thing standing between the reader
  // and a blank chip.
  for (const missing of [null, undefined, '', '   ']) {
    expect(teamDisplayName(missing)).toBe(FORMER_MANAGER_LABEL);
  }
  expect(teamDisplayName(null)).not.toBe('null');
});

test('the label is neutral copy and carries no em-dash', () => {
  expect(FORMER_MANAGER_LABEL).toBe('Former manager');
  expect(FORMER_MANAGER_LABEL).not.toMatch(/—/);
});
