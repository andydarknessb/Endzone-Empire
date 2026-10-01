'use strict';

/**
 * Calibration gate for the Threshold probability and the pairwise start/sit
 * probability (spec #1845, ticket #1848). Pure: snapshot rows and actual points
 * in, reliability tables and a PASS or FAIL out. The runner
 * (`scripts/holdout/calibration-readout.js`) does the I/O.
 *
 * A row is the Interval reading module's row (playerId, position, p10..p90,
 * sampleSize, factors, pointEstimate), plus `mean` and `median` for the pairwise
 * probability. `actuals` is a Map<playerId, points> priced under the snapshot's
 * own scoring profile; a player with no entry is left out (no basis to judge).
 */

const reading = require('../../../server/services/intervalReading');
const { probabilityBetter } = require('../../../server/services/projectionModel');

// A bin is judged only with at least this many player-weeks (or pairs) ...
const MIN_BIN_COUNT = 50;
// ... and passes when observed lands within this of the stated probability.
const MAX_GAP = 0.1;
const GAP_EPSILON = 1e-9;

/** Ten-point bin index 0..9 for a probability in [0, 1]; 1 falls in the top bin. */
function binOf(p) {
  return Math.min(9, Math.floor(p * 10 + 1e-9));
}

const binLabel = (i) => `${i * 10}-${i * 10 + 10}%`;

/**
 * Reliability table from `[{ predicted, outcome }]` (outcome 1, 0.5 or 0). One
 * entry per non-empty bin, ascending, with the verdict over the judged bins.
 */
function reliabilityTable(observations) {
  const bins = new Map();
  for (const { predicted, outcome } of observations) {
    const i = binOf(predicted);
    if (!bins.has(i)) bins.set(i, { n: 0, predicted: 0, outcome: 0 });
    const bin = bins.get(i);
    bin.n += 1;
    bin.predicted += predicted;
    bin.outcome += outcome;
  }
  const rows = [...bins.keys()].sort((a, b) => a - b).map((i) => {
    const { n, predicted, outcome } = bins.get(i);
    const meanPredicted = predicted / n;
    const observed = outcome / n;
    const gap = observed - meanPredicted;
    const judged = n >= MIN_BIN_COUNT;
    return {
      bin: binLabel(i),
      n,
      meanPredicted,
      observed,
      gap,
      judged,
      pass: judged ? Math.abs(gap) <= MAX_GAP + GAP_EPSILON : null,
    };
  });
  const judgedRows = rows.filter((r) => r.judged);
  return {
    rows,
    // No judged bin is no evidence: that fails, it does not pass by silence.
    pass: judgedRows.length > 0 && judgedRows.every((r) => r.pass),
    judgedBins: judgedRows.length,
  };
}

/** One observation per eligible player-week and threshold of his position. */
function thresholdObservations(rows, actuals) {
  const out = [];
  for (const row of rows) {
    const points = actuals.get(row.playerId);
    if (points === undefined) continue;
    const probabilities = reading.thresholdProbabilities(row);
    if (!probabilities) continue;
    for (const { threshold, probability } of probabilities) {
      out.push({ threshold, predicted: probability, outcome: points >= threshold ? 1 : 0 });
    }
  }
  return out;
}

/**
 * One observation per same-position pair of eligible players. The favored side
 * is the one `probabilityBetter` puts above 0.5 (a pair at exactly 0.5 favors
 * nobody and is skipped); the outcome is whether he outscored the other, a tie
 * in points counting half like the probability's own ties.
 */
function pairObservations(rows, actuals) {
  const byPosition = new Map();
  for (const row of rows) {
    if (!reading.isEligible(row) || !actuals.has(row.playerId)) continue;
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(row);
  }
  const out = [];
  for (const group of byPosition.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const p = probabilityBetter(group[i], group[j]);
        if (p === null || p === 0.5) continue;
        const [favored, other, predicted] = p > 0.5
          ? [group[i], group[j], p]
          : [group[j], group[i], 1 - p];
        const a = actuals.get(favored.playerId);
        const b = actuals.get(other.playerId);
        out.push({ predicted, outcome: a > b ? 1 : a === b ? 0.5 : 0 });
      }
    }
  }
  return out;
}

/**
 * `snapshots`: `[{ week, profile, rows, actuals }]`, the scheduled arm only.
 * Threshold bins pool every position and profile per threshold value; the pair
 * table pools every position and profile.
 */
function buildReadout(snapshots) {
  const thresholdObs = [];
  const pairObs = [];
  for (const { rows, actuals } of snapshots) {
    thresholdObs.push(...thresholdObservations(rows, actuals));
    pairObs.push(...pairObservations(rows, actuals));
  }
  const thresholds = [...new Set(thresholdObs.map((o) => o.threshold))].sort((a, b) => a - b);
  const byThreshold = thresholds.map((threshold) => ({
    threshold,
    table: reliabilityTable(thresholdObs.filter((o) => o.threshold === threshold)),
  }));
  return {
    threshold: {
      byThreshold,
      pass: byThreshold.length > 0 && byThreshold.every((t) => t.table.pass),
    },
    pairwise: reliabilityTable(pairObs),
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const gapPoints = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

function renderTable(table) {
  const lines = ['| Bin | Count | Mean predicted | Observed | Gap (points) |', '| --- | ---: | ---: | ---: | ---: |'];
  for (const r of table.rows) {
    const note = r.judged ? (r.pass ? '' : ' (outside 10)') : ' (under 50, not judged)';
    lines.push(`| ${r.bin} | ${r.n} | ${pct(r.meanPredicted)} | ${pct(r.observed)} | ${gapPoints(r.gap)}${note} |`);
  }
  return lines.join('\n');
}

const verdictLine = (pass) => `**${pass ? 'PASS' : 'FAIL'}**: every bin holding at least ${MIN_BIN_COUNT} must land within ${MAX_GAP * 100} points of its stated probability.`;

/**
 * Markdown readout. `meta`: `{ season, weeks: number[], profiles: string[],
 * basis: string }`.
 */
function renderReadout(result, meta) {
  const out = [
    '# Calibration readout (spec #1845, ticket #1848)',
    '',
    `- Season ${meta.season}, scheduled arm, weeks included: ${meta.weeks.join(', ') || 'none'}`,
    `- Profiles pooled: ${meta.profiles.join(', ')}`,
    `- Actuals basis: ${meta.basis}`,
    '',
    '## Threshold probability',
    '',
  ];
  for (const { threshold, table } of result.threshold.byThreshold) {
    out.push(`### ${threshold}+ points`, '', renderTable(table), '');
  }
  out.push(verdictLine(result.threshold.pass), '', '## Pairwise start/sit probability', '', renderTable(result.pairwise), '');
  out.push(verdictLine(result.pairwise.pass), '');
  return out.join('\n');
}

module.exports = {
  MIN_BIN_COUNT,
  MAX_GAP,
  binOf,
  reliabilityTable,
  thresholdObservations,
  pairObservations,
  buildReadout,
  renderReadout,
};
