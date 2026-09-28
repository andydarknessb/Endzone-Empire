const test = require('node:test');
const assert = require('node:assert/strict');
const {
  outcomeFromScores,
  brierScore,
  logLoss,
  reliabilityTable,
  evaluateShadowRows,
  gateVerdict,
  kGrid,
  fitK,
} = require('../services/winProbabilityEvaluation');

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};

// --- The outcome a probability is graded against ---

test('the outcome is 1 for a home win, 0 for a home loss and 0.5 for a tie', () => {
  assert.equal(outcomeFromScores(101.5, 99.2), 1);
  assert.equal(outcomeFromScores('88.10', '90.00'), 0);
  assert.equal(outcomeFromScores('100.00', 100), 0.5);
  assert.equal(outcomeFromScores(null, 90), null);
});

// --- Brier score ---

test('the Brier score is the mean squared gap between probability and outcome', () => {
  // By hand: (0.8 - 1)^2 = 0.04, (0.3 - 0)^2 = 0.09, and a tie graded at 0.5:
  // (0.6 - 0.5)^2 = 0.01. Mean = 0.14 / 3 = 0.0466666...
  const pairs = [{ p: 0.8, o: 1 }, { p: 0.3, o: 0 }, { p: 0.6, o: 0.5 }];
  close(brierScore(pairs), 0.14 / 3, 1e-12, 'brier');
  assert.equal(brierScore([]), null);
});

// --- Log loss ---

test('log loss is the mean negative log likelihood, a tie counting half each way', () => {
  // By hand: -(ln 0.8 + ln(1 - 0.4)) / 2 = (0.2231435513 + 0.5108256238) / 2
  // = 0.3669845875.
  const plain = logLoss([{ p: 0.8, o: 1 }, { p: 0.4, o: 0 }]);
  close(plain.logLoss, 0.3669845875, 1e-9, 'log loss');
  assert.equal(plain.clamps, 0);
  // A tie at p = 0.8: -(0.5 ln 0.8 + 0.5 ln 0.2) = 0.5 x (0.2231435513 +
  // 1.6094379124) = 0.9162907319.
  close(logLoss([{ p: 0.8, o: 0.5 }]).logLoss, 0.9162907319, 1e-9, 'tie log loss');
  assert.equal(logLoss([]).logLoss, null);
});

test('log loss clamps probabilities to [1e-6, 1 - 1e-6] and counts every clamp', () => {
  // A certain call that was right: p = 1 clamps to 1 - 1e-6, loss
  // -ln(1 - 1e-6) = 0.0000010000005. A certain call that was wrong: p = 0
  // clamps to 1e-6, loss -ln(1e-6) = 13.8155105580. Mean of the two
  // = 6.9077557790. The 0.5 row is not clamped: loss ln 2 = 0.6931471806.
  const result = logLoss([{ p: 1, o: 1 }, { p: 0, o: 1 }]);
  close(result.logLoss, (13.815510557964274 + 0.000001000000500029089) / 2, 1e-9, 'clamped log loss');
  assert.equal(result.clamps, 2);
  const withUnclamped = logLoss([{ p: 1, o: 1 }, { p: 0.5, o: 0 }]);
  assert.equal(withUnclamped.clamps, 1);
  close(withUnclamped.logLoss, (0.000001000000500029089 + Math.LN2) / 2, 1e-9, 'mixed');
});

test('the clamp applies to log loss only; the Brier score of a certain call is exact', () => {
  assert.equal(brierScore([{ p: 1, o: 1 }, { p: 0, o: 0 }]), 0);
});

// --- Reliability table ---

