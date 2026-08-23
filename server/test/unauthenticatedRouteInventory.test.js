const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { requireAuth, requireSocketAuth } = require('../modules/auth');

/**
 * The inventory of routes reachable WITHOUT a session (#201).
 *
 * #173 found the public presenter board handing an anonymous caller a
 * `SELECT * FROM "leagues"` row with a handful of names deleted from it, and
 * two fields - a manager's account username and the league's own
 * `draft_share_token` - had already gone out that way. The route was not
 * special. It was public because `router.get('/board/:token', ...)` is
 * registered BEFORE `router.use(requireAuth)` in the same file, which is
 * invisible from the route's name and from every sibling around it.
 *
 * So this suite does not read route names and judge. It walks the mounted
 * Express stacks the way Express itself does and classifies each route by
 * whether `requireAuth` appears in the chain that would actually run -
 * router-level middleware registered ahead of it, or a per-route handler. The
 * result is asserted as an EXACT set. A new route registered ahead of a
 * router-level `requireAuth`, a `router.use(requireAuth)` moved down a file,
 * or a whole new router mounted without one, all fail here with the new path
 * named, instead of shipping quietly.
 *
 * The classifier is itself proven below against a router built to have the
 * presenter board's exact shape, because a walker that silently returned
 * everything (or nothing) would make the inventory assertion read as a
 * guarantee while asserting nothing.
 *
 * Payload contracts for the routes listed here live next door:
 *   publicPayloadShape.test.js   - /api/public/*
 *   authPayloadShape.test.js     - /api/auth/*
 *   healthPayloadShape.test.js   - /api/health/*
 *   draftPresenterBoard.test.js  - /api/draft/board/:token (#199)
 */

/**
 * Is this layer the auth guard?
 *
 * Keyed on the Layer's recorded handler NAME rather than on function
 * identity, because `express-async-errors` (required by server.js) replaces
 * `Layer.prototype.handle` with a setter that stores a wrapper, so
 * `layer.handle === requireAuth` is false for every layer in the real app.
 * Express records `fn.name` in the constructor, before that wrapping, so the
 * name survives. The hole a name leaves - some other function also called
 * `requireAuth` - is closed by the source assertion at the end of this file:
 * no router may define or import a `requireAuth` that is not the real one.
 */
function isAuthGuard(layer) {
  return layer.name === requireAuth.name || layer.handle === requireAuth;
}

