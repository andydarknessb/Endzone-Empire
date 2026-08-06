const test = require('node:test');
const assert = require('node:assert/strict');
const { sslForConnection } = require('../modules/dbSsl');

test('production remote databases require a trusted CA', () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCa = process.env.DB_SSL_CA;
  // `caFromEnv` reads DB_SSL_CA_PATH as well as DB_SSL_CA, so clearing only the
  // latter leaves a developer's real CA file configured and the guard correctly
  // does not throw - the assertion then fails on that machine and passes in CI,
  // which reads as a security regression when it is only an unswept variable.
  const priorCaPath = process.env.DB_SSL_CA_PATH;
  const priorMode = process.env.PGSSLMODE;
  process.env.NODE_ENV = 'production';
  delete process.env.DB_SSL_CA;
  delete process.env.DB_SSL_CA_PATH;
  delete process.env.PGSSLMODE;
  assert.throws(
    () => sslForConnection('postgresql://db.example.test/app'),
    /DB_SSL_CA/
  );
  process.env.NODE_ENV = priorNodeEnv;
  if (priorCa == null) delete process.env.DB_SSL_CA;
  else process.env.DB_SSL_CA = priorCa;
  if (priorCaPath == null) delete process.env.DB_SSL_CA_PATH;
  else process.env.DB_SSL_CA_PATH = priorCaPath;
  if (priorMode == null) delete process.env.PGSSLMODE;
  else process.env.PGSSLMODE = priorMode;
});

test('production remote databases verify certificates with the configured CA', () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorCa = process.env.DB_SSL_CA;
  // DB_SSL_CA is checked before DB_SSL_CA_PATH, so this case does not depend on
  // the path variable; it is still asserted explicitly so the two tests cannot
  // drift into disagreeing about which variables they control.
  const priorCaPath = process.env.DB_SSL_CA_PATH;
  process.env.NODE_ENV = 'production';
  process.env.DB_SSL_CA = 'TEST-CA';
  delete process.env.DB_SSL_CA_PATH;
  assert.deepEqual(sslForConnection('postgresql://db.example.test/app'), {
    rejectUnauthorized: true,
    ca: 'TEST-CA',
  });
  process.env.NODE_ENV = priorNodeEnv;
  if (priorCa == null) delete process.env.DB_SSL_CA;
  else process.env.DB_SSL_CA = priorCa;
  if (priorCaPath == null) delete process.env.DB_SSL_CA_PATH;
  else process.env.DB_SSL_CA_PATH = priorCaPath;
});
