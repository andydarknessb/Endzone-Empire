import { selectWaiverCandidates, WAIVER_POSITIONS } from './waiverCandidates';

const EXCLUDED = ['QB', 'K', 'DEF'];

/** Build rows with sequential ids/ranks from [position, season points] pairs. */
function rowsFrom(pairs) {
  return pairs.map(([position, seasonPoints], index) => ({
    playerId: `${position}-${index}`,
    name: `${position} Player ${index}`,
    position,
    seasonPoints,
    rank: index + 1,
  }));
}

function countByPosition(candidates) {
  return candidates.reduce((counts, row) => {
    counts[row.position] = (counts[row.position] || 0) + 1;
    return counts;
  }, {});
}

test('selects a position-balanced RB/WR/TE set beyond each position leading tier', () => {
  const rows = rowsFrom([
    // Excluded positions have the highest season points — the old bug flooded the
    // module with these. They must never appear.
    ['QB', 32], ['QB', 30], ['QB', 28],
    ['K', 12], ['DEF', 11],
    // RB: 24/23 lead (tier 1), then a clear drop into tier 2 candidates.
    ['RB', 24], ['RB', 23], ['RB', 15], ['RB', 14], ['RB', 13],
    // WR: 26/25 lead, then tier 2 candidates.
    ['WR', 26], ['WR', 25], ['WR', 17], ['WR', 16], ['WR', 15],
    // TE: 13/12 lead, then tier 2 candidates.
    ['TE', 13], ['TE', 12], ['TE', 7], ['TE', 6],
  ]);

  const result = selectWaiverCandidates(rows);

  // In-scope positions only; excluded positions never leak in.
  expect(result.every((row) => WAIVER_POSITIONS.includes(row.position))).toBe(true);
  expect(result.some((row) => EXCLUDED.includes(row.position))).toBe(false);

  // Beyond the leading tier: nobody from tier 1.
  expect(result.every((row) => row.tier > 1)).toBe(true);

  // Balanced: with enough candidates everywhere, no position exceeds the cap.
  const counts = countByPosition(result);
  expect(counts.RB).toBeLessThanOrEqual(2);
  expect(counts.WR).toBeLessThanOrEqual(2);
  expect(counts.TE).toBeLessThanOrEqual(2);
  expect(result).toHaveLength(6);

  // Each card carries a numeric position rank for display.
  expect(result.every((row) => Number.isInteger(row.positionRank))).toBe(true);
});

test('exposes position rank as the season-points order within a position', () => {
  const rows = rowsFrom([
    ['WR', 30], ['WR', 28], ['WR', 20], ['WR', 18], ['WR', 16],
    ['RB', 22], ['RB', 21], ['RB', 12],
  ]);

  const result = selectWaiverCandidates(rows);
  const wr20 = result.find((row) => row.position === 'WR' && row.seasonPoints === 20);
  // Two WRs total higher (30, 28), so the 20-point WR ranks 3rd at his position.
  expect(wr20.positionRank).toBe(3);
});

test('backfills from other in-scope positions when one has no qualifying players', () => {
  const rows = rowsFrom([
    // RB has only two near-equal leaders → both tier 1 → zero candidates.
    ['RB', 20], ['RB', 20],
    // WR / TE carry plenty of tier-2 depth to backfill the RB share.
    ['WR', 28], ['WR', 27], ['WR', 18], ['WR', 17], ['WR', 16], ['WR', 15],
    ['TE', 14], ['TE', 13], ['TE', 8], ['TE', 7], ['TE', 6],
  ]);

  const result = selectWaiverCandidates(rows);

  const counts = countByPosition(result);
  expect(counts.RB || 0).toBe(0); // no qualifying RB, no crash, no empty slot
  expect(result).toHaveLength(6); // backfilled from WR/TE
  expect(result.every((row) => row.tier > 1)).toBe(true);
  expect(result.some((row) => EXCLUDED.includes(row.position))).toBe(false);
});

test('fills from a single in-scope position without erroring', () => {
  const rows = rowsFrom([
    ['WR', 30], ['WR', 29], ['WR', 20], ['WR', 19], ['WR', 18], ['WR', 17], ['WR', 16],
    ['QB', 40], ['DEF', 10], // excluded noise
  ]);

  const result = selectWaiverCandidates(rows);

  expect(result.length).toBeGreaterThan(0);
  expect(result.every((row) => row.position === 'WR')).toBe(true);
  expect(result.every((row) => row.tier > 1)).toBe(true);
});

test('never surfaces excluded positions even when they dominate season points', () => {
  const rows = rowsFrom([
    ['QB', 35], ['QB', 34], ['QB', 33], ['QB', 32], ['QB', 31], ['QB', 30],
    ['K', 14], ['K', 13], ['DEF', 12], ['DEF', 11],
    ['RB', 20], ['RB', 19], ['RB', 12], ['RB', 11],
  ]);

  const result = selectWaiverCandidates(rows);

  expect(result.every((row) => WAIVER_POSITIONS.includes(row.position))).toBe(true);
  expect(result.some((row) => EXCLUDED.includes(row.position))).toBe(false);
});

test('returns an empty list without throwing on empty input', () => {
  expect(selectWaiverCandidates([])).toEqual([]);
});
