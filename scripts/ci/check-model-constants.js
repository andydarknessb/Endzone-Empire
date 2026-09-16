/**
 * CI pin on the production MODEL_CONSTANTS fingerprint - the same
 * `sha256(JSON.stringify(...))` the holdout ledger stores as each scheduled
 * capture's `constants_hash` (`server/services/holdout.service.js`).
 *
 * Why a pin: the holdout-confirm-2026 evaluator drops any captured week
 * whose `constants_hash` differs from its arm's season majority, so a
 * mid-season constants change - including an inert merge or a formatter
 * pass that reorders object keys - silently costs 5-9 weeks and is
 * discovered in January. This check makes that change loud at CI time.
 *
 * To change the constants DELIBERATELY (a new model version, outside the
 * study's no-edit corridor), update PINNED_SHA256 in the same commit and
 * say so in the commit message. Pinned 2026-08-14 against the v3.1 constants,
 * re-pinned 2026-09-16 for free_baseline_v3.2 (#1483/#1485; v3.1 is preserved as
 * MODEL_CONSTANTS_V3_1 and its hash is pinned in projectionModel.test.js).
 */

const crypto = require('crypto');
const { MODEL_CONSTANTS } = require('../../server/services/projectionModel');

const PINNED_SHA256 = 'e749735142555fb186a4f7962e0b86ce01efbb6303a70f0b935bf3879b1b2582';

const actual = crypto.createHash('sha256').update(JSON.stringify(MODEL_CONSTANTS)).digest('hex');

if (actual !== PINNED_SHA256) {
  console.error(
    'MODEL_CONSTANTS drift:\n'
      + `  pinned ${PINNED_SHA256}\n`
      + `  actual ${actual}\n`
      + 'The holdout-confirm-2026 study captures against the pinned constants; '
      + 'an unintended change here drops captured weeks silently (evaluator '
      + 'majority rule, PREREGISTRATION.md section 9 item 4). If the change is '
      + 'deliberate, update PINNED_SHA256 in scripts/ci/check-model-constants.js '
      + 'in the same commit.'
  );
  process.exit(1);
}

console.log(`MODEL_CONSTANTS pinned: ${actual}`);
