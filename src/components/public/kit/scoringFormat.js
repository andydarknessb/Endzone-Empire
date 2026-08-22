/**
 * Public scoring formats. The server returns every points value pre-computed in
 * all three formats (keyed by these ids), so the profile toggle is a pure pick
 * — no scoring logic lives on the client. `key` matches the object keys the
 * serializer emits (see publicRead.service.js `pointsByFormat`).
 */
export const SCORING_FORMATS = [
  { id: 'standard', key: 'standard', label: 'Standard', short: 'STD' },
  { id: 'halfPpr', key: 'halfPpr', label: 'Half-PPR', short: '½ PPR' },
  { id: 'ppr', key: 'ppr', label: 'Full PPR', short: 'PPR' },
];

export const DEFAULT_FORMAT = 'halfPpr';

export function formatLabel(formatId) {
  const found = SCORING_FORMATS.find((f) => f.id === formatId);
  return found ? found.label : 'Half-PPR';
}

/**
 * Read a points value for the active format from a per-format object
 * (`{ standard, halfPpr, ppr }`). Falls back to a scalar when the object is
 * absent — keeps older/mocked payloads that only carry a single number working.
 */
export function pointsFor(points, formatId, fallback = null) {
  if (points == null) return fallback;
  if (typeof points === 'number') return points; // scalar payload
  const key = (SCORING_FORMATS.find((f) => f.id === formatId) || {}).key || DEFAULT_FORMAT;
  const value = points[key];
  return value == null ? fallback : value;
}

// Positions that score identically in all three formats: the presets differ
// only in points-per-reception, and defenses/defenders never catch passes.
const SINGLE_FORMAT_POSITIONS = new Set([
  'DEF',
  'DL', 'DE', 'DT', 'NT',
  'LB', 'ILB', 'OLB',
  'DB', 'CB', 'S', 'FS', 'SS',
]);

/**
 * Whether a position's points actually change between scoring formats. False
 * for defenses and individual defenders, whose three format values are always
 * the same number — offering a toggle there implies a difference that isn't
 * real.
 */
export function hasFormatVariants(position) {
  return !SINGLE_FORMAT_POSITIONS.has(String(position || '').toUpperCase());
}

export default SCORING_FORMATS;
