/**
 * Win probability v2's evaluation (Home v2 spec, "Win probability v2" board,
 * "Calibration and gate"), pure. Scores v1 and v2 against the real results so
 * v2 replaces v1 only on evidence. Two callers, both thin scripts that gather
 * rows and print:
 *   - scripts/win-prob-shadow-report.js grades the shadow rows the live score
 *     pass recorded (winProbabilityShadow.service) against each matchup's
 *     settled score, by checkpoint, and states the gate verdict.
 *   - scripts/backtest-win-prob-k.js fits the calibration constant k by
 *     minimising v2's log loss at kickoff over completed weeks.
 *
 * Metrics: the Brier score (mean squared gap between probability and
 * outcome), log loss (mean negative log likelihood; probabilities clamped to
 * [1e-6, 1 - 1e-6] for log loss only, every clamp counted, since v2 says
 * exactly 0 or 1 once the games are over and ln 0 is not a number), and a
 * 10-bin reliability table. A tie is graded as an outcome of 0.5.
 *
 * v1 is never stored: each row carries both sides' scores and Expected
 * finals, and v1 is recomputed from them by winProbabilityV1.js, the server
 * port the parity test pins to the client's own function.
 */

const { normalCdf, winProbabilityV2 } = require('./winProbability');
const { matchupWinProbability: winProbabilityV1 } = require('./winProbabilityV1');

const LOG_LOSS_EPSILON = 1e-6;
const RELIABILITY_BINS = 10;
// The gate: a reliability bin is judged once it holds this many rows, and
// must then sit within this many probability points of its observed rate.
const RELIABILITY_MIN_ROWS = 20;
const RELIABILITY_TOLERANCE = 0.05;
// Float slack for the tolerance comparison only (0.8 - 0.75 is 0.0500000000000000444).
const TOLERANCE_SLACK = 1e-9;

/** 1 for a home win, 0 for a home loss, 0.5 for a tie, null without both scores. */
function outcomeFromScores(homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  if (home > away) return 1;
  if (home < away) return 0;
  return 0.5;
}

/** Mean of (p - o)^2 over `[{ p, o }]`; null for no pairs. */
function brierScore(pairs) {
  if (!pairs.length) return null;
  return pairs.reduce((sum, { p, o }) => sum + (p - o) * (p - o), 0) / pairs.length;
}

/**
 * `{ logLoss, clamps }` over `[{ p, o }]`: the mean of
 * -(o ln p + (1 - o) ln(1 - p)) with p clamped to [1e-6, 1 - 1e-6], and how
 * many probabilities the clamp moved. logLoss is null for no pairs.
 */
function logLoss(pairs) {
  let clamps = 0;
  let sum = 0;
  for (const { p, o } of pairs) {
    const clamped = Math.min(1 - LOG_LOSS_EPSILON, Math.max(LOG_LOSS_EPSILON, p));
    if (clamped !== p) clamps += 1;
    sum -= o * Math.log(clamped) + (1 - o) * Math.log(1 - clamped);
  }
  return { logLoss: pairs.length ? sum / pairs.length : null, clamps };
}

/**
 * Ten equal bins over [0, 1] (a bin's lower edge belongs to it, and p = 1
 * lands in the top bin): `[{ bin, lower, upper, count, meanPredicted,
 * observedRate }]`, the means null for an empty bin.
 */
function reliabilityTable(pairs) {
  const bins = Array.from({ length: RELIABILITY_BINS }, (_, bin) => ({ bin, count: 0, sumP: 0, sumO: 0 }));
  for (const { p, o } of pairs) {
    const index = Math.min(RELIABILITY_BINS - 1, Math.max(0, Math.floor(p * RELIABILITY_BINS)));
    bins[index].count += 1;
    bins[index].sumP += p;
    bins[index].sumO += o;
  }
  return bins.map(({ bin, count, sumP, sumO }) => ({
    bin,
    lower: bin / RELIABILITY_BINS,
    upper: (bin + 1) / RELIABILITY_BINS,
    count,
    meanPredicted: count ? sumP / count : null,
    observedRate: count ? sumO / count : null,
  }));
}

/** Every metric for one model over `[{ p, o }]`. */
function scoreModel(pairs) {
  const { logLoss: loss, clamps } = logLoss(pairs);
  return { count: pairs.length, brier: brierScore(pairs), logLoss: loss, clamps, reliability: reliabilityTable(pairs) };
}

const millis = (at) => new Date(at).getTime();

/** v1 for a shadow row, exactly as the client computes it from the row's figures. */
function v1ForRow(row) {
  return winProbabilityV1({
    homeScore: row.home_score,
    awayScore: row.away_score,
    homeExpectedFinal: row.home_expected_final,
    awayExpectedFinal: row.away_expected_final,
    status: row.status,
  }).home;
}

/**
 * v2 for a shadow row: the stored probability, or, when grading at another
 * `k`, the same mu over the row's sigma rescaled from the k it was recorded
 * at. A row with no spread left keeps its stored 1, 0 or 0.5.
 */