/** The path `app.use(path, router)` was mounted at, recovered from the layer's regexp. */
function mountPathOf(layer) {
  const tail = '\\/?(?=\\/|$)';
  let src = layer.regexp.source;
  if (src.endsWith(tail)) src = src.slice(0, -tail.length);
  if (src.startsWith('^')) src = src.slice(1);
  return src.replace(/\\\//g, '/');
}

/** True for a middleware layer mounted at the router root, i.e. one that runs for every route below it. */
function isRootMiddleware(layer) {
  return mountPathOf(layer) === '';
}

/**
 * Could this layer hand the request on to the next one?
 *
 * A function that does not DECLARE a `next` parameter cannot call one, so it
 * is the end of its chain: everything registered behind it is dead code.
 * Arity is the only decidable form of that question from a mounted stack, and
 * it survives `express-async-errors` - the wrapper it installs is built with
 * the same arity as the function it wraps (verified against the installed
 * express 4.22.2 and express-async-errors 3.1.1, not read off the docs).
 *
 * SCOPE: this is sound in one direction only. A layer that declares `next`
 * MIGHT still answer and never call it - `requireAuth` itself does exactly
 * that when it refuses - so a three-argument handler that responds is read
 * here as "could continue". That direction is the safe one for a guard placed
 * BEFORE it. The unsafe residue is a three-argument handler that responds
 * followed by a guard, which still reads as guarded; nothing in the app has
 * that shape, and closing it would need the handler's behaviour rather than
 * its signature.
 */
function canContinue(layer) {
  return layer.handle.length >= 3;
}

/**
 * Is `requireAuth` in the chain Express would actually run for THIS method of
 * this route?
 *
 * Two things make that narrower than "is the guard anywhere in the stack",
 * and the route classifier got both wrong before #241:
 *
 * 1. METHOD. All of a `Route`'s handlers live on one `Route.stack`, each layer
 *    tagged with `.method` (undefined for `route.all`, which runs for every
 *    method). Express dispatches by that tag. So `route('/t').get(open)
 *    .post(requireAuth, h)` has a guard in its stack that GET never meets.
 * 2. ORDER. Express runs the matching layers left to right and stops at the
 *    one that answers, so a guard behind a terminal handler - `router.get(
 *    '/x', handler, requireAuth)` - never runs at all.
 */
function guardsMethod(route, method) {
  for (const layer of route.stack) {
    if (layer.method && layer.method !== method) continue;
    if (isAuthGuard(layer)) return true;
    if (!canContinue(layer)) return false;
  }
  return false;
}

/**
 * Every route in `router`, each tagged with whether `requireAuth` is in the
 * chain Express would run for it. Order matters and is the whole point: a
 * root-mounted `requireAuth` protects only the routes registered AFTER it.
 */
function classifyRoutes(router, prefix = '') {
  const found = [];
  let guardedFromHere = false;
  for (const layer of router.stack) {
    if (!layer.route) {
      if (isRootMiddleware(layer) && isAuthGuard(layer)) guardedFromHere = true;
      // A router mounted inside a router inherits whatever guards it already.
      if (layer.handle && Array.isArray(layer.handle.stack)) {
        for (const nested of classifyRoutes(layer.handle, prefix + mountPathOf(layer))) {
          found.push({ ...nested, guarded: nested.guarded || guardedFromHere });
        }
      }
      continue;
    }
    for (const method of Object.keys(layer.route.methods)) {
      found.push({
        signature: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
        guarded: guardedFromHere || guardsMethod(layer.route, method),
      });
    }
  }
  return found;
}

/** Every route the app mounts, classified. */
function classifyApp(app) {
  const found = [];
  for (const layer of app._router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push({
          signature: `${method.toUpperCase()} ${layer.route.path}`,
          guarded: guardsMethod(layer.route, method),
        });
      }
      continue;
    }
    if (layer.handle && Array.isArray(layer.handle.stack)) {
      found.push(...classifyRoutes(layer.handle, mountPathOf(layer)));
    }
  }
  return found;
}

/**
 * Every middleware in the mounted tree that is neither a route nor a router:
 * `use(fn)` and `use(path, fn)`, at the app level and at every router level
 * below it, each with the FULL path it is mounted at.
 *
 * `classifyApp` cannot see these - they have no `.route` and no `.handle.stack`
 * - so an anonymous surface mounted that way (`use('/exports',
 * express.static('server/data'))` is the shape to fear) would contribute
 * nothing to the inventory and fail no assertion in it. They are enumerated
 * separately and pinned by the three assertions further down: by name for a
 * static mount, by path for anything owning one, and by arity for anything
 * that answers.
 *
 * Until #241 this read `app._router.stack` alone, and the same middleware
 * inside a router escaped every assertion in this file. Recursing brings 17
 * existing router-level layers into view - the routers' own `requireAuth`,
 * `requirePlatformAdmin`, the rate limiters, the two `requireFantasyLeague()`
 * mounts - so the three pins below are written to separate a harmful mount
 * from those 17 rather than to list them.
 *
 * SCOPE. Two things still escape. A middleware attached to a Router that is
 * never mounted is not in this tree and is not reachable either. And a
 * root-mounted, three-argument middleware inside a router that answers instead
 * of calling `next` is seen here but sorted as benign, because no pin can tell
 * it from the guards it looks exactly like; see the arity assertion below.
 */
function terminalMiddleware(app) {
  const rows = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) continue;
      if (layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack, prefix + mountPathOf(layer));
        continue;
      }
      rows.push({
        name: layer.name,
        at: prefix + mountPathOf(layer),
        rooted: isRootMiddleware(layer),
        answers: !canContinue(layer),
        level: prefix === '' ? 'app' : 'router',
      });
    }
  };
  walk(app._router.stack, '');
  return rows;
}

/** One terminal middleware, as `name mount-path`, for an assertion to read. */
const describeMount = (row) => `${row.name} ${row.at || '/'}`;

/** Every `express.static` in the tree, wherever it is mounted. */
const staticMounts = (app) =>
  terminalMiddleware(app).filter((row) => row.name === 'serveStatic').map(describeMount);

