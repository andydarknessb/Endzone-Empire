import { parseRosterSlots } from './rosterSlots';

describe('parseRosterSlots', () => {
  test('an array is returned as-is', () => {
    const slots = [{ key: 'QB', count: 1 }];
    expect(parseRosterSlots(slots)).toBe(slots);
  });

  test('a JSON-string array parses to the array it encodes', () => {
    expect(parseRosterSlots('[{"key":"QB","count":1}]')).toEqual([{ key: 'QB', count: 1 }]);
  });

  test('a malformed string returns [] without throwing', () => {
    expect(() => parseRosterSlots('{not json')).not.toThrow();
    expect(parseRosterSlots('{not json')).toEqual([]);
  });

  test('a JSON string that parses to a non-array (an object) returns []', () => {
    expect(parseRosterSlots('{"key":"QB"}')).toEqual([]);
  });

  test('null and undefined return []', () => {
    expect(parseRosterSlots(null)).toEqual([]);
    expect(parseRosterSlots(undefined)).toEqual([]);
  });

  test('a plain object (not a string) returns []', () => {
    expect(parseRosterSlots({ key: 'QB', count: 1 })).toEqual([]);
  });

  test('a number returns []', () => {
    expect(parseRosterSlots(42)).toEqual([]);
  });
});
