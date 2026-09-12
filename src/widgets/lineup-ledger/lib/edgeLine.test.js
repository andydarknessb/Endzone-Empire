import { EDGE_LINE_KINDS, edgeLineColor } from './edgeLine';

test('every Edge line kind gets its own colour (AC3, no two kinds share one)', () => {
  const colors = EDGE_LINE_KINDS.map(edgeLineColor);
  expect(new Set(colors).size).toBe(EDGE_LINE_KINDS.length);
});

test('an unknown kind falls back to dash-faint rather than throwing', () => {
  expect(edgeLineColor('nonsense')).toBe('var(--dash-faint)');
});
