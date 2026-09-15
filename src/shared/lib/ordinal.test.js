import { ordinal } from './ordinal';

describe('ordinal', () => {
  test.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [111, '111th'],
  ])('%s -> %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });

  test('is null for a non-rank', () => {
    expect(ordinal(0)).toBeNull();
    expect(ordinal(-3)).toBeNull();
    expect(ordinal(NaN)).toBeNull();
    expect(ordinal('3')).toBeNull();
    expect(ordinal(null)).toBeNull();
  });
});
