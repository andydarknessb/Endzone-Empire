#!/usr/bin/env node
/**
 * npm run lint (#284): the repository's one unified lint command.
 *
 * This is the LAST step in the #245 chain (#280 scripts/, #281
 * testing-library, #282 no-node-access/no-container, #283 the two
 * judgement-call rules, #326 the four leftover no-node-access errors).
 * With all five landed, `src`, `server` and `scripts` lint clean under the
 * widened extension set, so this script both wires the wider surface in and
 * makes it a single command a developer (and, later, #247's CI step) can run.
 *
 * Design notes:
 *
 * - Widening happens via `--ext` becoming the ESLint API's `extensions`
 *   option (`.js`, `.jsx`, `.ts`, `.tsx`). Before this, `npx eslint src
 *   server` only ever discovered `.js` files under directory patterns
 *   (ESLint's CLI default extension list is `['.js']`); `.jsx`/`.ts`/`.tsx`
 *   files were silently never linted. See the `eslintConfig-jest-scoping`
 *   comment in package.json (#207) for the same trap one layer over.
 *
 * - The pass/fail decision is ESLint's own, not this script's. `summarize()`
 *   below reproduces the exact two-line predicate ESLint's own CLI uses
 *   (node_modules/eslint/lib/cli.js: `(errorCount || tooManyWarnings) ? 1 :
 *   0`, with `tooManyWarnings = maxWarnings >= 0 && warningCount >
 *   maxWarnings`) rather than inventing new pass/fail logic. `results` here
 *   is exactly the object shape ESLint's own `json` formatter serializes
 *   (the Node API's documented guarantee) — this script reads it only to
 *   print how many files were processed, never to decide anything.
 *
 * - A configuration failure (bad parser, a pattern that matches no files,
 *   an unloadable config) is not a lint finding: ESLint's own CLI rejects
 *   with an exception in that case and exits with status 2, distinct from
 *   the status-1 "found problems" case (node_modules/eslint/bin/eslint.js).
 *   This script mirrors that: an exception from `ESLint#lintFiles` exits 2
 *   here too, never folded into the 0/1 "how much did it find" scale.
 */
const path = require('path');
const { ESLint } = require('eslint');

const REPO_ROOT = path.resolve(__dirname, '..');
const LINT_PATTERNS = ['src', 'server', 'scripts'];
const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const MAX_WARNINGS = 0;

// Pure summary of an ESLint `results` array (the JSON-formatter shape) under
// a given `maxWarnings` threshold. Mirrors node_modules/eslint/lib/cli.js's
// own predicate exactly, so this wrapper's pass/fail can never drift from
// what `eslint` itself would have decided given the same results.
function summarize(results, { maxWarnings = 0 } = {}) {
  let errorCount = 0;
  let warningCount = 0;
  for (const result of results) {
    errorCount += result.errorCount;
    warningCount += result.warningCount;
  }
  const tooManyWarnings = maxWarnings >= 0 && warningCount > maxWarnings;
  const exitCode = errorCount || tooManyWarnings ? 1 : 0;
  return { fileCount: results.length, errorCount, warningCount, tooManyWarnings, exitCode };
}

async function run({
  cwd = REPO_ROOT,
  patterns = LINT_PATTERNS,
  extensions = EXTENSIONS,
  maxWarnings = MAX_WARNINGS,
  overrideConfig,
} = {}) {
  const eslint = new ESLint({ cwd, extensions, ...(overrideConfig ? { overrideConfig } : {}) });
  const results = await eslint.lintFiles(patterns);
  const summary = summarize(results, { maxWarnings });

  if (summary.errorCount > 0 || summary.warningCount > 0) {
    const formatter = await eslint.loadFormatter('stylish');
    const text = formatter.format(results);
    if (text) {
      console.log(text);
    }
  }

  return summary;
}

// Returns { exitCode, summary? , error? } rather than touching
// process.exitCode itself, so tests can drive it directly (with injected
// `patterns`/`cwd`/`overrideConfig`) and assert on the result instead of on
// global process state. The `require.main` block below is the only caller
// that translates the result into the real process exit status.
async function main(options = {}) {
  let summary;
  try {
    summary = await run(options);
  } catch (err) {
    // A configuration failure, not a lint finding: ESLint itself never
    // produced a results array to report on. Match the real CLI's exit 2
    // (node_modules/eslint/bin/eslint.js `onFatalError`) rather than the
    // 0/1 scale `summarize()` computes.
    console.error(`\nESLint could not run: ${err.message}\n`);
    return { exitCode: 2, error: err };
  }

  console.log(`${summary.fileCount} files linted`);
  return { exitCode: summary.exitCode, summary };
}

if (require.main === module) {
  main().then(({ exitCode }) => {
    process.exitCode = exitCode;
  });
}

module.exports = { summarize, run, main, LINT_PATTERNS, EXTENSIONS, MAX_WARNINGS };
