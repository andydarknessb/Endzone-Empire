const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/e2e', open: 'never' }]],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run client',
        url: 'http://127.0.0.1:4173',
        // #196: default to NOT reusing whatever is already on 4173. This fleet runs many
        // worktrees of this repo at once, so a listener on 4173 is very often another
        // worktree's dev server, not this one's build; reusing it silently made the e2e
        // suite report green about code it never opened. CI is unaffected: process.env.CI
        // is set there, so it always starts its own server regardless of this flag. Locally,
        // opt in on purpose with E2E_REUSE_SERVER=1 if you intentionally keep a client running.
        reuseExistingServer: process.env.CI ? false : Boolean(process.env.E2E_REUSE_SERVER),
        timeout: 120_000,
        env: { BROWSER: 'none', HOST: '0.0.0.0', PORT: '4173' },
      },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
