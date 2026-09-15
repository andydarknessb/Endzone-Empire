import { isRosterAtCapacity } from './rosterCapacity';

test('full when count meets or exceeds capacity', () => {
  expect(isRosterAtCapacity({ rosterCount: 16, rosterCapacity: 16 })).toBe(true);
  expect(isRosterAtCapacity({ rosterCount: 17, rosterCapacity: 16 })).toBe(true);
  expect(isRosterAtCapacity({ rosterCount: '16', rosterCapacity: 16 })).toBe(true);
});

test('not full with room, and never full when either number is missing', () => {
  expect(isRosterAtCapacity({ rosterCount: 8, rosterCapacity: 14 })).toBe(false);
  expect(isRosterAtCapacity({ rosterCount: 16 })).toBe(false);
  expect(isRosterAtCapacity({ rosterCapacity: 16 })).toBe(false);
  expect(isRosterAtCapacity(undefined)).toBe(false);
  expect(isRosterAtCapacity(null)).toBe(false);
});
