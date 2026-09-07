const test = require('node:test');
const assert = require('node:assert/strict');
const { countedRoster } = require('../services/countedRoster.service');

/*
 * #954: the FORMAT and SUMMING RULE for a week's counted roster, tested by
 * direct call with no database. The population read (rowsHeldAsPlayed) is not
 * exercised here; these rows arrive already held-as-played, exactly as the
 * three callers hand them over.
 *
 * The pricer is injected, so a case can put a chosen number on each row and
 * read it back out of the totals. `price` returns the row's `stats.pts`
 * verbatim, so every assertion below is arithmetic a reader can check.
 */
const price = (stats) => stats.pts;

const SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
];
const STANDARD = { best_ball: false, roster_slots: SLOTS };
const BEST_BALL = { best_ball: true, roster_slots: SLOTS };

const row = (playerId, position, slot, pts, name) =>
  ({ player_id: playerId, position, slot, stats: { pts }, name });

/* ------------------------------------------------------------------ *
 * Criterion 1: the excluded rows, their ordering, the totals, the      *
 * rounding - all by direct call.                                       *
 * ------------------------------------------------------------------ */

test('#954 IR rows are excluded, in input order, and never counted (standard)', () => {
  // Two IR rows seeded in an order that is NOT their playerId order, so a
  // classifier that sorted the excluded rows would reorder them and redden the
  // deepEqual below. This is the IR-classification red-tell that the deleted
  // scoring.service.test.js best-ball IR assertion now lives behind.
  const result = countedRoster({
    league: STANDARD,
    price,
    rows: [
      row(5, 'RB', 'IR', 99),      // IR, seeded first though its id is higher
      row(1, 'QB', 'QB', 10),      // started
      row(3, 'RB', 'IR', 50),      // IR, seeded second though its id is lower
      row(2, 'RB', 'BENCH', 30),   // benched
    ],
  });

  assert.deepEqual(
    result.excluded,
    [{ playerId: 5, slot: 'IR', reason: 'IR' }, { playerId: 3, slot: 'IR', reason: 'IR' }],
    'both IR rows are excluded, in the order they arrived (not sorted)'
  );
  assert.deepEqual(
    result.counted.map((r) => r.playerId), [1, 2],
    'the counted rows keep input order and hold no IR row'
  );
  // Started total counts the QB only: the RB is benched, both IR rows are gone.
  assert.equal(result.teamScore, 10, 'the started total is the QB alone; IR and BENCH do not count');
});

test('#954 the started total (standard) sums only starting slots', () => {
  const result = countedRoster({
    league: STANDARD,
    price,
    rows: [
      row(1, 'QB', 'QB', 10),
      row(2, 'RB', 'RB', 5.5),
      row(3, 'RB', 'BENCH', 20),
    ],
  });
  assert.equal(result.teamScore, 15.5, 'QB (10) + started RB (5.5); the benched 20 is not in the started total');
  assert.equal(result.startedPoints, 15.5);
});

test('#954 the started total is rounded to two decimals', () => {
  // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754. round2 must return 0.3, so
  // dropping the rounding (returning the raw sum) reddens this assertion. This
  // is criterion 2's rounding red-tell.
  const result = countedRoster({
    league: STANDARD,
    price,
    rows: [
      row(1, 'QB', 'QB', 0.1),
      row(2, 'RB', 'RB', 0.2),
    ],
  });
  assert.equal(result.teamScore, 0.3, 'the raw 0.1 + 0.2 is rounded to 0.3, not 0.30000000000000004');
});

test('#954 pointsLeftOnBench (standard) is the rounded optimal-minus-started gap', () => {
  // Started: the QB alone (10). Optimal: QB (10) + the benched RB (30) = 40.
  // The bench held 30 the manager could have started.
  const result = countedRoster({
    league: STANDARD,
    price,
    rows: [
      row(1, 'QB', 'QB', 10, 'Starter QB'),
      row(2, 'RB', 'BENCH', 30, 'Bench RB'),
    ],
  });
  assert.equal(result.teamScore, 10, 'actual is the started QB');
  assert.equal(result.optimalPoints, 40, 'optimal seats the benched RB too');
  assert.equal(result.pointsLeftOnBench, 30);
  assert.deepEqual(
    result.optimalStarters.map((s) => ({ playerId: s.playerId, points: s.points, name: s.name })),
    [{ playerId: 1, points: 10, name: 'Starter QB' }, { playerId: 2, points: 30, name: 'Bench RB' }],
    'optimalStarters carries each seat with the name carried through from the row'
  );
});

/* ------------------------------------------------------------------ *
 * Best ball: the score of record IS the optimal lineup over the whole  *
 * held pool (ADR 0022/0023), and an IR occupant is never in it (#741). *
 * ------------------------------------------------------------------ */

test('#954 best ball scores the optimal lineup over every non-IR row, bench included', () => {
  // A benched 30 is a candidate in best ball; a 50 on IR is not. Optimal seats
  // the QB (8) and the 30, never the 50.
  const result = countedRoster({
    league: BEST_BALL,
    price,
    rows: [
      row(1, 'QB', 'BENCH', 8),
      row(2, 'RB', 'BENCH', 30),
      row(3, 'RB', 'IR', 50),
    ],
  });
  assert.equal(result.teamScore, 38, 'QB 8 + best non-IR RB 30; the IR 50 is excluded');
  assert.equal(result.optimalPoints, 38);
  assert.equal(result.startedPoints, 0, 'best ball keeps no started total');
  assert.equal(result.pointsLeftOnBench, 0, 'best ball leaves nothing on the bench: actual is optimal');
  assert.ok(!result.optimalStarters.some((s) => s.playerId === 3), 'the IR stash is not a starter');
});

/* ------------------------------------------------------------------ *
 * Rows arrive as given (#1010): a statless row (priced 0) stays and    *
 * contributes 0; the module never drops or synthesises it.            *
 * ------------------------------------------------------------------ */

test('#954 a statless starter priced at 0 stays counted and contributes 0', () => {
  const zeroPrice = (stats) => (stats && typeof stats.pts === 'number' ? stats.pts : 0);
  const result = countedRoster({
    league: STANDARD,
    price: zeroPrice,
    rows: [
      row(1, 'QB', 'QB', 10),
      { player_id: 2, position: 'RB', slot: 'RB', stats: null, name: 'Statless RB' },
    ],
  });
  assert.equal(result.counted.length, 2, 'the statless row is kept, not dropped');
  assert.equal(result.teamScore, 10, 'it contributes 0 to the started total');
});