/** Every terminal middleware mounted at a PATH rather than at a root. */
const pathMounts = (app) =>
  terminalMiddleware(app).filter((row) => !row.rooted).map(describeMount);

/** Every terminal middleware that answers the request instead of handing it on. */
const responders = (app) =>
  terminalMiddleware(app).filter((row) => row.answers).map(describeMount);

/**
 * Every socket.io namespace on this server, with the handshake middleware it
 * carries.
 *
 * Handshake middleware belongs to a NAMESPACE, not to the server: `io.use(fn)`
 * is `io.of('/').use(fn)`, and `io.of('/admin')` starts life with its own empty
 * `_fns`. `io._nsps` is the Map of them, keyed by path, and `io.sockets` is
 * simply its `/` entry - so the pre-#241 check read one namespace and reported
 * on all of them.
 */
function namespaceGuards(io) {
  return [...io._nsps.entries()].map(([name, nsp]) => ({
    name,
    middleware: (nsp._fns || []).map((fn) => fn.name),
  }));
}

/** The namespaces a caller could reach without `requireSocketAuth` in the handshake. */
const unguardedNamespaces = (io) =>
  namespaceGuards(io)
    .filter((nsp) => !nsp.middleware.includes(requireSocketAuth.name))
    .map((nsp) => nsp.name);

const signatures = (app, wanted) =>
  classifyApp(app).filter((r) => r.guarded === wanted).map((r) => r.signature).sort();
const anonymous = (app) => signatures(app, false);
const guarded = (app) => signatures(app, true);
const isApi = (signature) => signature.includes(' /api/');

// ---------------------------------------------------------------------------
// The classifier, proven before it is trusted.
// ---------------------------------------------------------------------------

test('the classifier calls a route registered BEFORE a router-level requireAuth anonymous', () => {
  // draft.router.js's exact shape: the presenter board, then the guard, then
  // the rest. Reading the file top-down is the only way to see it, which is
  // precisely why it is worth a machine check.
  const router = express.Router();
  router.get('/board/:token', (_req, res) => res.json({}));
  router.use(requireAuth);
  router.get('/mine', (_req, res) => res.json({}));

  const app = express();
  app.use('/api/draft', router);

  assert.deepEqual(anonymous(app), ['GET /api/draft/board/:token']);
  assert.deepEqual(guarded(app), ['GET /api/draft/mine']);
});

test('the classifier honours a per-route requireAuth, with no router-level guard at all', () => {
  // player.router.js's and user.router.js's shape.
  const router = express.Router();
  router.get('/open', (_req, res) => res.json({}));
  router.get('/closed', requireAuth, (_req, res) => res.json({}));
  router.delete('/closed', requireAuth, (_req, res) => res.json({}));

  const app = express();
  app.use('/api/players', router);

  assert.deepEqual(anonymous(app), ['GET /api/players/open']);
  assert.deepEqual(guarded(app), ['DELETE /api/players/closed', 'GET /api/players/closed']);
});

test('the classifier judges each method of a route() chain by its own handlers (#241)', () => {
  // In Express 4 every method handler of one `router.route(path)` lives on ONE
  // `Route.stack`, tagged with `.method`; dispatch filters by that tag. A
  // classifier that asks the whole stack whether a guard is anywhere in it
  // answers the same for every method, so one guarded method launders its
  // anonymous siblings into the guarded column and out of the audit.
  const router = express.Router();
  router.route('/thing')
    .get((_req, res) => res.json({ everything: true }))
    .post(requireAuth, (_req, res) => res.json({}));

  const app = express();
  app.use('/api/y', router);

  assert.deepEqual(anonymous(app), ['GET /api/y/thing']);
  assert.deepEqual(guarded(app), ['POST /api/y/thing']);
});

test('a guard registered AFTER the terminal handler guards nothing (#241)', () => {
  // The file's whole thesis is that ORDER decides. It has to hold inside a
  // route's own handler list too: Express runs them left to right, and a
  // handler that answers never calls `next`, so a guard behind it is dead
  // code. Reading it as a guard is the same laundering as above, one
  // argument along.
  const router = express.Router();
  router.get('/x', (_req, res) => res.json({ everything: true }), requireAuth);

  const app = express();
  app.use('/api/y', router);

  assert.deepEqual(anonymous(app), ['GET /api/y/x']);
  assert.deepEqual(guarded(app), []);
});

