/**
 * CSS custom-property name for a fantasy position's data-encoding color. Maps
 * to the `--pos-*` tokens in tokens.js (same palette the authed app uses), so
 * public position chips stay consistent with the rest of the product and
 * theme-aware in both light and dark.
 */
export function positionColorVar(position) {
  const key = String(position || '').toLowerCase();
  const known = ['qb', 'rb', 'wr', 'te', 'k', 'def'];
  return known.includes(key) ? `var(--pos-${key})` : 'var(--pos-idp)';
}
