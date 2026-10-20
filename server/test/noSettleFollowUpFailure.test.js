const { test } = require('node:test');
const assert = require('node:assert/strict');
const { failOnSettleFollowUpErrors } = require('./helpers/noSettleFollowUpFailure');

// A stand-in for the test context so the helper's t.after check can be run and
// inspected instead of failing this test.
function run(t, logs) {
  const hooks = [];
  failOnSettleFollowUpErrors({ mock: t.mock, after: (fn) => hooks.push(fn) });
  logs();
  return () => hooks.forEach((fn) => fn());
}

test('rejects a Settle follow-up step failure log', (t) => {
  const check = run(t, () => console.error('settle follow-up (%s): %s for league %s week %s:', 'advance', 'writePreviews failed', 7, 5, 'boom'));
  assert.throws(check, /writePreviews failed for league 7 week 5/);
});

test('accepts an unrelated console.error', (t) => {
  const check = run(t, () => console.error('something else (%s)', 'x'));
  assert.doesNotThrow(check);
});
