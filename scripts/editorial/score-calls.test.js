const test = require('node:test');
const assert = require('node:assert/strict');
const {
  finishOf, judge, editorialBlend, EDITORIAL_FEED, rankingRho, scoreCalls, spearman, servedInjuryStatus, servedAsOf, servedVerdictFor, seasonLedger,
  observationsAsOf, chartsBefore, captureChartRows,
} = require('./score-calls');
const { binomialUpperTail } = require('../holdout/lib/inference');

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

// Served (rebuilt) Start verdict
const obs = (observedAt, reportStatus, practiceStatus = 'Limited Participation in Practice') => ({
  observedAt, reportStatus, practiceStatus, practicePrimaryInjury: null, reportPrimaryInjury: null,
});

test('servedInjuryStatus: the latest report overrides a game designation only', () => {
  assert.equal(servedInjuryStatus('Q', []), 'Q');
  assert.equal(servedInjuryStatus(null, [obs('2026-10-16T20:00Z', 'Questionable')]), 'Q');
  assert.equal(servedInjuryStatus('Q', [obs('2026-10-16T20:00Z', 'Out')]), 'O');
  assert.equal(servedInjuryStatus('d', [obs('2026-10-16T20:00Z', 'Doubtful')]), 'D');
  assert.equal(servedInjuryStatus('Questionable', [obs('2026-10-16T20:00Z', null)]), 'Questionable'); // not designated yet: capture stands
  assert.equal(servedInjuryStatus('Q', [obs('2026-10-15T20:00Z', 'Out'), obs('2026-10-16T20:00Z', null)]), 'Q'); // a null latest report never changes the status
  assert.equal(servedInjuryStatus(null, [obs('2026-10-16T20:00Z', null)]), null);
  // roster statuses always stand
  assert.equal(servedInjuryStatus('IR', [obs('2026-10-16T20:00Z', 'Questionable')]), 'IR');
  assert.equal(servedInjuryStatus('SUSPENDED', [obs('2026-10-16T20:00Z', null)]), 'SUSPENDED');
  // the latest observation wins whatever the list order
  const unordered = [obs('2026-10-17T20:00Z', 'Out'), obs('2026-10-15T20:00Z', 'Questionable')];
  assert.equal(servedInjuryStatus(null, unordered), 'O');
});

test('servedAsOf: a minute before kickoff, never after now', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  assert.equal(servedAsOf('2026-10-11T17:00:00Z', now).toISOString(), '2026-10-11T16:59:00.000Z');
  assert.equal(servedAsOf('2026-10-18T17:00:00Z', now).toISOString(), now.toISOString());
  assert.equal(servedAsOf(null, now).toISOString(), now.toISOString());
});

test('servedVerdictFor: stored unavailable wins, practice facts move a Questionable', () => {
  const asOf = new Date('2026-10-18T16:59:00Z');
  const kickoffAt = '2026-10-18T17:00:00Z';
  const base = { factors: { availability: { available: true } }, injuryStatus: 'Q', kickoffAt, observations: [], backup: false, asOf };
  const stored = servedVerdictFor({ ...base, factors: { availability: { available: false, reason: 'ir', status: 'IR' } }, observations: [obs('2026-10-14T20:00Z', null, 'Full Participation in Practice')] });
  assert.deepEqual(stored, { outcome: 'unavailable', reason: 'ir', numberTrusted: true });
  assert.equal(servedVerdictFor(base).outcome, 'recommendable');
  const dnp = [obs('2026-10-14T20:00Z', 'Questionable', 'Did Not Participate In Practice')];
  assert.deepEqual(servedVerdictFor({ ...base, observations: dnp }), { outcome: 'not_recommended', reason: 'no_practice', numberTrusted: true });
  assert.equal(servedVerdictFor({ ...base, injuryStatus: null, observations: [obs('2026-10-17T20:00Z', 'Out')] }).outcome, 'unavailable');
  assert.equal(servedVerdictFor({ ...base, backup: true }).reason, 'backup');
  const baseline = servedVerdictFor({ ...base, injuryStatus: null, factors: { availability: {}, dataQuality: { reasons: ['position baseline'] } } });
  assert.equal(baseline.reason, 'no_history');
});

