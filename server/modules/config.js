const { z } = require('zod');

const url = z.string().url();

function configuredOrigins(env) {
  return String(env.CLIENT_ORIGINS || env.APP_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function validateEnvironment(env = process.env, { worker = false } = {}) {
  const common = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    JWT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    DATABASE_URL_RUNTIME: z.string().optional(),
    APP_ORIGIN: z.string().optional(),
    CLIENT_ORIGINS: z.string().optional(),
    REDIS_URL: z.string().optional(),
    DB_SSL_CA: z.string().optional(),
    SMTP_URL: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
  }).passthrough().parse(env);

  if (common.NODE_ENV !== 'production') return common;

  const missing = [];
  const runtimeDatabaseUrl = common.DATABASE_URL_RUNTIME || common.DATABASE_URL;
  if (!runtimeDatabaseUrl) missing.push('DATABASE_URL_RUNTIME (or DATABASE_URL)');
  if (!worker && (!common.JWT_SECRET || common.JWT_SECRET.length < 32)) {
    missing.push('JWT_SECRET (minimum 32 characters)');
  }
  if (!common.APP_ORIGIN) missing.push('APP_ORIGIN');
  if (configuredOrigins(common).length === 0) missing.push('CLIENT_ORIGINS');
  if (!common.REDIS_URL) missing.push('REDIS_URL');
  if (!common.DB_SSL_CA) missing.push('DB_SSL_CA');
  if (!common.SMTP_URL) missing.push('SMTP_URL');
  if (!common.SMTP_FROM) missing.push('SMTP_FROM');
  if (!common.SENTRY_DSN) missing.push('SENTRY_DSN');

  if (missing.length) {
    throw new Error(`Production configuration is incomplete: ${missing.join(', ')}`);
  }

  url.parse(runtimeDatabaseUrl);
  url.parse(common.APP_ORIGIN);
  url.parse(common.REDIS_URL);
  url.parse(common.SMTP_URL);
  url.parse(common.SENTRY_DSN);
  for (const origin of configuredOrigins(common)) url.parse(origin);

  if (worker && !common.RAPID_API_KEY) {
    throw new Error('Production worker configuration is incomplete: RAPID_API_KEY');
  }
  return common;
}

module.exports = { configuredOrigins, validateEnvironment };
