const test = require('node:test');
const assert = require('node:assert/strict');
const { sslForConnection } = require('../modules/dbSsl');

test('production remote databases require a trusted CA', () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCa = process.env.DB_SSL_CA;
  const priorMode = process.env.PGSSLMODE;
  process.env.NODE_ENV = 'production';
  delete process.env.DB_SSL_CA;
  delete process.env.PGSSLMODE;
  assert.throws(
    () => sslForConnection('postgresql://db.example.test/app'),
    /DB_SSL_CA/
  );
  process.env.NODE_ENV = priorNodeEnv;
  if (priorCa == null) delete process.env.DB_SSL_CA;
  else process.env.DB_SSL_CA = priorCa;
  if (priorMode == null) delete process.env.PGSSLMODE;
  else process.env.PGSSLMODE = priorMode;
});

test('production remote databases verify certificates with the configured CA', () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCa = process.env.DB_SSL_CA;
  process.env.NODE_ENV = 'production';
  process.env.DB_SSL_CA = 'TEST-CA';
  assert.deepEqual(sslForConnection('postgresql://db.example.test/app'), {
    rejectUnauthorized: true,
    ca: 'TEST-CA',
  });
  process.env.NODE_ENV = priorNodeEnv;
  if (priorCa == null) delete process.env.DB_SSL_CA;
  else process.env.DB_SSL_CA = priorCa;
});
