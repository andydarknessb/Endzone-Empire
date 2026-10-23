const ABOVE = 1.25;
const BELOW = 0.75;

/** 'above' | 'typical' | 'below' for `value` against the played rows' `values` of one column. A zero average is typical. */
export function gameLogTone(value, values) {
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (!(average > 0)) return 'typical';
  if (value >= average * ABOVE) return 'above';
  if (value <= average * BELOW) return 'below';
  return 'typical';
}
