const util = require('node:util');

// Must match the log format at settleFollowUp.service.js:63.
const SETTLE_FOLLOW_UP_LOG_PREFIX = 'settle follow-up (';

/**
 * Silences console.error for one test and fails that test (in t.after) when any
 * message begins with the Settle follow-up's one log format. The chain swallows
 * a throwing step and logs it, so without this a new step that throws in an old
 * test's world passes silently (#2381). Use it where the test reaches the chain
 * and expects no step failure; a test that fails a step on purpose keeps its
 * own console.error capture and assertions.
 */
function failOnSettleFollowUpErrors(t) {
  const failures = [];
  t.mock.method(console, 'error', (...args) => {
    const message = util.format(...args);
    if (message.startsWith(SETTLE_FOLLOW_UP_LOG_PREFIX)) failures.push(message);
  });
  t.after(() => {
    if (failures.length) throw new Error(`Settle follow-up step failed during the test:\n${failures.join('\n')}`);
  });
}

module.exports = { failOnSettleFollowUpErrors };
