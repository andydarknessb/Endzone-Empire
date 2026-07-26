import { SCORING_FORMATS, DEFAULT_FORMAT, formatLabel, pointsFor } from './scoringFormat';

test('exposes exactly the three public formats with half-PPR as default', () => {
  expect(SCORING_FORMATS.map((f) => f.id)).toEqual(['standard', 'halfPpr', 'ppr']);
  expect(DEFAULT_FORMAT).toBe('halfPpr');
});

test('formatLabel names each format and falls back to Half-PPR', () => {
  expect(formatLabel('standard')).toBe('Standard');
  expect(formatLabel('halfPpr')).toBe('Half-PPR');
  expect(formatLabel('ppr')).toBe('Full PPR');
  expect(formatLabel('bogus')).toBe('Half-PPR');
});

test('pointsFor picks the active format from a per-format object', () => {
  const points = { standard: 19.6, halfPpr: 21.6, ppr: 23.6 };
  expect(pointsFor(points, 'standard')).toBe(19.6);
  expect(pointsFor(points, 'halfPpr')).toBe(21.6);
  expect(pointsFor(points, 'ppr')).toBe(23.6);
});

test('pointsFor tolerates a scalar payload (older/mocked responses)', () => {
  expect(pointsFor(45.6, 'ppr')).toBe(45.6);
});

test('pointsFor returns the fallback when points are missing', () => {
  expect(pointsFor(null, 'halfPpr', '-')).toBe('-');
  expect(pointsFor({ standard: 5 }, 'ppr', 0)).toBe(0); // key absent
});
