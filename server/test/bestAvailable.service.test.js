const { test } = require('node:test');
const assert = require('node:assert/strict');
const bestAvailable = require('../services/bestAvailable.service');

// ---- isBestAvailableEligible -----------------------------------------------

test('isBestAvailableEligible: an ADP or last-season points admits a player', () => {
  assert.equal(bestAvailable.isBestAvailableEligible({ adp: 12.4, last_season_points: null, name: 'A' }), true);
  assert.equal(bestAvailable.isBestAvailableEligible({ adp: null, last_season_points: 76.7, name: 'B' }), true);
  assert.equal(bestAvailable.isBestAvailableEligible({ adp: 1, last_season_points: 50, name: 'C' }), true);
});

test('isBestAvailableEligible: neither an ADP nor last-season points excludes a player', () => {
  assert.equal(bestAvailable.isBestAvailableEligible({ adp: null, last_season_points: null, name: 'D' }), false);
});

test('isBestAvailableEligible: a real zero point total still counts as production', () => {
  assert.equal(bestAvailable.isBestAvailableEligible({ adp: null, last_season_points: 0, name: 'E' }), true);
});

// ---- compareBestAvailable ---------------------------------------------------

test('compareBestAvailable: lower ADP sorts first', () => {
  const a = { adp: 5, last_season_points: null, name: 'A' };
  const b = { adp: 12, last_season_points: null, name: 'B' };
  assert.ok(bestAvailable.compareBestAvailable(a, b) < 0);
  assert.ok(bestAvailable.compareBestAvailable(b, a) > 0);
});

test('compareBestAvailable: an ADP player always outranks a no-ADP player, however productive', () => {
  const hasAdp = { adp: 250, last_season_points: null, name: 'Late ADP' };
  const noAdpProductive = { adp: null, last_season_points: 400, name: 'No ADP, huge season' };
  assert.ok(bestAvailable.compareBestAvailable(hasAdp, noAdpProductive) < 0);
});

test('compareBestAvailable: among no-ADP players, more last-season points sorts first', () => {
  const moreProd = { adp: null, last_season_points: 85.7, name: 'Dawson Knox' };
  const lessProd = { adp: null, last_season_points: 76.7, name: 'Darren Waller' };
  assert.ok(bestAvailable.compareBestAvailable(moreProd, lessProd) < 0);
});

test('compareBestAvailable: a no-ADP player with points outranks a no-ADP player with neither', () => {
  const withPoints = { adp: null, last_season_points: 10, name: 'Has points' };
  const withNeither = { adp: null, last_season_points: null, name: 'Has neither' };
  assert.ok(bestAvailable.compareBestAvailable(withPoints, withNeither) < 0);
});

test('compareBestAvailable: falls back to name, never database id', () => {
  const a = { id: 999, adp: null, last_season_points: null, name: 'Aaron' };
  const b = { id: 1, adp: null, last_season_points: null, name: 'Zeke' };
  // id would put b (1) first if it decided order — name puts a (Aaron) first instead.
  assert.ok(bestAvailable.compareBestAvailable(a, b) < 0);
});

test('compareBestAvailable: tied ADP falls through to points, then name', () => {
  const a = { adp: 10, last_season_points: 50, name: 'A' };
  const b = { adp: 10, last_season_points: 80, name: 'B' };
  assert.ok(bestAvailable.compareBestAvailable(b, a) < 0);
});

// ---- selectBestAvailable -----------------------------------------------------

test('selectBestAvailable: seeds (a) ADP, (b) no-ADP-but-points, (c) neither — contains a and b, excludes c, orders a before b', () => {
  const a = { id: 1, adp: 4.2, last_season_points: null, name: 'Has ADP' };
  const b = { id: 2, adp: null, last_season_points: 85.7, name: 'No ADP, 2025 points' };
  const c = { id: 3, adp: null, last_season_points: null, name: 'Neither' };

  const result = bestAvailable.selectBestAvailable([c, b, a]); // seeded out of order on purpose

  assert.deepEqual(result.map((r) => r.id), [1, 2]);
});

test('selectBestAvailable: multiple no-ADP producers order by points, most productive first', () => {
  const waller = { id: 1310, adp: null, last_season_points: 76.7, name: 'Darren Waller' };
  const knox = { id: 1342, adp: null, last_season_points: 85.7, name: 'Dawson Knox' };
  const neither = { id: 9, adp: null, last_season_points: null, name: 'Practice Squad Guy' };

  const result = bestAvailable.selectBestAvailable([waller, neither, knox]);

  assert.deepEqual(result.map((r) => r.id), [1342, 1310]); // Knox (85.7) before Waller (76.7)
});

test('selectBestAvailable: does not mutate its input array', () => {
  const rows = [
    { id: 2, adp: null, last_season_points: 5, name: 'B' },
    { id: 1, adp: 1, last_season_points: null, name: 'A' },
  ];
  const original = [...rows];
  bestAvailable.selectBestAvailable(rows);
  assert.deepEqual(rows, original);
});
