const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { mountedRoutes } = require('./helpers/expressStackWalker');
const {
  routeTable,
  unstubbed,
  canonicalPattern,
} = require('../../tests/e2e/fixtures/draftRouteTable');

/**
 * The INVERSE of #474's harness-coverage guard (#477, ADR 0010's reason).
 *
 * #474's static guard proves the forward direction: every /api literal in the
 * Draft room's import closure has a route-table entry or a listed exemption.
 * Nothing checked the reverse. After a server route is renamed or removed, its
 * harness entry keeps answering a call nobody makes - dead fixture code that
 * reads as coverage. This has never bitten; the value is hygiene plus the rule
 * that a declaration nothing reads is unaudited.
 *
 * So this file reads the Draft E2E harness route table and its `unstubbed`
 * exemptions as data (the plain CommonJS module #474 exports, required above
 * with no browser and no Playwright import) and asserts that every entry and
 * every exemption path still names a route the real Express app actually
 * mounts. It enumerates the app the way the unauthenticated-route inventory
 * does, through the shared Express-stack walker, so the two cannot drift.
 *
 * It lives in the server's fast test set (`npm run test:server`, a step of the
 * `test-build` CI job) rather than beside #474's guard, because the `guards`
 * job cannot load the Express app: `server/` has its own install and the walker
 * needs the mounted stack, not the source text.
 *
 * OUT OF SCOPE (owned elsewhere): #474's forward guard, the harness handler,
 * and the contents of the exemption list; auth classification, which the
 * inventory test owns.
 */

/**
 * Do two path patterns describe the same route, comparing `:param` segments
 * positionally regardless of their names and ignoring any query string? This is
 * the whole matcher: `canonicalPattern` (from the fixture module) folds every
 * `:name` segment to `:param` and drops the query, so string equality of the
 * canonical forms is exactly "same shape, param names irrelevant".
 */
function patternsMatch(a, b) {
  return canonicalPattern(a) === canonicalPattern(b);
}

/** The comparable key for one (method, pattern): method upper-cased, path canonicalised. */
function coverageKey(method, pattern) {
  return `${method.toUpperCase()} ${canonicalPattern(pattern)}`;
}

/**
 * Throws unless every route-table entry and every `unstubbed` exemption path
 * matches at least one mounted route. The two green-for-the-wrong-reason holes
 * are closed first, because both leave the offender loop iterating over nothing
 * and passing cleanly: an empty table describes no coverage to check, and a
 * walker that enumerated zero routes cannot prove any declaration real. On a
 * genuine miss the message names each offender as `METHOD /api/...` and where it
 * was declared - the table, or the exempting source file. Returns the number of
 * routes enumerated, so a caller can pin that it was not zero.
 */
function assertHarnessCoverage({ mounted, table, unstubbed: exemptions }) {
  if (table.length === 0) {
    throw new Error('the harness route table is empty: nothing to check (green for the wrong reason)');
  }
  if (mounted.length === 0) {
    throw new Error('the walker enumerated no mounted routes: coverage cannot be proven (green for the wrong reason)');
  }

  const mountedKeys = new Set(mounted.map((r) => coverageKey(r.method, r.path)));
  const offenders = [];

  for (const entry of table) {
    if (!mountedKeys.has(coverageKey(entry.method, entry.pattern))) {
      offenders.push(`${entry.method.toUpperCase()} ${entry.pattern} (declared in the route table)`);
    }
  }
  for (const group of exemptions) {
    for (const p of group.paths) {
      if (!mountedKeys.has(coverageKey(p.method, p.pattern))) {
        offenders.push(`${p.method.toUpperCase()} ${p.pattern} (declared unstubbed in ${group.file})`);
      }
    }
  }

  if (offenders.length) {
    throw new Error(
      `the Draft E2E harness declares ${offenders.length} route(s) the app no longer mounts:\n  ` +
        offenders.join('\n  ')
    );
  }
  return mounted.length;
}

// ---------------------------------------------------------------------------
// The guard, proven before it is trusted.
// ---------------------------------------------------------------------------

test('the :param matcher compares by shape, not by parameter name', () => {
  // A mounted route names its param `:leagueId`; the table writes `:id`. They
  // describe the same route and must match; a route one segment different must
  // not. This is the load-bearing subtlety of the whole file.
  assert.equal(patternsMatch('/api/league/:id/chat', '/api/league/:leagueId/chat'), true);
  assert.equal(patternsMatch('/api/league/:id/chats', '/api/league/:leagueId/chat'), false);
  // Query strings are ignored; a trailing slash on the mounted side folds away.
  assert.equal(patternsMatch('/api/players', '/api/players/'), true);
  assert.equal(patternsMatch('/api/draft/queue?foo=1', '/api/draft/queue'), true);
});