test('scoreCalls: served call, unavailable passthrough, not_recommended -> SIT, rank among non-unavailable rows', () => {
  const served = (outcome) => ({ outcome, reason: null });
  const withServed = new Map([
    [1, { ...ledger.get(1), served: served('unavailable') }],
    [2, { ...ledger.get(2), served: served('not_recommended') }],
    [3, { ...ledger.get(3), served: served('recommendable') }],
    [4, { ...ledger.get(4), served: served('recommendable') }],
  ]);
  const file = {
    cutoffs: { WR: 2 },
    rankings: { WR: [1, 2, 3, 4].map((id, i) => ({ rank: i + 1, name: `p${id}`, playerId: id })) },
    calls: [1, 2, 3, 4].map((id) => ({ id: `c${id}`, name: `P${id}`, position: 'WR', playerId: id, verdict: 'START', condition: null })),
  };
  const { calls, rankings, summary } = scoreCalls(file, withServed, actuals);
  const by = Object.fromEntries(calls.map((c) => [c.id, c]));
  assert.deepEqual([by.c1.servedCall, by.c1.servedRank, by.c1.servedOutcome], ['SIT', null, 'unavailable']);
  assert.deepEqual([by.c2.servedCall, by.c2.servedRank], ['SIT', null]); // not_recommended never starts (but stays in the ranked pool)
  assert.deepEqual([by.c3.servedCall, by.c3.servedRank], ['START', 2]); // the unavailable 20 does not push him down
  assert.deepEqual([by.c4.servedCall, by.c4.servedRank], ['SIT', 3]);
  assert.deepEqual([by.c1.servedHit, by.c2.servedHit, by.c3.servedHit, by.c4.servedHit], [false, true, false, true]);
  assert.deepEqual(summary.paired, { n: 4, editorialHits: 1, engineHits: 3, servedHits: 2 });
  assert.equal(summary.pairedMethod.servedHits, 2);
  assert.equal(summary.pairedInjury.servedHits, 0);
  assert.equal(typeof rankings.WR.servedRho, 'number');
});

test('scoreCalls: a void editorial call has no served hit', () => {
  const withServed = new Map([[4, { ...ledger.get(4), served: { outcome: 'recommendable', reason: null } }]]);
  const file = { cutoffs: { WR: 2 }, rankings: {}, calls: [{ id: 'd', name: 'D', position: 'WR', playerId: 4, verdict: 'START', condition: 'if active' }] };
  const { calls } = scoreCalls(file, withServed, actuals);
  assert.equal(calls[0].servedHit, null);
});

test('seasonLedger: sums hits over weeks and n-weights the position rhos', () => {
  const split = (n, e, c, s) => ({ n, editorialHits: e, engineHits: c, servedHits: s });
  const week = (w, m, i, qb) => ({
    week: w,
    summary: { paired: split(m[0] + i[0], m[1] + i[1], m[2] + i[2], m[3] + i[3]), pairedMethod: split(...m), pairedInjury: split(...i) },
    rankings: { QB: qb },
  });
  const out = seasonLedger([
    week(4, [26, 18, 17, 16], [4, 3, 2, 3], { n: 10, editorialRho: 0.5, engineRho: 0.1, servedRho: 0.2 }),
    week(5, [19, 11, 9, 10], [2, 1, 1, 2], { n: 30, editorialRho: 0.1, engineRho: null, servedRho: 0.6 }),
  ]);
  assert.deepEqual(out.weeks.map((w) => w.week), [4, 5]);
  assert.deepEqual(out.totals.pairedMethod, split(45, 29, 26, 26));
  assert.deepEqual(out.totals.pairedInjury, split(6, 4, 3, 5));
  assert.deepEqual(out.totals.paired, split(51, 33, 29, 31));
  const qb = out.rankings.QB;
  assert.equal(qb.n, 40);
  assert.ok(Math.abs(qb.editorialRho - 0.2) < 1e-9); // (10*.5 + 30*.1) / 40
  assert.ok(Math.abs(qb.engineRho - 0.1) < 1e-9); // null week left out of the mean
  assert.ok(Math.abs(qb.servedRho - 0.5) < 1e-9); // (10*.2 + 30*.6) / 40
});

test('observationsAsOf: an observation exactly at asOf counts, one millisecond later does not', () => {
  const asOf = new Date('2026-10-18T16:59:00.000Z');
  const list = [obs('2026-10-18T16:59:00.000Z', 'Questionable'), obs('2026-10-18T16:59:00.001Z', 'Out'), obs('2026-10-14T20:00Z', null)];
  assert.deepEqual(observationsAsOf(list, asOf).map((o) => o.observedAt), ['2026-10-18T16:59:00.000Z', '2026-10-14T20:00Z']);
  assert.deepEqual(observationsAsOf([], asOf), []);
});

