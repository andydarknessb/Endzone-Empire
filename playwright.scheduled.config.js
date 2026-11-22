const e2eConfig = require('./playwright.e2e.config.js');

// The weekly browser suite: the e2e config over its own folder, so slow page checks stay out of the PR run.
// A weekly guard has no PR to re-push on, and a retry would let an over-budget run pass on its second try.
module.exports = { ...e2eConfig, testDir: './tests/scheduled', retries: 0 };