test('a negative control: a table entry naming an unmounted route fails, named', () => {
  // A synthetic app mounting exactly one route, enumerated through the same
  // walker the real assertion uses. A table entry whose path the app does not
  // mount must turn the guard red with THAT entry named, not pass vacuously.
  const router = express.Router();
  router.get('/thing', (_req, res) => res.json({}));
  const app = express();
  app.use('/api/synthetic', router);
  const mounted = mountedRoutes(app);

  // The route that IS mounted is covered - so the guard is not simply always red.
  assert.equal(
    assertHarnessCoverage({
      mounted,
      table: [{ method: 'GET', pattern: '/api/synthetic/thing', respond() {} }],
      unstubbed: [],
    }),
    1
  );

  // The route that is NOT mounted is named, with method, path and origin.
  assert.throws(
    () =>
      assertHarnessCoverage({
        mounted,
        table: [{ method: 'POST', pattern: '/api/synthetic/nope', respond() {} }],
        unstubbed: [],
      }),
    (err) =>
      /POST \/api\/synthetic\/nope/.test(err.message) && /route table/.test(err.message)
  );

  // The same for an exemption path, named against its declaring file.
  assert.throws(
    () =>
      assertHarnessCoverage({
        mounted,
        table: [{ method: 'GET', pattern: '/api/synthetic/thing', respond() {} }],
        unstubbed: [
          { file: 'components/Ghost.js', reason: 'gone', paths: [{ method: 'DELETE', pattern: '/api/synthetic/ghost' }] },
        ],
      }),
    (err) =>
      /DELETE \/api\/synthetic\/ghost/.test(err.message) && /components\/Ghost\.js/.test(err.message)
  );
});

test('a mounted :param route matches a table :param entry through the full guard', () => {
  // The matcher assertion above, driven end to end: a synthetic app mounting a
  // parameterised route, checked by the real key comparison rather than by the
  // string helper alone.
  const router = express.Router();
  router.get('/:leagueId/chat', (_req, res) => res.json({}));
  const app = express();
  app.use('/api/league', router);
  const mounted = mountedRoutes(app);

  assert.equal(
    assertHarnessCoverage({
      mounted,
      table: [{ method: 'GET', pattern: '/api/league/:id/chat', respond() {} }],
      unstubbed: [],
    }),
    1
  );
  assert.throws(
    () =>
      assertHarnessCoverage({
        mounted,
        table: [{ method: 'GET', pattern: '/api/league/:id/chats', respond() {} }],
        unstubbed: [],
      }),
    /GET \/api\/league\/:id\/chats/
  );
});

test('the guard fails on an empty table rather than passing vacuously', () => {
  const router = express.Router();
  router.get('/thing', (_req, res) => res.json({}));
  const app = express();
  app.use('/api/synthetic', router);
  assert.throws(
    () => assertHarnessCoverage({ mounted: mountedRoutes(app), table: [], unstubbed: [] }),
    /table is empty/
  );
});

test('the guard fails when the walker enumerates zero routes', () => {
  assert.throws(
    () =>
      assertHarnessCoverage({
        mounted: [],
        table: [{ method: 'GET', pattern: '/api/synthetic/thing', respond() {} }],
        unstubbed: [],
      }),
    /enumerated no mounted routes/
  );
});

// ---------------------------------------------------------------------------
// The guard itself, against the real app and the real harness table.
// ---------------------------------------------------------------------------

test('every harness route table entry and exemption names a route the app still mounts', () => {
  const { app } = require('../server');
  const mounted = mountedRoutes(app);

  // Green-for-the-wrong-reason pins, asserted here too so the numbers are
  // visible in this test and not only inside the guard: the walker really saw
  // the app, and the table really has entries.
  assert.ok(mounted.length > 100, `expected the walker to enumerate the real app, saw ${mounted.length}`);
  assert.ok(routeTable.length > 0, 'the harness route table has entries');

  // No throw is the pass; the guard's message names any offender.
  const enumerated = assertHarnessCoverage({ mounted, table: routeTable, unstubbed });
  assert.equal(enumerated, mounted.length);
});
