const test = require('node:test');
const assert = require('node:assert/strict');
const { finishOf, judge, rankingRho, scoreCalls, spearman } = require('./score-calls');

test('spearman: perfect, reversed, ties, undefined', () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [30, 20, 10]), -1);
  assert.ok(Math.abs(spearman([1, 2, 3, 4], [1, 2, 2, 4]) - 0.9487) < 1e-3);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null);
});

test('finishOf: ties share the best rank', () => {
  assert.equal(finishOf(20, [30, 20, 20, 5]), 2);
  assert.equal(finishOf(5, [30, 20, 20, 5]), 4);
});

test('judge: START/FLEX need an appearance inside the cutoff, SIT/OUT the opposite', () => {
  const base = { cutoff: 12, condition: null };
  assert.equal(judge({ ...base, verdict: 'START', finish: 12, appeared: true }), true);
  assert.equal(judge({ ...base, verdict: 'FLEX', finish: 13, appeared: true }), false);
  assert.equal(judge({ ...base, verdict: 'START', finish: 1, appeared: false }), false);
  assert.equal(judge({ ...base, verdict: 'SIT', finish: 13, appeared: true }), true);
  assert.equal(judge({ ...base, verdict: 'SIT', finish: 5, appeared: true }), false);
  assert.equal(judge({ ...base, verdict: 'OUT', finish: 1, appeared: false }), true);
});

test('judge: an if-active call on a player who did not appear is void', () => {
  assert.equal(judge({ verdict: 'START', condition: 'if active', finish: 40, cutoff: 12, appeared: false }), null);
  assert.equal(judge({ verdict: 'START', condition: 'if active', finish: 3, cutoff: 12, appeared: true }), true);
});

// Four WRs, cutoff 2. Engine ranks A, B, C, D; actuals favour A, C.
const ledger = new Map([
  [1, { position: 'WR', estimate: 20 }], [2, { position: 'WR', estimate: 15 }],
  [3, { position: 'WR', estimate: 10 }], [4, { position: 'WR', estimate: 5 }],
]);
const actuals = new Map([
  [1, { position: 'WR', points: 25, appeared: true }], [2, { position: 'WR', points: 4, appeared: true }],
  [3, { position: 'WR', points: 18, appeared: true }], [9, { position: 'WR', points: 30, appeared: true }],
]);

test('rankingRho: same player set, missing ledger rows reported', () => {
  const ranking = [1, 2, 3, 4, 7].map((id, i) => ({ rank: i + 1, name: `p${id}`, playerId: id }));
  const r = rankingRho(ranking, ledger, actuals);
  assert.equal(r.n, 4);
  assert.deepEqual(r.missing, ['p7']);
  assert.ok(r.editorialRho != null && r.engineRho != null);
});

test('scoreCalls: head-to-head, voids, missing engine row, inactive scores 0', () => {
  const file = {
    cutoffs: { WR: 2 },
    rankings: {},
    calls: [
      { id: 'a', name: 'A', position: 'WR', playerId: 1, verdict: 'START', condition: null },
      { id: 'b', name: 'B', position: 'WR', playerId: 2, verdict: 'START', condition: null },
      { id: 'c', name: 'C', position: 'WR', playerId: 3, verdict: 'SIT', condition: null },
      { id: 'd', name: 'D', position: 'WR', playerId: 4, verdict: 'START', condition: 'if active' },
      { id: 'e', name: 'E', position: 'WR', playerId: 8, verdict: 'OUT', condition: null },
    ],
  };
  const { calls, summary } = scoreCalls(file, ledger, actuals);
  const by = Object.fromEntries(calls.map((c) => [c.id, c]));
  assert.equal(by.a.finish, 2); // 30 (id 9), 25
  assert.equal(by.a.editorialHit, true);
  assert.equal(by.a.engineCall, 'START');
  assert.equal(by.b.editorialHit, false); // 4 pts, outside cutoff 2
  assert.equal(by.b.engineHit, false); // engine ranks B 2nd -> START, also misses
  assert.equal(by.c.editorialHit, true); // SIT, finished 3rd
  assert.equal(by.c.engineCall, 'SIT');
  assert.equal(by.c.engineHit, true);
  assert.equal(by.d.editorialHit, null); // no stat row, if active -> void
  assert.equal(by.d.engineHit, null);
  assert.equal(by.e.editorialHit, true); // OUT, inactive
  assert.equal(by.e.engineRank, null); // not in ledger
  assert.deepEqual(summary.engineMissing, ['E']);
  assert.equal(summary.void, 1);
  assert.deepEqual(summary.editorial, { n: 4, hits: 3 });
  assert.deepEqual(summary.paired, { n: 3, editorialHits: 2, engineHits: 2 });
});

test('scoreCalls: an engine-unavailable row neither ranks nor pushes an available player past the cutoff', () => {
  // Same four WRs plus X, on IR with the biggest estimate. Cutoff 2: with X
  // counted, B drops to 3rd and the engine would read SIT on him.
  const withIr = new Map([...ledger, [5, { position: 'WR', estimate: 50, unavailable: true }]]);
  const file = {
    cutoffs: { WR: 2 },
    rankings: { WR: [1, 2, 3, 5].map((id, i) => ({ rank: i + 1, name: `p${id}`, playerId: id })) },
    calls: [
      { id: 'b', name: 'B', position: 'WR', playerId: 2, verdict: 'START', condition: null },
      { id: 'x', name: 'X', position: 'WR', playerId: 5, verdict: 'OUT', condition: null, injury: true },
    ],
  };
  const { calls, rankings, summary } = scoreCalls(file, withIr, actuals);
  const by = Object.fromEntries(calls.map((c) => [c.id, c]));
  assert.equal(by.b.engineRank, 2);
  assert.equal(by.b.engineCall, 'START');
  assert.equal(by.x.engineUnavailable, true);
  assert.equal(by.x.engineRank, null);
  assert.equal(by.x.engineCall, 'SIT');
  assert.equal(by.x.engineHit, true); // no stat row: SIT hits
  assert.deepEqual(summary.engineMissing, []);
  assert.deepEqual(summary.pairedMethod, { n: 1, editorialHits: 0, engineHits: 0 });
  assert.deepEqual(summary.pairedInjury, { n: 1, editorialHits: 1, engineHits: 1 });
  // Engine order scores the IR row 0 (20, 15, 10, 0 vs actual 25, 4, 18, 0): rho 0.8; at its raw 50 it would go negative
  assert.ok(Math.abs(rankings.WR.engineRho - 0.8) < 1e-9);
});
