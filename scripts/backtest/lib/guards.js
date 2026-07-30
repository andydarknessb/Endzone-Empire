'use strict';

/**
 * Offline guards and the pre-sweep canaries.
 *
 * The plan's offline mechanism is `docker run --network none`, credential
 * cleared, and that is the AUTHORITATIVE isolation - not anything in this file.
 * What this file adds is the thing a container alone cannot give you: PROOF,
 * recorded at the start of every run, that the isolation is actually in force.
 *
 * The distinction matters because the failure mode is silent. A sweep that
 * reaches the live database still produces numbers; they are simply numbers
 * from today's data rather than from the frozen snapshot, which is precisely
 * the defect (`free_baseline_v3.1`'s constants were selected that way) this
 * whole rebuild exists to eliminate. A run that cannot prove it was offline
 * cannot be trusted to have been offline, so the canaries run BEFORE the sweep
 * and any canary SUCCESS aborts it.
 *
 * Four canaries, because there are four distinct ways out:
 *   - raw TCP,
 *   - HTTP(S) through the standard library,
 *   - the global pg pool the services default to,
 *   - a FRESHLY CONSTRUCTED PostgreSQL client, which is the one a container
 *     with a lingering socket or a leaked credential would still let through.
 *
 * ISOLATION. Nothing here imports `pg`, `server/modules/pool`, or any
 * `server/services/*`, and nothing reads `process.env` - the whole
 * `scripts/backtest` tree is barred from all three by test. The probes are
 * INJECTED: the pure logic (what counts as a pass, what aborts) lives here and
 * is unit-tested with fakes, while the wiring that holds a real socket and a
 * real pool lives in `server/scripts/run-backtest-canaries.js`, outside the
 * guarded tree. The in-process guards below are defence in depth, never the
 * primary control.
 */

/** The four escape routes a canary must prove are shut. */
const CANARY_NAMES = Object.freeze(['tcp', 'https', 'globalPool', 'freshPgClient']);

/** What a canary is allowed to report. */
const OUTCOMES = Object.freeze({ BLOCKED: 'blocked', REACHED: 'reached' });

/**
 * Pure: interpret one probe result.
 *
 * A probe is expected to REJECT. Anything else - a resolved promise, a
 * connection object, even an HTTP error status - means something answered, and
 * something answering is the thing the canary exists to detect. A probe that
 * rejects is reported `blocked`; a probe that returns is reported `reached`,
 * whatever it returned.
 */
function interpretProbe({ name, settled }) {
  if (!CANARY_NAMES.includes(name)) {
    throw new Error(`unknown canary ${JSON.stringify(name)} - expected one of ${CANARY_NAMES.join(', ')}`);
  }
  if (settled.status === 'rejected') {
    const reason = settled.reason;
    return {
      name,
      outcome: OUTCOMES.BLOCKED,
      detail: (reason && (reason.code || reason.message)) || String(reason),
    };
  }
  return {
    name,
    outcome: OUTCOMES.REACHED,
    detail: describeReached(settled.value),
  };
}

/** Pure: a short, non-secret description of whatever a probe managed to reach. */
function describeReached(value) {
  if (value === undefined || value === null) return 'the probe resolved instead of failing';
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return `the probe resolved with ${JSON.stringify(value)}`;
  }
  // Never stringify a connection object: it can carry a password.
  return `the probe resolved with a ${value.constructor ? value.constructor.name : typeof value}`;
}

/**
 * Run every canary and ABORT unless all four were blocked.
 *
 * `probes` maps each canary name to a function returning a promise that MUST
 * reject. Every probe runs even after one has already succeeded, so the report
 * names every hole rather than only the first.
 */
