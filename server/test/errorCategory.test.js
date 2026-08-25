const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyError,
  ERROR_CATEGORIES,
} = require('../modules/errorCategory');

/**
 * The health payload's error classifier (#242).
 *
 * The anonymous /api/health surface must never publish a raw `err.message`
 * (pg errors carry the database host, project ref, port and username; axios
 * network errors carry the upstream host). Every such value is mapped to one
 * of a FIXED enum first, from structured error properties where they exist and
 * from the message only as a fallback, and the classifier never returns the
 * input string. These cases pin each enum arm and the "never the input" rule.
 */

const ENUM = new Set(Object.values(ERROR_CATEGORIES));

test('a healthy (null/empty) input classifies as null, never a category', () => {
  assert.equal(classifyError(null), null);
  assert.equal(classifyError(undefined), null);
  assert.equal(classifyError(''), null);
});

test('every returned value is a member of the fixed enum, never the input string', () => {
  const hostile = 'connect ECONNREFUSED postgres://app:hunter2@db.internal:5432/prod';
  const err = new Error(hostile);
  err.code = 'ECONNREFUSED';
  const category = classifyError(err);
  assert.ok(ENUM.has(category), 'result is an enum member');
  assert.notEqual(category, hostile);
  assert.ok(!String(category).includes('hunter2'));
  assert.ok(!String(category).includes('db.internal'));
});

// --- Structured properties come first -------------------------------------

test('a Postgres connection-refusal (err.code ECONNREFUSED, no axios shape) is db_unavailable', () => {
  const err = new Error('connect ECONNREFUSED 10.0.0.5:5432');
  err.code = 'ECONNREFUSED';
  assert.equal(classifyError(err), ERROR_CATEGORIES.DB_UNAVAILABLE);
});

test('a Postgres host-lookup failure (err.code ENOTFOUND) is db_unavailable', () => {
  const err = new Error('getaddrinfo ENOTFOUND db.example');
  err.code = 'ENOTFOUND';
  assert.equal(classifyError(err), ERROR_CATEGORIES.DB_UNAVAILABLE);
});

test('a Postgres SQLSTATE error (5-char err.code + severity) is db_unavailable', () => {
  const err = new Error('too many connections for role "app"');
  err.code = '53300';
  err.severity = 'FATAL';
  assert.equal(classifyError(err), ERROR_CATEGORIES.DB_UNAVAILABLE);
});

test('a Postgres invalid-authorization SQLSTATE (class 28) is config', () => {
  const err = new Error('password authentication failed for user "app"');
  err.code = '28P01';
  err.severity = 'FATAL';
  assert.equal(classifyError(err), ERROR_CATEGORIES.CONFIG);
});

test('an axios response with an HTTP status is upstream_http', () => {
  const err = new Error('Request failed with status code 503');
  err.isAxiosError = true;
  err.response = { status: 503 };
  assert.equal(classifyError(err), ERROR_CATEGORIES.UPSTREAM_HTTP);
});

test('an axios timeout (ECONNABORTED, no response) is upstream_timeout', () => {
  const err = new Error('timeout of 2000ms exceeded');
  err.isAxiosError = true;
  err.code = 'ECONNABORTED';
  assert.equal(classifyError(err), ERROR_CATEGORIES.UPSTREAM_TIMEOUT);
});

test('an axios network failure with no response is upstream_timeout, not db_unavailable', () => {
  // Same ECONNREFUSED code as the DB case, but the axios shape marks it as the
  // upstream client, so it must NOT be read as a database outage.
  const err = new Error('connect ECONNREFUSED 1.2.3.4:443');
  err.isAxiosError = true;
  err.code = 'ECONNREFUSED';
  assert.equal(classifyError(err), ERROR_CATEGORIES.UPSTREAM_TIMEOUT);
});

test('a plain ETIMEDOUT socket error is upstream_timeout', () => {
  const err = new Error('connect ETIMEDOUT 1.2.3.4:443');
  err.code = 'ETIMEDOUT';
  assert.equal(classifyError(err), ERROR_CATEGORIES.UPSTREAM_TIMEOUT);
});

// --- Message sniffing is the fallback (the worker->DB path is a bare string)

test('a bare string with a database fingerprint classifies as db_unavailable', () => {
  assert.equal(
    classifyError('could not connect to server: Connection refused (postgres://u@h:5432)'),
    ERROR_CATEGORIES.DB_UNAVAILABLE
  );
});

test('a bare string mentioning a timeout classifies as upstream_timeout', () => {
  assert.equal(classifyError('timeout of 2000ms exceeded'), ERROR_CATEGORIES.UPSTREAM_TIMEOUT);
});

test('a bare string with a request-status fingerprint classifies as upstream_http', () => {
  assert.equal(
    classifyError('Request failed with status code 500'),
    ERROR_CATEGORIES.UPSTREAM_HTTP
  );
});

test('a bare string about a missing credential classifies as config', () => {
  assert.equal(
    classifyError('RAPID_API_KEY is not configured'),
    ERROR_CATEGORIES.CONFIG
  );
});

test('an arbitrary, unrecognized string classifies as unknown', () => {
  assert.equal(classifyError('the moon is made of cheese'), ERROR_CATEGORIES.UNKNOWN);
});

test('an error object with no recognizable structure or message is unknown', () => {
  assert.equal(classifyError(new Error('kaboom')), ERROR_CATEGORIES.UNKNOWN);
});
