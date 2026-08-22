export function integerRangeError(value, { label, min, max, optional = false }) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return optional ? '' : `${label} is required.`;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    return `${label} must be a whole number between ${min} and ${max}.`;
  }
  if (number < min || number > max) {
    return `${label} must be between ${min} and ${max}.`;
  }
  return '';
}