test('and that route really does answer an anonymous caller (#241)', async () => {
  // The classification above is only worth asserting if the request itself
  // gets through, so the shape is served here rather than reasoned about:
  // no Authorization header, 200, and the payload the handler wrote.
  const router = express.Router();
  router.get('/x', (_req, res) => res.json({ everything: true }), requireAuth);

  const app = express();
  app.use('/api/y', router);

  const response = await request(app).get('/api/y/x');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { everything: true });
});

test('the classifier reports a path-scoped guard as no guard at all for its siblings', () => {
  // `router.use('/league/:id', requireFantasyLeague())` is the shape in
  // draft.router.js and scoring.router.js. A middleware mounted at a PATH
  // does not protect the routes around it, and a root-mounted guard is the
  // only kind this classifier counts.
  const router = express.Router();
  router.use('/league/:id', requireAuth);
  router.get('/queue', (_req, res) => res.json({}));

  const app = express();
  app.use('/api/draft', router);

  assert.deepEqual(anonymous(app), ['GET /api/draft/queue']);
});

test('a static mount INSIDE a router is pinned by name, like an app-level one (#241)', async () => {
  // The shape #241 was filed for. `router.use('/exports', express.static(dir))`
  // has no `.route` and no nested stack, so the route classifier drops it -
  // and before #241 the compensating pin read `app._router.stack` alone, so a
  // router put its directory on the internet with every assertion in this file
  // still green. Both halves are asserted here: the walk finds nothing, and
  // the pin names it.
  const router = express.Router();
  router.use('/exports', express.static(__dirname));
  router.get('/ok', (_req, res) => res.json({}));

  const app = express();
  app.use('/api/y', router);

  assert.deepEqual(staticMounts(app), ['serveStatic /api/y/exports']);

  // ...and it really does serve, which is why the pin has to see it: this file
  // reads back over HTTP with no session.
  const response = await request(app).get('/api/y/exports/unauthenticatedRouteInventory.test.js');
  assert.equal(response.status, 200);
  assert.match(response.text, /the inventory of routes reachable WITHOUT a session/i);
  assert.deepEqual(anonymous(app), ['GET /api/y/ok'], 'the route walk never sees the directory');
});

test('a router-level middleware that ANSWERS is pinned even at the router root (#241)', async () => {
  // The residue the two pins above cannot reach. A terminal middleware mounted
  // at a router's ROOT is excluded from the path pin by the same rule the app
  // level uses - root-mounted middleware runs everywhere and exposes no path
  // of its own - but that rule assumes it hands the request on. One that
  // answers instead is a surface covering everything below the router's mount,
  // under no route name at all. It is separated by whether it CAN call `next`.
  const router = express.Router();
  router.use((_req, res) => res.json({ everything: true }));

  const app = express();
  app.use('/api/y', router);

  assert.deepEqual(responders(app), ['<anonymous> /api/y']);
  assert.deepEqual(staticMounts(app), [], 'not a static mount, so the pin above never sees it');
  assert.deepEqual(pathMounts(app), [], 'and it is root-mounted, so the path pin never sees it');

  const response = await request(app).get('/api/y/anything-at-all');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { everything: true });
});

test('the guard the classifier looks for is the one that actually refuses a request', () => {
  // The classifier keys on a name, so the name has to belong to a function
  // that really rejects: otherwise "guarded" is a label, not a fact.
  let status = null;
  let body = null;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  let nexted = false;
  requireAuth({ get: () => '' }, res, () => { nexted = true; });
  assert.equal(nexted, false, 'a request with no Authorization header does not continue');
  assert.equal(status, 401);
  assert.deepEqual(body, { error: 'Missing bearer token' });
});

// ---------------------------------------------------------------------------
// The inventory itself.
// ---------------------------------------------------------------------------

/**
 * Every API route the app serves without a session, audited in #201.
 *
 * A path appears here only because someone decided it should be public.
 * Adding one is that decision; the accompanying payload-shape suite is the
 * other half of it.
 *
 *   /api/auth/*    - the credential surface. Nothing here can require a
 *                    session; it is where sessions come from. `/refresh` and
 *                    `/logout` carry requireTrustedOrigin plus an httpOnly
 *                    cookie instead.
 *   /api/health/*  - liveness and readiness probes, called by Render and by
 *                    the monitor with no credentials.
 *   /api/public/*  - the no-login top-of-funnel pages, league-free NFL data.
 *   /api/draft/board/:token - the presenter board, held by a share link (#173).
 */
