const e2eConfig = require('./playwright.e2e.config.js');

// The weekly browser suite: the e2e config over its own folder, so slow page checks stay out of the PR run.
module.exports = { ...e2eConfig, testDir: './tests/scheduled' };
