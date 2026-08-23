import { teamNameLabel, teamRowKey, FORMER_MANAGER_LABEL } from './teamIdentity';

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
