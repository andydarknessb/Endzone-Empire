const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BUDGETS, median, main } = require('./lighthouse-budget');

// A Lighthouse-shaped report with every metric the budget reads. The defaults
// pass every budget; a test overrides one value to break it.
function report(overrides = {}) {
  const v = { performance: 0.99, accessibility: 1, 'best-practices': 1, lcp: 1000, tbt: 0, cls: 0, ...overrides };
  return {
    categories: {
      performance: { score: v.performance },
      accessibility: { score: v.accessibility },
      'best-practices': { score: v['best-practices'] },
    },
    audits: {
      'largest-contentful-paint': { numericValue: v.lcp },
      'total-blocking-time': { numericValue: v.tbt },
      'cumulative-layout-shift': { numericValue: v.cls },
    },
  };
}

// Writes each report to its own file in one fresh temp dir. cleanup removes
// exactly those files and the dir, never anything else.
function writeReports(reports) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-budget-'));
  const files = reports.map((json, i) => {
    const file = path.join(dir, `run-${i + 1}.json`);
    fs.writeFileSync(file, JSON.stringify(json));
    return file;
  });
  const cleanup = () => {
    for (const file of files) fs.rmSync(file, { force: true });
    fs.rmdirSync(dir);
  };
  return { files, cleanup };
}

function capture() {
  const out = { log: [], error: [] };
  return { out, io: { log: (line) => out.log.push(line), error: (line) => out.error.push(line) } };
}

test('median takes the middle of an odd count and the mean of the middle two of an even count', () => {
  assert.equal(median([0.9, 0.5, 0.7]), 0.7);
  assert.equal(median([4000, 1000, 2000, 3000]), 2500);
});

test('main passes when every median is inside its budget', () => {
  const { files, cleanup } = writeReports([report(), report({ performance: 0.95 }), report({ lcp: 1500 })]);
  try {
    const { out, io } = capture();
    assert.equal(main(files, {}, io), 0);
    assert.deepEqual(out.error, []);
    assert.match(out.log.join('\n'), /\| performance \| 0\.990 \| >= /);
  } finally {
    cleanup();
  }
});

test('main exits 1 naming the metric, its median and its budget when one breaks', () => {
  const cases = [
    { bad: { performance: 0.2 }, line: `performance median 0.200 breaks its budget >= ${BUDGETS.performance.min}` },
    { bad: { lcp: 60000 }, line: `largest-contentful-paint median 60000 breaks its budget <= ${BUDGETS['largest-contentful-paint'].max}` },
  ];
  for (const { bad, line } of cases) {
    const { files, cleanup } = writeReports([report(bad), report(bad), report()]);
    try {
      const { out, io } = capture();
      assert.equal(main(files, {}, io), 1);
      assert.deepEqual(out.error, [`lighthouse-budget: ${line}`]);
    } finally {
      cleanup();
    }
  }
});

test('main exits 1 naming the report and metric when a report lacks a metric or holds null', () => {
  const missing = report();
  delete missing.audits['total-blocking-time'];
  const { files, cleanup } = writeReports([report(), missing, report({ cls: null })]);
  try {
    const { out, io } = capture();
    assert.equal(main(files, {}, io), 1);
    assert.deepEqual(out.error, [
      `lighthouse-budget: ${files[1]}: no total-blocking-time (missing or null)`,
      `lighthouse-budget: ${files[2]}: no cumulative-layout-shift (missing or null)`,
    ]);
    assert.deepEqual(out.log, [], 'no table is printed when a metric is missing');
  } finally {
    cleanup();
  }
});

test('main writes the Markdown table to GITHUB_STEP_SUMMARY, failing rows included', () => {
  const summary = path.join(os.tmpdir(), `lighthouse-summary-${process.pid}-${Date.now()}.md`);
  const { files, cleanup } = writeReports([report({ performance: 0.2 }), report({ performance: 0.3 }), report()]);
  try {
    const { io } = capture();
    assert.equal(main(files, { GITHUB_STEP_SUMMARY: summary }, io), 1);
    const written = fs.readFileSync(summary, 'utf8');
    assert.match(written, /\| Metric \| Median \| Budget \| Result \|/);
    assert.ok(written.includes(`| performance | 0.300 | >= ${BUDGETS.performance.min} | fail |`), written);
    assert.ok(written.includes('| cumulative-layout-shift | 0 | <= 0.1 | pass |'), written);
  } finally {
    cleanup();
    fs.rmSync(summary, { force: true });
  }
});

test('main exits 1 with no report given, or a report that cannot be read', () => {
  const { out, io } = capture();
  assert.equal(main([], {}, io), 1);
  const absent = path.join(os.tmpdir(), 'lighthouse-no-such-report.json');
  assert.equal(main([absent], {}, io), 1);
  assert.ok(out.error[1].includes(absent), out.error[1]);
});
