const { test } = require('node:test');
const assert = require('node:assert/strict');
const sentryModule = require('../modules/sentry');

/**
 * captureError is a shared helper: every server caller reaches Sentry through
 * it. #768 gives it a way to set a Sentry fingerprint (ruling 5) without
 * changing any existing two-argument call site, and rides pool counters on the
 * overdue captures (ruling 4). These drive the REAL captureError against an
 * injected Sentry-shaped client so the assertion is that the fingerprint and
 * the extras actually reach the scope, not merely that the call did not throw.
 */

/** A Sentry-shaped double that records what the scope was told. */
function fakeSentry() {
  const scope = {
    extras: {},
    fingerprint: null,
    setExtra(key, value) { this.extras[key] = value; },
    setFingerprint(fp) { this.fingerprint = fp; },
  };
  return {
    scope,
    captured: [],
    init() {},
    captureException(err) { this.captured.push(err); },
    withScope(fn) { fn(this.scope); },
  };
}

/** Install a fake client through the DI seam and tear it back down. */
function withFakeSentry(t) {
  const prevDsn = process.env.SENTRY_DSN;
  process.env.SENTRY_DSN = 'https://public@example.test/1';
  const fake = fakeSentry();
  sentryModule.initSentry(fake);
  t.after(() => {
    if (prevDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prevDsn;
    // Restore the module to its no-DSN, no-client resting state so a later
    // suite in the same process does not inherit this fake.
    sentryModule.initSentry(null);
  });
  return fake;
}

test('captureError sets the fingerprint on the scope and captures the error', (t) => {
  const fake = withFakeSentry(t);
  const err = new Error('pick clock overdue for league 7');

  sentryModule.captureError(
    err,
    { leagueId: 7, path: 'sweep' },
    { fingerprint: ['pick-clock-overdue', '7'] }
  );

  assert.deepEqual(fake.scope.fingerprint, ['pick-clock-overdue', '7'],
    'the fingerprint reaches scope.setFingerprint');
  assert.deepEqual(fake.captured, [err], 'the error is captured');
});

test('captureError routes the three pool counters to scope.setExtra', (t) => {
  const fake = withFakeSentry(t);

  sentryModule.captureError(new Error('boom'), {
    leagueId: 3,
    'pool.totalCount': 5,
    'pool.idleCount': 2,
    'pool.waitingCount': 1,
  });

  assert.equal(fake.scope.extras['pool.totalCount'], 5);
  assert.equal(fake.scope.extras['pool.idleCount'], 2);
  assert.equal(fake.scope.extras['pool.waitingCount'], 1);
  assert.equal(fake.scope.extras.leagueId, 3, 'ordinary context extras still reach the scope');
});

test('captureError with no options leaves the fingerprint unset (additive, existing callers unchanged)', (t) => {
  const fake = withFakeSentry(t);

  sentryModule.captureError(new Error('boom'), { requestId: 'abc' });

  assert.equal(fake.scope.fingerprint, null, 'a two-argument call sets no fingerprint');
  assert.equal(fake.scope.extras.requestId, 'abc');
  assert.equal(fake.captured.length, 1);
});
