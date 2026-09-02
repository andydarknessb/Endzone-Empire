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
        // #196: default to NOT reusing whatever is already on 4173. Nothing binds this port
        // by hand (npm run client is react-scripts start, which lands on 5000/3000); the
        // realistic occupant is a concurrent or leftover Playwright-managed server from
        // another worktree of this repo. Reusing it silently can report green about code it
        // never opened. CI is unaffected: process.env.CI is set there, so it always starts
        // its own server regardless of this flag. Locally, opt in on purpose by setting
        // E2E_REUSE_SERVER to exactly "1" if you intentionally keep a client running; any
        // other value (including "0" or "false") leaves the safe default in place.
        reuseExistingServer: process.env.CI ? false : process.env.E2E_REUSE_SERVER === '1',
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
