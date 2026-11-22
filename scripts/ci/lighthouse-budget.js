#!/usr/bin/env node
/**
 * Median Lighthouse budget gate for the weekly landing-page run (#3002, spec #2998).
 *
 * The Lighthouse workflow runs the production landing page three times and
 * passes the three JSON reports here. One run is noisy, so each metric is
 * judged on its median across the reports. The medians print as a Markdown
 * table (also appended to GITHUB_STEP_SUMMARY when set), and the script exits
 * 1 when any median breaks its budget.
 *
 * A report that lacks a metric, or holds null for it, exits 1 and names the
 * report and the metric. It never counts as a pass.
 *
 * Zero dependencies on purpose: the workflow runs this on a bare checkout with
 * only Node's standard library, the same as audit-with-retry.js.
 */
const fs = require('node:fs');

// shortcut: budgets set from three runs on 2026-11-21 (medians perf 0.96, a11y 1, bp 1, LCP 919 ms, TBT 238.5 ms, CLS 0) and not yet measured on a GitHub runner, tighten after four green weeks.
const BUDGETS = {
  performance: { min: 0.86 },
  accessibility: { min: 0.9 },
  'best-practices': { min: 0.9 },
  'largest-contentful-paint': { max: 4000 },
  'total-blocking-time': { max: 600 },
  'cumulative-layout-shift': { max: 0.1 },
};

// Where each metric sits in a Lighthouse JSON report.
const READERS = {
  performance: (r) => r.categories?.performance?.score,
  accessibility: (r) => r.categories?.accessibility?.score,
  'best-practices': (r) => r.categories?.['best-practices']?.score,
  'largest-contentful-paint': (r) => r.audits?.['largest-contentful-paint']?.numericValue,
  'total-blocking-time': (r) => r.audits?.['total-blocking-time']?.numericValue,
  'cumulative-layout-shift': (r) => r.audits?.['cumulative-layout-shift']?.numericValue,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Returns { rows, errors }. Rows exist only for metrics every report supplies;
// errors name each report and metric that has no number.
function judge(reports) {
  const errors = [];
  const rows = [];
  for (const [metric, budget] of Object.entries(BUDGETS)) {
    const values = [];
    for (const { file, json } of reports) {
      const value = READERS[metric](json);
      if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
      else errors.push(`${file}: no ${metric} (missing or null)`);
    }
    if (values.length === reports.length) {
      const value = median(values);
      const pass = 'min' in budget ? value >= budget.min : value <= budget.max;
      rows.push({ metric, value, budget, pass });
    }
  }
  return { rows, errors };
}

const format = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
const budgetText = (budget) => ('min' in budget ? `>= ${budget.min}` : `<= ${budget.max}`);

function table(rows) {
  const lines = ['| Metric | Median | Budget | Result |', '| --- | --- | --- | --- |'];
  for (const { metric, value, budget, pass } of rows) {
    lines.push(`| ${metric} | ${format(value)} | ${budgetText(budget)} | ${pass ? 'pass' : 'fail'} |`);
  }
  return lines.join('\n');
}

function main(argv, env = process.env, io = console) {
  if (argv.length === 0) {
    io.error('usage: node scripts/ci/lighthouse-budget.js <report.json> [<report.json> ...]');
    return 1;
  }
  const reports = [];
  for (const file of argv) {
    try {
      reports.push({ file, json: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } catch (err) {
      io.error(`lighthouse-budget: ${file} is not a readable JSON report: ${err.message}`);
      return 1;
    }
  }
  const { rows, errors } = judge(reports);
  if (errors.length) {
    for (const error of errors) io.error(`lighthouse-budget: ${error}`);
    return 1;
  }
  const markdown = table(rows);
  io.log(markdown);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  const broken = rows.filter((row) => !row.pass);
  for (const { metric, value, budget } of broken) {
    io.error(`lighthouse-budget: ${metric} median ${format(value)} breaks its budget ${budgetText(budget)}`);
  }
  return broken.length ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { BUDGETS, median, judge, main };
