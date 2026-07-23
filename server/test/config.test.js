const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../modules/config');

test('development configuration permits optional production integrations', () => {
  assert.equal(validateEnvironment({ NODE_ENV: 'development' }).NODE_ENV, 'development');
});

test('production configuration fails closed when required controls are absent', () => {
  assert.throws(
    () => validateEnvironment({ NODE_ENV: 'production' }),
    /Production configuration is incomplete/
  );
});

test('production configuration accepts the complete validated boundary', () => {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL_RUNTIME: 'postgresql://example.test/app',
    JWT_SECRET: 'x'.repeat(48),
    APP_ORIGIN: 'https://endzoneempire.gg',
    CLIENT_ORIGINS: 'https://endzoneempire.gg',
    REDIS_URL: 'redis://example.test:6379',
    DB_SSL_CA: 'certificate',
    SMTP_URL: 'smtps://user:pass@example.test',
    SMTP_FROM: 'Endzone Empire <no-reply@example.test>',
    SENTRY_DSN: 'https://public@example.test/1',
  };
  assert.equal(validateEnvironment(env).NODE_ENV, 'production');
});

test('production worker does not require an unrelated JWT signing secret', () => {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL_RUNTIME: 'postgresql://example.test/app',
    APP_ORIGIN: 'https://endzoneempire.gg',
    CLIENT_ORIGINS: 'https://endzoneempire.gg',
    REDIS_URL: 'redis://example.test:6379',
    DB_SSL_CA: 'certificate',
    SMTP_URL: 'smtps://user:pass@example.test',
    SMTP_FROM: 'Endzone Empire <no-reply@example.test>',
    SENTRY_DSN: 'https://public@example.test/1',
    RAPID_API_KEY: 'worker-provider-key',
  };
  assert.equal(validateEnvironment(env, { worker: true }).NODE_ENV, 'production');
});