test('chartsBefore: only days strictly before the asOf day, within the 3-day lookback', () => {
  const asOf = new Date('2026-10-18T16:59:00Z');
  const chart = ['2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18', '2026-10-19'].map((d) => ({ player_id: 1, captured_date: d }));
  assert.deepEqual(chartsBefore(chart, asOf).map((c) => c.captured_date), ['2026-10-15', '2026-10-17']);
  // a 00:15Z kickoff: its own UTC day's chart may not exist yet, so it is never admitted
  const late = new Date('2026-10-19T00:14:00Z');
  assert.deepEqual(chartsBefore(chart, late).map((c) => c.captured_date), ['2026-10-17', '2026-10-18']);
});

test('captureChartRows: team and status come from the capture, a chart player with no capture row is dropped', () => {
  const chart = [
    { player_id: 1, rank: 1, team_code: 'KC', captured_date: '2026-10-17' },
    { player_id: 2, rank: 2, team_code: 'KC', captured_date: '2026-10-17' },
    { player_id: 3, rank: 3, team_code: 'KC', captured_date: '2026-10-17' },
    { player_id: 4, rank: 4, team_code: 'KC', captured_date: '2026-10-17' },
  ];
  const captured = new Map([
    [1, { position: 'QB', nfl_team: 'DEN', injury_status: 'IR' }],
    [2, { position: 'QB', nfl_team: 'KC', injury_status: null }],
    [4, { position: 'RB', nfl_team: 'KC', injury_status: null }], // not a QB in the capture
  ]);
  assert.deepEqual(captureChartRows(chart, captured), [
    { player_id: 1, rank: 1, team_code: 'KC', captured_date: '2026-10-17', nfl_team: 'DEN', injury_status: 'IR' },
    { player_id: 2, rank: 2, team_code: 'KC', captured_date: '2026-10-17', nfl_team: 'KC', injury_status: null },
  ]);
});

// Editorial feed (#2524)
const feedLedger = new Map([[1, { estimate: 20 }], [2, { estimate: 16 }], [3, { estimate: 12 }], [4, { estimate: 8 }]]);
const feedRanking = [3, 1, 2, 4].map((id, i) => ({ rank: i + 1, name: `p${id}`, playerId: id })); // editorial order: 3, 1, 2, 4

test('editorialBlend: weight 1 gives each player the estimate at his editorial rank, weight 0 changes nothing', () => {
  assert.deepEqual([...editorialBlend(feedRanking, feedLedger, new Set(), 1)], [[3, 20], [1, 16], [2, 12], [4, 8]]);
  assert.deepEqual([...editorialBlend(feedRanking, feedLedger, new Set(), 0)], [[3, 12], [1, 20], [2, 16], [4, 8]]);
});

test('editorialBlend: injury-flagged and unavailable players are absent and the rest re-rank among themselves', () => {
  const led = new Map([...feedLedger, [2, { estimate: 16, unavailable: true }]]);
  assert.deepEqual([...editorialBlend(feedRanking, led, new Set([1]), 1)], [[3, 12], [4, 8]]); // points are only 12 and 8
});

test('rankingRho: blendedRho on the same n as engineRho', () => {
  const ranking = [1, 2, 3, 4, 7].map((id, i) => ({ rank: i + 1, name: `p${id}`, playerId: id }));
  const r = rankingRho(ranking, ledger, actuals, new Set([2]));
  assert.equal(r.n, 4);
  assert.ok(r.blendedRho != null);
});

test('seasonLedger.editorialFeed: window, ties dropped, p, unjudged, pass and fail', () => {
  const wk = (week, qb, te) => ({
    week, season: 2026, summary: { paired: {}, pairedMethod: {}, pairedInjury: {} },
    rankings: { QB: { n: 10, blendedRho: qb[0], engineRho: qb[1] }, TE: { n: 10, blendedRho: te[0], engineRho: te[1] } },
  });
  const win = (week) => wk(week, [0.6, 0.2], [0.5, 0.1]);
  const early = [4, 5, 6, 7].map(win);
  assert.deepEqual(seasonLedger([...early, win(8)]).editorialFeed.weeks, [8]); // weeks 4-7 ignored
  assert.equal(seasonLedger([...early, ...[8, 9, 10, 11, 12].map(win)]).editorialFeed.verdict, 'unjudged'); // 5 judged weeks
  const six = [8, 9, 10, 11, 12].map(win).concat(wk(13, [0.6, 0.2], [0.3, 0.3])); // one tie
  const f = seasonLedger(six).editorialFeed;
  assert.deepEqual([f.positionWeeks, f.favorable, f.unfavorable, f.ties], [12, 11, 0, 1]);
  assert.equal(f.p, binomialUpperTail(11, 11));
  assert.equal(f.verdict, 'pass');
  // pooled blend higher, but only 6 of 12 sign-test wins: p > alpha
  const mixed = [8, 9, 10].map((w) => wk(w, [0.9, 0.1], [0.9, 0.1])).concat([11, 12, 13].map((w) => wk(w, [0.2, 0.3], [0.2, 0.3])));
  const m = seasonLedger(mixed).editorialFeed;
  assert.ok(m.blendedRho > m.engineRho);
  assert.equal(m.p, binomialUpperTail(12, 6));
  assert.equal(m.verdict, 'fail');
  assert.equal(EDITORIAL_FEED.minWeeks, 6);
});

