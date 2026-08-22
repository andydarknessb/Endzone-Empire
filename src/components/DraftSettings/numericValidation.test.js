import { integerRangeError } from './numericValidation';

test('accepts inclusive integer boundaries', () => {
  expect(integerRangeError(0, { label: 'Value', min: 0, max: 10 })).toBe('');
  expect(integerRangeError('10', { label: 'Value', min: 0, max: 10 })).toBe('');
});

test.each([NaN, Infinity, -Infinity, 1.5, 'not-a-number'])('rejects non-finite and non-integer input: %s', (value) => {
  expect(integerRangeError(value, { label: 'Value', min: 0, max: 10 })).toMatch(/whole number/);
});

test('rejects values outside the inclusive range and permits optional blanks', () => {
  expect(integerRangeError(-1, { label: 'Value', min: 0, max: 10 })).toBe('Value must be between 0 and 10.');
  expect(integerRangeError(11, { label: 'Value', min: 0, max: 10 })).toBe('Value must be between 0 and 10.');
  expect(integerRangeError('', { label: 'Value', min: 0, max: 10, optional: true })).toBe('');
});