test('the reliability table has ten equal bins with count, mean predicted and observed win rate', () => {
  // Bin 0 [0, 0.1): 0.05 lost, 0.08 won -> count 2, mean 0.065, observed 0.5.
  // Bin 1 [0.1, 0.2): 0.1 lost -> the lower edge belongs to the bin above.
  // Bin 9 [0.9, 1]: 0.95 won, 1 won, 0.9 tied -> count 3, mean 0.95,
  // observed (1 + 1 + 0.5) / 3 = 0.8333...; p = 1 lands in the top bin.
  const table = reliabilityTable([
    { p: 0.05, o: 0 }, { p: 0.08, o: 1 }, { p: 0.1, o: 0 },
    { p: 0.95, o: 1 }, { p: 1, o: 1 }, { p: 0.9, o: 0.5 },
  ]);
  assert.equal(table.length, 10);
  assert.deepEqual(table.map((b) => b.bin), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(table[0].count, 2);
  close(table[0].lower, 0, 1e-12, 'bin 0 lower');
  close(table[0].upper, 0.1, 1e-12, 'bin 0 upper');
  close(table[0].meanPredicted, 0.065, 1e-12, 'bin 0 mean');
  close(table[0].observedRate, 0.5, 1e-12, 'bin 0 observed');
  assert.equal(table[1].count, 1);
  close(table[1].meanPredicted, 0.1, 1e-12, 'bin 1 mean');
  assert.equal(table[1].observedRate, 0);
  assert.equal(table[9].count, 3);
  close(table[9].meanPredicted, 0.95, 1e-12, 'bin 9 mean');
  close(table[9].observedRate, 2.5 / 3, 1e-12, 'bin 9 observed');
  // An empty bin says so rather than claiming a rate of zero.
  assert.equal(table[5].count, 0);
  assert.equal(table[5].meanPredicted, null);
  assert.equal(table[5].observedRate, null);
});

// --- Grading shadow rows by checkpoint ---

// A win_probability_shadow row as pg hands it back: decimals as strings, the
// probability a double.
let nextId = 1;
const shadowRow = (fields) => ({
  id: nextId++,
  league_id: 71,
  season: 2026,
  week: 5,
  home_score: null,
  away_score: null,
  home_players_remaining: 9,
  away_players_remaining: 9,
  starters_without_interval: 0,
  k: '1.000',
  model_version: 'v2',
  ...fields,
});

test('rows are graded by checkpoint: last scheduled row per matchup, in-game, played', () => {
  // Matchup 1 settled 110 - 100 (home won, o = 1); matchup 2 settled 90 - 95
  // (home lost, o = 0); matchup 3 is not settled, so its row is not graded.
  const results = new Map([[1, { homeScore: '110.00', awayScore: '100.00' }], [2, { homeScore: 90, awayScore: 95 }]]);
  const rows = [
    shadowRow({ matchup_id: 1, status: 'scheduled', captured_at: '2026-10-04T15:00:00Z', home_expected_final: '110.00', away_expected_final: '100.00', mu: '10.000', sigma: '30.000', home_probability: 0.6 }),
    shadowRow({ matchup_id: 1, status: 'scheduled', captured_at: '2026-10-04T16:30:00Z', home_expected_final: '110.00', away_expected_final: '100.00', mu: '10.000', sigma: '30.000', home_probability: 0.62 }),
    shadowRow({ matchup_id: 1, status: 'live', captured_at: '2026-10-04T18:00:00Z', home_score: '50.00', away_score: '40.00', home_expected_final: '110.00', away_expected_final: '100.00', mu: '10.000', sigma: '20.000', home_probability: 0.7 }),
    shadowRow({ matchup_id: 1, status: 'played', captured_at: '2026-10-04T23:00:00Z', home_score: '110.00', away_score: '100.00', home_expected_final: '110.00', away_expected_final: '100.00', mu: '10.000', sigma: '0.000', home_probability: 1 }),
    // Out of time order on purpose: the 14:00 row is matchup 2's kickoff row.
    shadowRow({ matchup_id: 2, status: 'scheduled', captured_at: '2026-10-04T14:00:00Z', home_expected_final: '90.00', away_expected_final: '95.00', mu: '-5.000', sigma: '30.000', home_probability: 0.45 }),
    shadowRow({ matchup_id: 2, status: 'scheduled', captured_at: '2026-10-04T13:00:00Z', home_expected_final: '90.00', away_expected_final: '95.00', mu: '-5.000', sigma: '30.000', home_probability: 0.3 }),
    shadowRow({ matchup_id: 2, status: 'live', captured_at: '2026-10-04T19:00:00Z', home_score: '20.00', away_score: '30.00', home_expected_final: '90.00', away_expected_final: '95.00', mu: '-5.000', sigma: '15.000', home_probability: 0.2, starters_without_interval: 2 }),
    shadowRow({ matchup_id: 3, status: 'live', captured_at: '2026-10-04T19:00:00Z', home_score: '20.00', away_score: '30.00', home_expected_final: '90.00', away_expected_final: '95.00', mu: '-5.000', sigma: '15.000', home_probability: 0.4 }),
  ];

  const report = evaluateShadowRows({ rows, results });

  assert.equal(report.rowsTotal, 8);
  assert.equal(report.rowsGraded, 7);
  assert.equal(report.rowsWithoutResult, 1);

  // Kickoff: the 16:30 row for matchup 1 (p 0.62, o 1) and the 14:00 row for
  // matchup 2 (p 0.45, o 0). v2 Brier = ((0.62 - 1)^2 + 0.45^2) / 2 = (0.1444
  // + 0.2025) / 2 = 0.17345. Picking either earlier scheduled row would move it.
  const { kickoff, inGame, played, flagged } = report.checkpoints;
  assert.equal(kickoff.count, 2);
  close(kickoff.v2.brier, 0.17345, 1e-12, 'kickoff v2 brier');
  // v1 recomputed from the row exactly as the client does: 110 vs 100 with no
  // score is 1 / (1 + e^(-10/24)) = 0.6026853380; 90 vs 95 is
  // 1 / (1 + e^(5/24)) = 0.4481042327. Brier = ((0.6026853380 - 1)^2 +
  // 0.4481042327^2) / 2 = 0.1793281720.
  close(kickoff.v1.brier, 0.1793281720246963, 1e-12, 'kickoff v1 brier');

  // In-game: the two graded live rows, p 0.7 (o 1) and p 0.2 (o 0): Brier
  // (0.09 + 0.04) / 2 = 0.065. One of them is flagged.
  assert.equal(inGame.count, 2);
  close(inGame.v2.brier, 0.065, 1e-12, 'in-game v2 brier');
  assert.equal(inGame.flaggedCount, 1);

  assert.equal(played.count, 1);
  assert.equal(played.v2.brier, 0);

  // Flagged rows (starters_without_interval > 0) are reported on their own too.
  assert.equal(flagged.count, 1);
  close(flagged.v2.brier, 0.04, 1e-12, 'flagged v2 brier');
});

test('the kickoff row is the LAST scheduled row per matchup, the freshest forecast before its first game', () => {
  // The recorder writes only during live score passes, so a Sunday matchup's
  // first scheduled row is captured during Thursday night's game, days before
  // lineups settle. Matchup 31 won at home (o = 1).
  //   Thursday 23:00 row: 100 vs 105, v2 p 0.3.
  //   Sunday 16:45 row:   110 vs 100, v2 p 0.7.
  // Grading Sunday: v2 Brier (1 - 0.7)^2 = 0.09, v1 (1 - 0.6026853380)^2 =
  // 0.1578589407. Grading Thursday would give v2 (1 - 0.3)^2 = 0.49.
  const results = new Map([[31, { homeScore: 118, awayScore: 104 }]]);
  const rows = [
    shadowRow({ matchup_id: 31, status: 'scheduled', captured_at: '2026-10-04T16:45:00Z', home_expected_final: '110.00', away_expected_final: '100.00', mu: '10.000', sigma: '30.000', home_probability: 0.7 }),
    shadowRow({ matchup_id: 31, status: 'scheduled', captured_at: '2026-10-01T23:00:00Z', home_expected_final: '100.00', away_expected_final: '105.00', mu: '-5.000', sigma: '30.000', home_probability: 0.3 }),
  ];

  const { kickoff, inGame, played } = evaluateShadowRows({ rows, results }).checkpoints;

  assert.equal(kickoff.count, 1);
  close(kickoff.v2.brier, 0.09, 1e-12, 'kickoff v2 brier');
  close(kickoff.v1.brier, 0.1578589406572654, 1e-12, 'kickoff v1 brier');
  // The Thursday row is in no checkpoint group.
  assert.equal(inGame.count, 0);
  assert.equal(played.count, 0);
});

test('played rows report how many are exactly 0 or 1, for v1 and v2', () => {
  const results = new Map([
    [11, { homeScore: 100, awayScore: 90 }], [12, { homeScore: 80, awayScore: 90 }],
    [13, { homeScore: 95, awayScore: 95 }], [14, { homeScore: 100, awayScore: 99 }],
  ]);
  const played = (matchupId, p, mu, homeEf, awayEf) => shadowRow({
    matchup_id: matchupId, status: 'played', captured_at: '2026-10-05T03:00:00Z',
    home_score: homeEf, away_score: awayEf, home_expected_final: homeEf, away_expected_final: awayEf,
    mu, sigma: '0.000', home_probability: p,
  });
  const notExact = played(14, 0.9999, '1.000', '100.00', '99.00');
  const rows = [
    played(11, 1, '10.000', '100.00', '90.00'),
    played(12, 0, '-10.000', '80.00', '90.00'),
    // A tie once over: equal Expected finals, v2 says 0.5, which is exact.
    played(13, 0.5, '0.000', '95.00', '95.00'),
    notExact,
  ];

  const { certainty } = evaluateShadowRows({ rows, results }).checkpoints.played;

  assert.equal(certainty.v2.rows, 4);
  assert.equal(certainty.v2.exact, 3);
  assert.deepEqual(certainty.v2.nonExactRowIds, [notExact.id]);
  // v1's fixed scale never arrives at certainty.
  assert.equal(certainty.v1.exact, 1); // only the tie: 0.5 on equal Expected finals
});

test('an optional k rescales each stored v2 probability from its own mu and sigma', () => {
  // Recorded at k = 1 with mu 10 and sigma 10: Phi(1) = 0.8413447. Graded at
  // k = 2 the spread doubles: Phi(10 / 20) = Phi(0.5) = 0.6914625, so the
  // kickoff Brier for a home win is (1 - 0.6914625)^2 = 0.0951954.
  const results = new Map([[21, { homeScore: 120, awayScore: 100 }]]);
  const rows = [
    shadowRow({ matchup_id: 21, status: 'scheduled', captured_at: '2026-10-04T12:00:00Z', home_expected_final: '110.00', away_expected_final: '100.00', mu: '10.000', sigma: '10.000', home_probability: 0.8413447361676363 }),
    shadowRow({ matchup_id: 21, status: 'played', captured_at: '2026-10-04T23:00:00Z', home_score: '120.00', away_score: '100.00', home_expected_final: '120.00', away_expected_final: '100.00', mu: '20.000', sigma: '0.000', home_probability: 1 }),
  ];

  const stored = evaluateShadowRows({ rows, results });
  close(stored.checkpoints.kickoff.v2.brier, (1 - 0.8413447361676363) ** 2, 1e-12, 'stored k');
  const rescaled = evaluateShadowRows({ rows, results, k: 2 });
  close(rescaled.checkpoints.kickoff.v2.brier, 0.09519541190834291, 1e-6, 'rescaled k');
  assert.equal(rescaled.k, 2);
  // Zero spread stays zero spread: a played row is still exact.
  assert.equal(rescaled.checkpoints.played.certainty.v2.exact, 1);
});

// --- The gate verdict ---

// `n` matchups from `firstId`, the first `wins` of them won at home. Each gets
// a row at `status` with v2 probability `p` and Expected finals of 100 each
// (so v1 says exactly 0.5 and its Brier score is 0.25), and a certain played
// row that called the result.
function week({ firstId, n, wins, p, status = 'scheduled', playedP = null }) {
  const rows = [];
  const results = new Map();
  for (let i = 0; i < n; i += 1) {
    const matchupId = firstId + i;
    const won = i < wins;
    results.set(matchupId, won ? { homeScore: 110, awayScore: 100 } : { homeScore: 100, awayScore: 110 });
    rows.push(shadowRow({
      matchup_id: matchupId, status, captured_at: '2026-10-04T12:00:00Z',
      home_expected_final: '100.00', away_expected_final: '100.00', mu: '0.000', sigma: '30.000', home_probability: p,
    }));
    rows.push(shadowRow({
      matchup_id: matchupId, status: 'played', captured_at: '2026-10-05T04:00:00Z',
      home_score: won ? '110.00' : '100.00', away_score: won ? '100.00' : '110.00',
      home_expected_final: won ? '110.00' : '100.00', away_expected_final: won ? '100.00' : '110.00',
      mu: won ? '10.000' : '-10.000', sigma: '0.000', home_probability: playedP == null ? (won ? 1 : 0) : playedP,
    }));
  }
  return { rows, results };
}
const merged = (...parts) => ({
  rows: parts.flatMap((part) => part.rows),
  results: new Map(parts.flatMap((part) => [...part.results])),
});
const check = (verdict, name) => verdict.checks.find((c) => c.name === name);

test('the gate passes when v2 beats v1 at kickoff, its bins are reliable and every played row is exact', () => {
  // 20 kickoff rows at p 0.75, 15 won: observed 0.75, the bin is exact. v2
  // Brier = (15 x 0.25^2 + 5 x 0.75^2) / 20 = (0.9375 + 2.8125) / 20 = 0.1875,
  // below v1's 0.25.
  const verdict = gateVerdict(evaluateShadowRows(week({ firstId: 100, n: 20, wins: 15, p: 0.75 })));
  assert.equal(check(verdict, 'kickoff_brier').pass, true);
  assert.equal(check(verdict, 'reliability').pass, true);
  assert.equal(check(verdict, 'played_exact').pass, true);
  assert.equal(verdict.pass, true);
});

test('the gate fails when v2 Brier at kickoff is above v1', () => {
  // p 0.25 but 15 of 20 won: v2 Brier = (15 x 0.75^2 + 5 x 0.25^2) / 20 =
  // 0.4375, above v1's 0.25.
  const verdict = gateVerdict(evaluateShadowRows(week({ firstId: 200, n: 20, wins: 15, p: 0.25 })));
  assert.equal(check(verdict, 'kickoff_brier').pass, false);
  assert.equal(verdict.pass, false);
});

test('a reliability bin with 20 or more rows more than 5 points off fails the gate', () => {
  // Kickoff is fine; 20 in-game rows at p 0.75 of which only 12 won (observed
  // 0.60, 15 points off) put the in-game 0.7 bin out of tolerance.
  const verdict = gateVerdict(evaluateShadowRows(merged(
    week({ firstId: 300, n: 20, wins: 15, p: 0.75 }),
    week({ firstId: 400, n: 20, wins: 12, p: 0.75, status: 'live' }),
  )));
  assert.equal(check(verdict, 'kickoff_brier').pass, true);
  assert.equal(check(verdict, 'reliability').pass, false);
  assert.equal(verdict.pass, false);
});

test('a bin with fewer than 20 rows is not held to the 5-point tolerance', () => {
  // 19 in-game rows at p 0.75, 5 won (observed 0.26): too few to judge.
  const verdict = gateVerdict(evaluateShadowRows(merged(
    week({ firstId: 500, n: 20, wins: 15, p: 0.75 }),
    week({ firstId: 600, n: 19, wins: 5, p: 0.75, status: 'live' }),
  )));
  assert.equal(check(verdict, 'reliability').pass, true);
  assert.equal(verdict.pass, true);
});

test('with no bin of 20 rows the reliability check fails for want of evidence', () => {
  const verdict = gateVerdict(evaluateShadowRows(week({ firstId: 700, n: 19, wins: 14, p: 0.75 })));
  assert.equal(check(verdict, 'reliability').pass, false);
  assert.match(check(verdict, 'reliability').detail, /no bin/i);
});

test('a played row that is not exactly 0 or 1 fails the gate', () => {
  const verdict = gateVerdict(evaluateShadowRows(week({ firstId: 800, n: 20, wins: 15, p: 0.75, playedP: 0.97 })));
  assert.equal(check(verdict, 'played_exact').pass, false);
  assert.equal(verdict.pass, false);
});

test('no kickoff rows or no played rows is no evidence, and fails its check', () => {
  const verdict = gateVerdict(evaluateShadowRows({ rows: [], results: new Map() }));
  assert.equal(check(verdict, 'kickoff_brier').pass, false);
  assert.equal(check(verdict, 'played_exact').pass, false);
  assert.equal(verdict.pass, false);
});

// --- Fitting k at kickoff ---

test('the default k grid runs 0.6 to 1.8 in steps of 0.05, with no float drift', () => {
  const grid = kGrid();
  assert.equal(grid.length, 25);
  assert.equal(grid[0], 0.6);
  assert.equal(grid[24], 1.8);
  assert.ok(grid.includes(1.2));
  assert.ok(grid.includes(0.7), '0.6 + 2 x 0.05 must be exactly 0.7');
  assert.deepEqual(kGrid({ from: 1, to: 1.2, step: 0.1 }), [1, 1.1, 1.2]);
});

test('fitK picks the k that minimises v2 log loss at kickoff, reporting Brier beside it and v1 at the same checkpoint', () => {
  // Six identical matchups, projections 111.61 vs 100 (mu 11.61), each side's
  // variance 50 (sigma 10 at k = 1), five won at home and one lost. The
  // likelihood peaks where Phi(1.161 / k) = 5/6, i.e. 1.161 / k =
  // Phi^-1(5/6) = 0.9674216, k = 1.2001, so 1.2 is the best grid point.
  // There p = 5/6 (to 1e-4) and by hand:
  //   log loss = -(5 ln(5/6) + ln(1/6)) / 6 = (0.9116078 + 1.7917595) / 6
  //            = 0.4505612
  //   Brier    = (5 x (1/6)^2 + (5/6)^2) / 6 = 5/36 = 0.1388889
  // v1 at kickoff (no points yet) is 1 / (1 + e^(-11.61/24)) = 0.6186330:
  //   Brier    = (5 x 0.381367^2 + 0.618633^2) / 6 = 0.1849851
  //   log loss = -(5 ln 0.618633 + ln 0.381367) / 6 = 0.5608681
  const matchup = (won) => ({
    homeExpectedFinal: 111.61, awayExpectedFinal: 100, homeVariance: 50, awayVariance: 50,
    finalHomeScore: won ? 120 : 90, finalAwayScore: 100,
  });
  const samples = [matchup(true), matchup(true), matchup(true), matchup(true), matchup(true), matchup(false),
    // No projection on one side: no v2, so not a sample.
    { ...matchup(true), homeExpectedFinal: null },
    // Not settled: no outcome, so not a sample.
    { ...matchup(true), finalHomeScore: null }];

  const fit = fitK({ samples, kGrid: kGrid() });

  assert.equal(fit.count, 6);
  assert.equal(fit.skipped, 2);
  assert.equal(fit.grid.length, 25);
  assert.equal(fit.best.k, 1.2);
  close(fit.best.logLoss, 0.4505612, 1e-6, 'best log loss');
  close(fit.best.brier, 5 / 36, 1e-6, 'best brier');
  const at115 = fit.grid.find((g) => g.k === 1.15);
  const at125 = fit.grid.find((g) => g.k === 1.25);
  assert.ok(at115.logLoss > fit.best.logLoss && at125.logLoss > fit.best.logLoss, 'neighbours are worse');
  close(fit.v1.brier, 0.1849851, 1e-6, 'v1 brier');
  close(fit.v1.logLoss, 0.5608681, 1e-6, 'v1 log loss');
  assert.equal(fit.v1.clamps, 0);
});

test('fitK with no usable samples has no best k', () => {
  const fit = fitK({ samples: [], kGrid: kGrid() });
  assert.equal(fit.count, 0);
  assert.equal(fit.best, null);
});