const PUBLIC_ROUTES = [
  'POST /api/auth/forgot-password',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/refresh',
  'POST /api/auth/register',
  'POST /api/auth/reset-password',
  'POST /api/auth/verify-email',
  'GET /api/draft/board/:token',
  'GET /api/health/',
  'GET /api/health/holdout',
  'GET /api/health/livez',
  'GET /api/health/readyz',
  'GET /api/health/worker',
  'GET /api/public/draft-pool',
  'GET /api/public/players/:id',
  'GET /api/public/rankings',
  'GET /api/public/recaps',
  'GET /api/public/recaps/:gameId',
  'GET /api/public/sitemap.xml',
];

test('the app serves exactly these API routes without a session', () => {
  const { app } = require('../server');
  assert.deepEqual(anonymous(app).filter(isApi), [...PUBLIC_ROUTES].sort());
});

test('every other mounted API route requires a session', () => {
  // The complement, asserted so the inventory above cannot pass by the walker
  // finding nothing: the bulk of the API is guarded, and no route is in both
  // columns.
  const { app } = require('../server');
  const authed = guarded(app).filter(isApi);
  assert.ok(authed.length > 100, `expected the bulk of the API to be guarded, saw ${authed.length}`);
  for (const signature of PUBLIC_ROUTES) {
    assert.equal(authed.includes(signature), false, `${signature} is in both columns`);
  }
});

test('only four routers hold an anonymous route at all', () => {
  // Named so a router that GAINS its first public route fails with the
  // router's own name, rather than as one more line in a long diff.
  const { app } = require('../server');
  const mounts = new Set(
    anonymous(app).filter(isApi).map((s) => s.split(' ')[1].split('/').slice(0, 3).join('/'))
  );
  assert.deepEqual([...mounts].sort(), ['/api/auth', '/api/draft', '/api/health', '/api/public']);
});

test('no middleware anywhere in the tree serves a directory except the SPA shell', () => {
  // `express.static` is the one middleware that turns a mount path into a
  // readable directory, and it is invisible to the route classifier above: no
  // `.route`, no nested stack. So it is asserted directly, wherever it is
  // mounted - app or router, root or path (#241).
  const { app } = require('../server');
  assert.deepEqual(staticMounts(app), ['serveStatic /'], 'the only static mount is build/ at the root');
});

test('no middleware anywhere in the tree is mounted at a path without a decision here', () => {
  // Everything `use(path, fn)` installs, other than the routers, at any level.
  // Each is a cross-cutting concern with no payload of its own; the list is
  // pinned so that mounting a NEW responder at a path is a failure naming the
  // path, rather than a surface the route classifier structurally cannot see.
  //
  // WHY THIS LIST IS EXACT RATHER THAN FILTERED, since #241 made it reach into
  // routers and a reader meeting a hardcoded list deserves the reason. There
  // are 34 terminal middlewares in this tree and 17 of them sit at router
  // level; every one of the 17 is a guard or a rate limiter, and a harmful
  // mount would look like them in every respect a filter can read - same
  // `use(...)` call, same layer shape, and a name it chooses for itself. So
  // there is no pattern that excludes the benign 17 and is guaranteed to keep
  // the harmful 18th. What separates them is not a name but a POSITION: these
  // are the mounts that own a path.
  //
  // That splits the 17 rather than excluding them. FIFTEEN are root-mounted
  // and drop out by the rule this assertion already used at app level -
  // root-mounted middleware runs for everything below it and owns no path of
  // its own. The other TWO own a path, so they are here, on the two lines
  // naming requireFantasyLeague(); they are listed for the same reason the
  // app-level rate limiters are, not as an exception to it. The assumption
  // inside the exclusion, that a root-mounted middleware hands the request on,
  // is not assumed: it is asserted separately below, by arity.
  //
  // This list is therefore EXPECTED to change when the app legitimately adds a
  // path-mounted middleware. Adding the new line is the decision; the failure
  // is the prompt to make it deliberately.
  const { app } = require('../server');

  // The three counts the paragraph above argues from, asserted rather than
  // asserted-about, so the argument cannot quietly stop being true. They are
  // also the only net under the residue named by the arity pin below: a
  // three-argument responder added at a router root satisfies all three pins
  // and changes nothing here except the first of these numbers.
  //
  // All three are EXPECTED to move when a router gains a guard or a limiter.
  // Moving them is a one-line edit; the value of the line is the look it
  // forces at what was added.
  const layers = terminalMiddleware(app);
  const routerLevel = layers.filter((row) => row.level === 'router');
  assert.equal(layers.length, 34, 'terminal middlewares in the whole tree');
  assert.equal(routerLevel.length, 17, 'of which sit inside a router');
  assert.equal(routerLevel.filter((row) => row.rooted).length, 15, 'of which own no path');

  assert.deepEqual(pathMounts(app), [
    '<anonymous> /api',                       // Cache-Control: private, no-store
    'rateLimitMiddleware /api',               // generalApiLimiter
    'rateLimitMiddleware /api/auth/login/?(?=/|$)|^/api/auth/register/?(?=/|$)|^/api/auth/forgot-password',
    'rateLimitMiddleware /api/auth/refresh',  // refreshLimiter
    '<anonymous> /api/scoring/league(?:/([^/]+?))',  // requireFantasyLeague(), scoring.router
    '<anonymous> /api/draft/league(?:/([^/]+?))',    // requireFantasyLeague(), draft.router
    '<anonymous> /api/public',                // the public CDN Cache-Control
    '<anonymous> /api',                       // the API 404
  ]);
});