async function runCanaries({ probes, names = CANARY_NAMES }) {
  if (!probes || typeof probes !== 'object') throw new Error('runCanaries requires a probes object');
  const missing = names.filter((name) => typeof probes[name] !== 'function');
  if (missing.length > 0) {
    // A missing probe is a FAILURE, never a skip: "we did not check" and "it is
    // shut" must never look the same in the record.
    throw new Error(
      `canary probes missing for ${missing.join(', ')}. A canary that did not run cannot show that ` +
      'the route it covers is closed, and an unproven route is an open one.'
    );
  }

  const results = [];
  for (const name of names) {
    /* eslint-disable no-await-in-loop */
    const settled = await Promise.allSettled([probes[name]()]).then((s) => s[0]);
    /* eslint-enable no-await-in-loop */
    results.push(interpretProbe({ name, settled }));
  }
  const reached = results.filter((r) => r.outcome === OUTCOMES.REACHED);
  return { results, reached, ok: reached.length === 0 };
}

/**
 * The gate itself: run the canaries and throw unless every route is shut.
 *
 * Deliberately throws rather than returning a boolean. A caller that forgot to
 * check a returned flag would run the sweep anyway, and the whole point is that
 * this cannot be forgotten.
 */
async function assertOffline({ probes, names = CANARY_NAMES, label = 'sweep' }) {
  const report = await runCanaries({ probes, names });
  if (!report.ok) {
    throw new Error(
      `refusing to start the ${label}: ${report.reached.length} of ${names.length} canaries REACHED ` +
      `something (${report.reached.map((r) => `${r.name}: ${r.detail}`).join('; ')}). The run is not ` +
      'offline, so any numbers it produced could come from live data rather than the frozen snapshot.'
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// In-process guards (defence in depth)
// ---------------------------------------------------------------------------

const DISARMED = Symbol.for('endzone-empire.backtest.guardInstalled');

/**
 * Replace a set of methods on an object with throwing stubs, returning a
 * restore handle.
 *
 * The same shape as Phase 1's pool lockout, generalized: the sweep uses it to
 * shut the global pool and any module-level http agent it can see. It is
 * defence in depth - the container is what actually enforces isolation - so it
 * is deliberately simple and always restorable.
 */
function disarm(target, methods, { reason = 'the offline sweep is running', label = 'object' } = {}) {
  if (!target || typeof target !== 'object') throw new Error('disarm requires an object');
  if (target[DISARMED]) throw new Error(`${label} is already disarmed - refusing to nest guards`);
  const originals = new Map();
  for (const method of methods) {
    if (typeof target[method] !== 'function') continue;
    originals.set(method, target[method]);
    target[method] = function disarmed() {
      throw new Error(
        `${label}.${method}() is disarmed: ${reason}. Every read must come from the frozen ` +
        'snapshot; a live read here would silently mix today\'s data into a historical result.'
      );
    };
  }
  target[DISARMED] = true;
  let restored = false;
  return {
    get disarmedMethods() { return [...originals.keys()]; },
    get restored() { return restored; },
    restore() {
      if (restored) return false;
      for (const [method, original] of originals) target[method] = original;
      delete target[DISARMED];
      restored = true;
      return true;
    },
  };
}

/**
 * Pure: assert a module was NOT loaded.
 *
 * Used for `holdout.service`, which the plan bars from the sweep's require
 * graph entirely - the 2026 holdout must be untouchable, and the surest way to
 * keep it untouched is for the code that reads it never to be loaded. Takes the
 * cache keys as an argument so it stays pure and testable.
 */
function assertModuleNotLoaded(loadedPaths, forbidden, { label = 'sweep' } = {}) {
  const hits = [];
  for (const loaded of loadedPaths || []) {
    for (const name of forbidden) {
      if (String(loaded).replace(/\\/g, '/').includes(name)) hits.push({ loaded, name });
    }
  }
  if (hits.length > 0) {
    throw new Error(
      `${label}: forbidden module(s) are loaded - ${[...new Set(hits.map((h) => h.name))].join(', ')}. ` +
      'The 2026 holdout is prospective and nothing in this run may be able to read it.'
    );
  }
  return true;
}

module.exports = {
  CANARY_NAMES,
  OUTCOMES,
  interpretProbe,
  describeReached,
  runCanaries,
  assertOffline,
  disarm,
  assertModuleNotLoaded,
};