test('EDITORIAL_FEED: the preregistered values', () => {
  assert.deepEqual(EDITORIAL_FEED, { weight: 0.5, positions: ['QB', 'TE'], season: 2026, firstWeek: 8, lastWeek: 18, alpha: 0.10, minWeeks: 6 });
});

test('editorialBlend: a repeated playerId counts once, at its best rank', () => {
  const dup = [...feedRanking, { rank: 5, name: 'p3', playerId: 3 }];
  assert.deepEqual([...editorialBlend(dup, feedLedger, new Set(), 1)], [...editorialBlend(feedRanking, feedLedger, new Set(), 1)]);
});

test('rankingRho: blendedRho is the rho of the blended order (unavailable 0, injury keeps capture estimate)', () => {
  const led = new Map([
    [1, { estimate: 20 }], [2, { estimate: 16 }], [3, { estimate: 12 }], [4, { estimate: 8 }],
    [5, { estimate: 30, unavailable: true }], [6, { estimate: 14 }],
  ]);
  const ranking = [3, 1, 4, 2, 5, 6].map((id, i) => ({ rank: i + 1, name: `p${id}`, playerId: id }));
  const act = new Map([[1, 25], [3, 20], [6, 18], [2, 10], [4, 5]].map(([id, points]) => [id, { points }]));
  const r = rankingRho(ranking, led, act, new Set([6]));
  // moved = 3, 1, 4, 2 take points 20, 16, 12, 8 at weight .5; 5 is unavailable (0); 6 keeps 14
  const blended = new Map([[1, 18], [2, 12], [3, 16], [4, 10], [5, 0], [6, 14]]);
  const ids = ranking.map((x) => x.playerId);
  const actual = ids.map((id) => (act.get(id) || { points: 0 }).points);
  assert.equal(r.blendedRho, spearman(ids.map((id) => blended.get(id)), actual));
  assert.notEqual(r.blendedRho, r.engineRho);
  assert.notEqual(r.blendedRho, r.editorialRho);
});

test('seasonLedger.editorialFeed: n-weighted pooling, out-of-window results ignored, null rho skipped, sign test needs the pooled lead', () => {
  const res = (season, week, qb, te) => ({
    season, week, summary: { paired: {}, pairedMethod: {}, pairedInjury: {} }, rankings: { QB: qb, TE: te },
  });
  const rho = (n, blendedRho, engineRho) => ({ n, blendedRho, engineRho });
  const f = seasonLedger([
    res(2026, 8, rho(10, 0.6, 0.2), rho(30, 0.2, 0.1)),
    res(2026, 9, rho(10, null, 0.2), rho(20, 0.4, 0)),
    res(2026, 19, rho(10, -1, 1), rho(10, -1, 1)),
    res(2025, 9, rho(10, -1, 1), rho(10, -1, 1)),
  ]).editorialFeed;
  assert.deepEqual(f.weeks, [8, 9]);
  assert.equal(f.positionWeeks, 3);
  assert.ok(Math.abs(f.blendedRho - 20 / 60) < 1e-9); // (6 + 6 + 8) / 60, unweighted would be 0.4
  assert.ok(Math.abs(f.engineRho - 5 / 60) < 1e-9); // (2 + 3 + 0) / 60

  // 11 of 12 position-weeks favour the blend (p <= alpha) but one huge loss drags the pooled blend below the engine
  const wins = [8, 9, 10, 11, 12, 13].map((w) => res(2026, w, rho(1, 0.3, 0.2), rho(1, 0.3, 0.2)));
  wins[0] = res(2026, 8, rho(1000, -0.9, 0.9), rho(1, 0.3, 0.2));
  const g = seasonLedger(wins).editorialFeed;
  assert.ok(g.p <= EDITORIAL_FEED.alpha);
  assert.ok(g.blendedRho < g.engineRho);
  assert.equal(g.verdict, 'fail');
});