test('only one middleware in the tree answers a request rather than passing it on', () => {
  // The complement of the pin above, and the reason that one may exclude
  // root-mounted middleware without hand-waving (#241). A terminal middleware
  // is safe to exclude because it hands the request on; one that ANSWERS is a
  // surface covering everything below its mount, under no route name at all,
  // and `router.use((req, res) => res.json(...))` puts one at a router root
  // where the path pin will not look.
  //
  // "Answers" is read as "does not declare a `next` parameter, so it cannot
  // call one" - see canContinue. That is one-directional: the 33 layers not
  // listed here all COULD hand the request on, which is not the same as
  // proving they do. `requireAuth` is itself an example of one that answers
  // sometimes, and that is the residue this pin does not cover: a
  // three-argument middleware that responds anyway is invisible to it.
  //
  // That residue has one net, and it is a weak one: the three pins here name 9
  // of the tree's 34 terminal layers between them, and the count pinned in the
  // assertion above is all that stands under the other 25. It says "something
  // was added", never "something is wrong" - which is the honest limit of what
  // a mounted stack can be asked about a function's behaviour.
  const { app } = require('../server');
  assert.deepEqual(responders(app), ['<anonymous> /api'], 'the API 404 is the only one');
});

test('the only anonymous non-API route is the static SPA shell', () => {
  // `app.get(/^(?!\/api\/).*/)` serves build/index.html and touches no
  // database. It is in the anonymous column and belongs there; it is named
  // here so it cannot be joined by a sibling nobody noticed.
  const { app } = require('../server');
  const nonApi = anonymous(app).filter((s) => !isApi(s));
  assert.deepEqual(nonApi, ['GET /^(?!\\/api\\/).*/']);
});

// ---------------------------------------------------------------------------
// Socket.IO.
// ---------------------------------------------------------------------------

