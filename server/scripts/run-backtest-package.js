/* eslint-disable no-console */
'use strict';

/**
 * The REAL entry point for Gate-3 snapshot packaging.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT UNDER scripts/backtest/
 *
 * Nothing in `scripts/backtest/` may require `server/modules/pool` or any
 * `server/services/*`, directly or transitively - the same isolation rule
 * `server/scripts/run-backtest-extraction.js` documents for the extraction,
 * and `server/test/backtestSourceFetch.test.js` asserts over the whole
 * `scripts/backtest` tree. `package-snapshot.js` needs exactly one piece of
 * production code: the real `normalizeTeamKey` (the JS twin of
 * `fn_normalize_nfl_team`), so the packaging-time roster-vs-gameTeam
 * contradiction check folds team spellings through the SAME normalization
 * production uses - not an approximation of it. This file is the plug: it
 * requires `server/services/projectionFeatures` (the one and only reason to
 * requires anything under `server/`), builds a real archived-source reader
 * from the frozen `scripts/backtest/lib/sources.js` registry, and calls the
 * pure packager.
 *
 * WHAT THIS PROCESS DOES NOT DO
 *
 * Requiring `projectionFeatures.js` transitively requires
 * `server/modules/pool`, which constructs a `pg.Pool` OBJECT from whatever
 * `DATABASE_URL`/`PG*` variables happen to be set - the same trade-off
 * `run-backtest-extraction.js` already documents and accepts. Constructing a
 * `pg.Pool` does not open a socket; nothing in this file, in
 * `package-snapshot.js`, or in anything it calls ever invokes `.connect()`
 * or `.query()` on it. This process opens no database connection, reads no
 * database credential, and performs no network access of any kind: every
 * byte it reads comes from `backtest-data/snapshot/` (the frozen Gate-2
 * output) and `backtest-data/sources/` (the archived, hash-verified Phase-0
 * sources), both already on disk. This is packaging, not extraction - there
 * is no Gate here to authorize in the sense Gate 1/Gate 2 needed one; this
 * script is local-only by construction, and NOTHING it does writes, commits,
 * or pushes anything. Committing or pushing the resulting
 * `backtest-data/publish/` tree remains the separate Gate-3 decision the
 * user makes explicitly, later, with `git add` naming the exact paths this
 * script's own `STAGING_PATHS.txt` output lists.
 *
 * Usage:
 *   node server/scripts/run-backtest-package.js
 *       [--snapshot <dir>] [--publish <dir>] [--sources-dir <dir>] [--provenance <file>]
 *       [--acknowledge-contradictions]
 *
 * `--acknowledge-contradictions` is required only if the real
 * roster-vs-gameTeam contradiction check (`teamContradictions`) finds a
 * nonzero count on this run - packaging otherwise refuses to proceed past a
 * real, unacknowledged contradiction (see `package-snapshot.js`'s
 * `packageSnapshot` docblock). Production currently has zero contradictions,
 * so this flag is not needed for the real 2024/2025 sweep; pass it only after
 * a human has actually reviewed a nonzero count this run reports.
 */

const packager = require('../../scripts/backtest/package-snapshot');
const checks = require('../../scripts/backtest/snapshot-checks');
const { normalizeTeamKey } = require('../services/projectionFeatures');

function main(argv) {
  const args = packager.parseArgs(argv);
  const readSource = checks.makeSourceReader({
    sourcesDir: args.sourcesDir,
    provenancePath: args.provenance,
  });
  const result = packager.packageSnapshot({
    snapshotRoot: args.snapshot,
    publishRoot: args.publish,
    sourcesDir: args.sourcesDir,
    provenancePath: args.provenance,
    readSource,
    normalizeTeamKey,
    acknowledgeContradictions: args.acknowledgeContradictions,
    log: console.log,
  });
  return { code: 0, result };
}

if (require.main === module) {
  try {
    const { code } = main(process.argv.slice(2));
    process.exit(code);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { main };