function v2ForRow(row, k) {
  const stored = Number(row.home_probability);
  if (k == null) return stored;
  const sigma = Number(row.sigma);
  if (!(sigma > 0)) return stored;
  const recordedK = Number(row.k) || 1;
  return normalCdf(Number(row.mu) / (sigma * (k / recordedK)));
}

/**
 * Exactly certain: 0 or 1, or 0.5 on equal Expected finals (a matchup that
 * ends tied once over, which both models rightly call a coin flip).
 */
function isExact(p, row) {
  if (p === 0 || p === 1) return true;
  return p === 0.5 && Number(row.home_expected_final) === Number(row.away_expected_final);
}

function certaintyOf(graded) {
  const v1Exact = graded.filter((g) => isExact(g.v1, g.row)).length;
  const v2NonExact = graded.filter((g) => !isExact(g.v2, g.row));
  return {
    v1: { rows: graded.length, exact: v1Exact },
    v2: { rows: graded.length, exact: graded.length - v2NonExact.length, nonExactRowIds: v2NonExact.map((g) => g.row.id) },
  };
}

function groupReport(graded) {
  return {
    count: graded.length,
    flaggedCount: graded.filter((g) => g.flagged).length,
    v1: scoreModel(graded.map((g) => ({ p: g.v1, o: g.o }))),
    v2: scoreModel(graded.map((g) => ({ p: g.v2, o: g.o }))),
  };
}

/**
 * Grade `win_probability_shadow` rows against each matchup's settled score.
 * `results` is a Map<matchupId, { homeScore, awayScore }> of SETTLED
 * matchups only; a row whose matchup is not in it is counted, not graded.
 * `k` (optional) grades v2 at a calibration constant other than the one
 * each row was recorded at.
 *
 * Checkpoints:
 *   - kickoff: each matchup's LAST `scheduled` row by captured_at, the
 *     freshest forecast before its first starter kicks off. The recorder
 *     writes only during live score passes, so a Sunday matchup's first
 *     scheduled row is captured during Thursday night's game, days before
 *     lineups settle. Earlier scheduled rows are in no checkpoint group;
 *   - inGame:  every `live` row;
 *   - played:  every `played` row (every game over, the week not settled),
 *              plus how many are exactly certain;
 *   - flagged: every graded row with starters_without_interval > 0 (starters
 *              with game time left but no Interval, so sigma is too small),
 *              whatever its status. Flagged rows also stay in their checkpoint.
 */
function evaluateShadowRows({ rows = [], results = new Map(), k = null } = {}) {
  const graded = [];
  let rowsWithoutResult = 0;
  for (const row of rows) {
    const result = results.get(Number(row.matchup_id));
    const o = result ? outcomeFromScores(result.homeScore, result.awayScore) : null;
    if (o == null) {
      rowsWithoutResult += 1;
      continue;
    }
    graded.push({
      row,
      o,
      v1: v1ForRow(row),
      v2: v2ForRow(row, k),
      flagged: Number(row.starters_without_interval) > 0,
    });
  }

  const lastScheduled = new Map();
  for (const g of graded) {
    if (g.row.status !== 'scheduled') continue;
    const key = Number(g.row.matchup_id);
    const current = lastScheduled.get(key);
    if (!current || millis(g.row.captured_at) > millis(current.row.captured_at)) lastScheduled.set(key, g);
  }
  const played = graded.filter((g) => g.row.status === 'played');

  return {
    k,
    rowsTotal: rows.length,
    rowsGraded: graded.length,
    rowsWithoutResult,
    checkpoints: {
      kickoff: groupReport([...lastScheduled.values()]),
      inGame: groupReport(graded.filter((g) => g.row.status === 'live')),
      played: { ...groupReport(played), certainty: certaintyOf(played) },
      flagged: groupReport(graded.filter((g) => g.flagged)),
    },
  };
}

const fmt = (x) => (x == null ? 'n/a' : x.toFixed(4));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * The ship gate over an evaluateShadowRows report: `{ pass, checks }`, each
 * check `{ name, pass, detail }`. All three must pass:
 *   - kickoff_brier: v2's Brier score at kickoff at or below v1's;
 *   - reliability:   every v2 bin with at least 20 rows, at kickoff and in
 *                    game, within 5 points of its observed win rate (played
 *                    rows are held to exactness instead, where a bin says
 *                    nothing more);
 *   - played_exact:  every played row exactly 0 or 1 (0.5 on a tie).
 * A check with no evidence (no kickoff rows, no bin of 20, no played rows)
 * fails: a gate that passes on nothing is not a gate.
 */
