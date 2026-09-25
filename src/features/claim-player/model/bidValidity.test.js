import { isValidBid, bidHelperText } from './bidValidity';

test.each([
  ['2.5', 85, false],
  ['', 85, false],
  ['-1', 85, false],
  ['86', 85, false],
  ['abc', 85, false],
  ['0', 85, true],
  ['85', 85, true],
  [40, 85, true],
])('isValidBid(%p against %p) is %p', (bid, faabRemaining, expected) => {
  expect(isValidBid({ bid, faabRemaining })).toBe(expected);
});

test('bidHelperText names a whole-dollar range', () => {
  expect(bidHelperText(85)).toBe('Enter a whole-dollar bid between $0 and $85');
});
