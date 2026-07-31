/* eslint-disable no-console */
'use strict';

/**
 * The CLI entry point for the network-free rehydrator.
 *
 * WHY THIS FILE LIVES UNDER server/scripts/, NOT scripts/backtest/
 *
 * Unlike `run-backtest-package.js`, this file does NOT need
 * `server/services/projectionFeatures` or any other production code -
 * `scripts/backtest/rehydrate.js` is pure fs/CPU work end to end (reassemble
 * chunks, verify hashes, write files), so nothing here is structurally
 * required to sit on the server side of the isolation boundary. It lives
 * here anyway, for one reason only: consistency. Every OTHER real backtest
 * entry point (`run-backtest-extraction.js`, `run-backtest-package.js`,
 * `run-backtest-canaries.js`, `run-backtest-role.js`) lives under
 * `server/scripts/`, and a human operator working through the Gate-3
 * pipeline should be able to find "the next command to run" in one place
 * without having to remember that exactly one of them is special. This file
 * is a thin wrapper for exactly that reason - it could just as easily be
 * `node scripts/backtest/rehydrate.js` directly (and still can be; the CLI
 * there is fully functional on its own), but `server/scripts/` is where this
 * pipeline's other entry points are documented to live.
 *
 * Usage:
 *   node server/scripts/run-backtest-rehydrate.js \
 *       --out-snapshot <dir> --out-sources <dir> [--publish <dir>]
 *
 * `--out-snapshot` and `--out-sources` are both required: this tool never
 * defaults onto the real `backtest-data/snapshot/` or `backtest-data/sources/`
 * - writing rehydrated output over the sealed originals would defeat the
 * entire point of a "rehydrate into a FRESH directory and prove it stands in
 * for the real thing" reproducibility proof.
 */

const rehydrate = require('../../scripts/backtest/rehydrate');

function main(argv) {
  return rehydrate.main(argv, { log: console.log });
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { main };