test('the draft socket admits no unauthenticated connection', async () => {
  // The other way into this server. `attachDraftSocket` installs its guard as
  // namespace middleware, so it runs during the handshake, before any
  // `socket.on(...)` handler is reachable - but only if it is actually
  // installed, and only if it actually refuses. Both are checked here rather
  // than read off the source.
  //
  // Read across EVERY namespace since #241, not just the default one. Handshake
  // middleware belongs to a namespace, not to the server: `io.of('/admin')`
  // gets its own empty `_fns`, and reading `io.sockets._fns` (which is exactly
  // `io._nsps.get('/')._fns`) would have reported the guard present and said
  // nothing about it.
  const { attachDraftSocket, closeDraftSocket } = require('../modules/draftSocket');
  const httpServer = http.createServer();
  const io = attachDraftSocket(httpServer);
  try {
    await io.redisReady;
    assert.deepEqual(
      namespaceGuards(io),
      [{ name: '/', middleware: ['requireSocketAuth'] }],
      'one namespace, carrying the connection guard and nothing else'
    );

    // Namespaces named by a regexp or a function are held in `parentNsps`
    // instead, and their children are created per connection - so they cannot
    // be enumerated the way the above enumerates `_nsps`. There are none;
    // adding one would need this assertion answered before the guarantee above
    // means anything.
    assert.equal(io.parentNsps.size, 0, 'no dynamic namespace escapes the enumeration');

    const middleware = io._nsps.get('/')._fns;
    assert.equal(middleware[0], requireSocketAuth, 'and it is the real one');

    // It refuses a handshake with no token, and one with a token it cannot verify.
    for (const auth of [{}, { token: 'not-a-jwt' }]) {
      const error = await new Promise((resolve) => {
        requireSocketAuth({ handshake: { auth } }, resolve);
      });
      assert.ok(error instanceof Error, `a handshake with ${JSON.stringify(auth)} is refused`);
      assert.equal(error.message, 'unauthorized');
    }

    // And the enumeration above can fail, demonstrated on this same server
    // rather than argued: a second namespace, created the way a future admin
    // or spectator channel would create one, is unguarded from the moment it
    // exists and is named here as such (#241).
    io.of('/admin');
    assert.deepEqual(unguardedNamespaces(io), ['/admin']);
    assert.deepEqual(
      namespaceGuards(io).map((n) => n.name),
      ['/', '/admin'],
      'and it is enumerated, which reading io.sockets._fns never was'
    );
  } finally {
    await closeDraftSocket(io);
    httpServer.close();
  }
});

// ---------------------------------------------------------------------------
// The classifier's one blind spot, closed at the source.
// ---------------------------------------------------------------------------

test('no router binds the name requireAuth to anything but the real guard', () => {
  // The classifier keys on a handler NAME (see isAuthGuard), so a local
  // helper that happened to be called `requireAuth` could launder a route
  // into the guarded column. No router may declare one: the name is imported
  // from modules/auth or it is not used at all.
  // Scanned over the WHOLE server tree, not just server/routes, and recursively:
  // a router can live anywhere, and a guard named `requireAuth` defined
  // anywhere would be enough to launder one. Tests are excluded - they define
  // stand-ins on purpose, including in this file.
  const serverDir = path.join(__dirname, '..');
  const declaresOwn = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'test', 'data', 'migrations'].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(full, 'utf8');
      // `const { requireAuth } = ...` is a destructure, not a fresh binding of
      // the name, so this catches only a locally DEFINED one.
      if (/\b(?:function|const|let|var|class)\s+requireAuth\b/.test(source)) {
        declaresOwn.push(path.relative(serverDir, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(serverDir);

  // modules/auth.js is where it is supposed to be defined, and the only place.
  assert.deepEqual(declaresOwn, ['modules/auth.js']);

  // And every router in server/routes/ takes it from there, by either of the
  // two import shapes below.
  //
  // SCOPE, twice over. This half is NOT recursive: it reads the flat
  // server/routes/ directory, so a router placed anywhere else is unchecked
  // (every router is a flat file there today). And the member-access pattern
  // matches an identifier before the dot, so it catches
  // `const auth = require('../modules/auth'); auth.requireAuth` but NOT an
  // inline `require('../modules/guards').requireAuth`, where the character
  // before the dot is `)`. The recursive `declaresOwn` scan above is the
  // stronger guarantee and is the one that carries the classifier.
  const routesDir = path.join(serverDir, 'routes');
  const importsElsewhere = [];
  for (const file of fs.readdirSync(routesDir).filter((n) => n.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    for (const match of source.matchAll(/\{[^{}]*\brequireAuth\b[^{}]*\}\s*=\s*require\(([^)]*)\)/g)) {
      if (!/['"]\.\.\/modules\/auth['"]/.test(match[1])) importsElsewhere.push(`${file} (destructured)`);
    }
    for (const match of source.matchAll(/\b(\w+)\.requireAuth\b/g)) {
      const binding = new RegExp(`\\b(?:const|let|var)\\s+${match[1]}\\s*=\\s*require\\(['"]\\.\\./modules/auth['"]\\)`);
      if (!binding.test(source)) importsElsewhere.push(`${file} (${match[1]}.requireAuth)`);
    }
  }
  assert.deepEqual(importsElsewhere, [], 'every requireAuth comes from modules/auth');
});
