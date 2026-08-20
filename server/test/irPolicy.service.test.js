const test = require('node:test');
const assert = require('node:assert/strict');
const { isIrEligible } = require('../services/irPolicy.service');

test('IR eligibility follows the qualifying injury designations', () => {
  const cases = [
    ['O', true],
    ['IR', true],
    ['Q', false],
    ['D', false],
    [null, false],
  ];

  for (const [injuryDesignation, expected] of cases) {
    assert.equal(isIrEligible(injuryDesignation), expected, String(injuryDesignation));
  }
});
