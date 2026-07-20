const { defineConfig } = require('@playwright/test');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: process.env.SECURITY_ENV_FILE || '.env.security' });

const baseURL = process.env.SECURITY_BASE_URL || 'http://127.0.0.1:4173';
const hostname = new URL(baseURL).hostname;
const safeTarget =
  ['127.0.0.1', 'localhost', '::1'].includes(hostname) ||
  hostname.endsWith('.test') ||
  hostname.endsWith('.invalid') ||
  hostname.includes('staging');

if (process.env.SECURITY_NETWORK_MODE && process.env.SECURITY_NETWORK_MODE !== 'mock') {
  throw new Error('Security tests only support SECURITY_NETWORK_MODE=mock');
}
if (!safeTarget && process.env.SECURITY_ALLOW_REMOTE_TARGET !== 'true') {
  throw new Error(`Refusing security test target ${hostname}; use localhost/staging or explicitly opt in`);
}

const authDir = path.join(__dirname, 'test-results', 'security', '.auth');

module.exports = defineConfig({
  testDir: './tests/security',
  outputDir: 'test-results/security',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/security', open: 'never' }]],
  use: {
    baseURL,
    extraHTTPHeaders: { Accept: 'application/json' },
  },
  projects: [
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'anon-rls',
      testMatch: /rls-anon\.security\.spec\.ts/,
    },
    {
      name: 'commissioner-gap',
      testMatch: /commissioner-correction\.security\.spec\.js/,
      dependencies: ['auth-setup'],
      use: { storageState: path.join(authDir, 'commissioner.json') },
    },
    {
      name: 'manager-escalation',
      testMatch: /trade-escalation\.security\.spec\.ts/,
      dependencies: ['auth-setup'],
      use: { storageState: path.join(authDir, 'manager.json') },
    },
  ],
});
