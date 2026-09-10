import { finite, formatPoints } from './numeric';

describe('finite', () => {
  test('reads a number and a PostgreSQL DECIMAL string alike', () => {
    expect(finite(92.1)).toBe(92.1);
    expect(finite('92.14')).toBe(92.14);
  });

  test('numeric zero is valid, not unknown', () => {
    expect(finite(0)).toBe(0);
    expect(finite('0')).toBe(0);
  });

  test('null, undefined, an empty string, NaN and infinities are all unknown', () => {
    expect(finite(null)).toBeNull();
    expect(finite(undefined)).toBeNull();
    expect(finite('')).toBeNull();
    expect(finite(NaN)).toBeNull();
    expect(finite(Infinity)).toBeNull();
    expect(finite(-Infinity)).toBeNull();
    expect(finite('not a number')).toBeNull();
  });
});

describe('formatPoints', () => {
  test('renders one decimal for a known value, numeric zero included', () => {
    expect(formatPoints('92.14')).toBe('92.1');
    expect(formatPoints(118)).toBe('118.0');
    expect(formatPoints(0)).toBe('0.0');
    expect(formatPoints('0')).toBe('0.0');
  });

  test('renders a dash for unknown input, an empty string included', () => {
    expect(formatPoints(null)).toBe('-');
    expect(formatPoints(undefined)).toBe('-');
    expect(formatPoints('')).toBe('-');
    expect(formatPoints(NaN)).toBe('-');
    expect(formatPoints(Infinity)).toBe('-');
  });
});