function gateVerdict(report) {
  const { kickoff, inGame, played } = report.checkpoints;
  const checks = [];

  const kickoffPass = kickoff.count > 0 && kickoff.v2.brier <= kickoff.v1.brier;
  checks.push({
    name: 'kickoff_brier',
    pass: kickoffPass,
    detail: kickoff.count > 0
      ? `v2 ${fmt(kickoff.v2.brier)} vs v1 ${fmt(kickoff.v1.brier)} over ${kickoff.count} kickoff rows`
      : 'no kickoff rows to compare',
  });

  const judged = [];
  for (const [checkpoint, group] of [['kickoff', kickoff], ['inGame', inGame]]) {
    for (const bin of group.v2.reliability) {
      if (bin.count < RELIABILITY_MIN_ROWS) continue;
      const gap = Math.abs(bin.meanPredicted - bin.observedRate);
      judged.push({ checkpoint, bin: bin.bin, gap, ok: gap <= RELIABILITY_TOLERANCE + TOLERANCE_SLACK });
    }
  }
  const offBins = judged.filter((b) => !b.ok);
  checks.push({
    name: 'reliability',
    pass: judged.length > 0 && offBins.length === 0,
    detail: judged.length === 0
      ? `no bin with ${RELIABILITY_MIN_ROWS} or more rows at kickoff or in game`
      : offBins.length === 0
        ? `${judged.length} bins of ${RELIABILITY_MIN_ROWS}+ rows, all within ${pct(RELIABILITY_TOLERANCE)}`
        : `${offBins.length} of ${judged.length} bins off: ${offBins
          .map((b) => `${b.checkpoint} bin ${b.bin} by ${pct(b.gap)}`).join(', ')}`,
  });

  const { rows, exact } = played.certainty.v2;
  checks.push({
    name: 'played_exact',
    pass: rows > 0 && exact === rows,
    detail: rows > 0 ? `${exact} of ${rows} played rows exactly 0 or 1` : 'no played rows',
  });

  return { pass: checks.every((c) => c.pass), checks };
}

/**
 * The calibration grid for k, `from` to `to` inclusive by `step`, each
 * value rounded to 1e-6 so 0.6 + 2 x 0.05 is 0.7 and not 0.7000000000000001.
 */
function kGrid({ from = 0.6, to = 1.8, step = 0.05 } = {}) {
  const count = Math.floor((to - from) / step + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => Math.round((from + i * step) * 1e6) / 1e6);
}

/**
 * Fit k by minimising v2's log loss at kickoff (the "Calibration and gate"
 * backtest). Each sample is one settled matchup before any starter kicked off:
 *   { homeExpectedFinal, awayExpectedFinal,   the weekly projections summed
 *     homeVariance, awayVariance,             sum of sigma_i^2 per lineup
 *     finalHomeScore, finalAwayScore }        the settled result
 * A sample with no v2 (a side without an Expected final) or no outcome is
 * skipped and counted. Returns
 *   { count, skipped, grid: [{ k, logLoss, brier, clamps }],
 *     best: { k, logLoss, brier, clamps } | null,   lowest log loss, ties to
 *                                                   the smaller k
 *     v1: { logLoss, brier, clamps } }              v1 at the same checkpoint
 * v1 before kickoff has no points on the board, so it is the client's
 * function at scores of 0.
 */
function fitK({ samples = [], kGrid: grid = kGrid() } = {}) {
  const usable = [];
  for (const sample of samples) {
    const o = outcomeFromScores(sample.finalHomeScore, sample.finalAwayScore);
    const hasV2 = sample.homeExpectedFinal != null && sample.awayExpectedFinal != null;
    if (o == null || !hasV2) continue;
    usable.push({ sample, o });
  }

  const rows = grid.map((k) => {
    const pairs = usable.map(({ sample, o }) => ({
      p: winProbabilityV2({
        homeExpectedFinal: sample.homeExpectedFinal,
        awayExpectedFinal: sample.awayExpectedFinal,
        homeVariance: sample.homeVariance,
        awayVariance: sample.awayVariance,
        k,
      }).home,
      o,
    }));
    const { logLoss: loss, clamps } = logLoss(pairs);
    return { k, logLoss: loss, brier: brierScore(pairs), clamps };
  });

  let best = null;
  if (usable.length > 0) {
    for (const row of rows) if (best == null || row.logLoss < best.logLoss) best = row;
  }

  const v1Pairs = usable.map(({ sample, o }) => ({
    p: winProbabilityV1({
      homeScore: 0,
      awayScore: 0,
      homeExpectedFinal: sample.homeExpectedFinal,
      awayExpectedFinal: sample.awayExpectedFinal,
    }).home,
    o,
  }));
  const v1Loss = logLoss(v1Pairs);

  return {
    count: usable.length,
    skipped: samples.length - usable.length,
    grid: rows,
    best,
    v1: { logLoss: v1Loss.logLoss, brier: brierScore(v1Pairs), clamps: v1Loss.clamps },
  };
}

module.exports = {
  LOG_LOSS_EPSILON,
  RELIABILITY_BINS,
  RELIABILITY_MIN_ROWS,
  RELIABILITY_TOLERANCE,
  outcomeFromScores,
  brierScore,
  logLoss,
  reliabilityTable,
  scoreModel,
  v1ForRow,
  evaluateShadowRows,
  gateVerdict,
  kGrid,
  fitK,
};
