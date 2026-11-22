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
 * A report that measured another page than the landing page, or that lacks a
 * metric or holds null for one, exits 1 and names the report. It never counts
 * as a pass.
 *
 * Zero dependencies on purpose: the workflow runs this on a bare checkout with
 * only Node's standard library, the same as audit-with-retry.js.
 */
const fs = require('node:fs');

const SITE_HOST = 'endzoneempire.gg';

// shortcut: budgets set from the medians of run 44968827720 on a GitHub runner on 2026-11-22 (performance 0.90, LCP 884 ms, TBT 421 ms, CLS 0), where a faster desktop scored 0.96; tighten after four green weeks.
const BUDGETS = {
  performance: { min: 0.8 },
  accessibility: { min: 0.9 },
  'best-practices': { min: 0.9 },
  'largest-contentful-paint': { max: 4000 },
  'total-blocking-time': { max: 850 },
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

// Null when the URL is absent or unparseable, so it never matches the site.
function measuredHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Returns { rows, errors }. Rows exist only for metrics every report supplies;
// errors name each report that measured another page, and each report and
// metric that has no number.
function judge(reports) {
  const errors = [];
  const rows = [];
  for (const { file, json } of reports) {
    if (measuredHost(json.finalDisplayedUrl) !== SITE_HOST) {
      errors.push(`${file}: measured ${json.finalDisplayedUrl ?? 'no URL'}, not ${SITE_HOST}`);
    }
  }
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
