const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
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
    const perRoute = layer.route.stack.some(isAuthGuard);
    for (const method of Object.keys(layer.route.methods)) {
      found.push({
        signature: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
        guarded: guardedFromHere || perRoute,
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
      const perRoute = layer.route.stack.some(isAuthGuard);
      for (const method of Object.keys(layer.route.methods)) {
        found.push({ signature: `${method.toUpperCase()} ${layer.route.path}`, guarded: perRoute });
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
 * App-level middleware that is neither a route nor a router: `app.use(fn)` and
 * `app.use(path, fn)`.
 *
 * `classifyApp` cannot see these - they have no `.route` and no `.handle.stack`
 * - so an anonymous surface mounted that way (`app.use('/exports',
 * express.static('server/data'))` is the shape to fear) would contribute
 * nothing to the inventory and fail no assertion in it. They are enumerated
 * separately and pinned by name below.
 *
 * SCOPE, because this reads broader than it is: only the APP level is covered.
 * `classifyRoutes` drops a layer with no `.route` and no `.handle.stack` on its
 * `continue`, and this function reads `app._router.stack` alone, so the same
 * middleware mounted INSIDE a router - `router.use('/exports',
 * express.static(...))` - escapes every assertion in this file. Nothing does
 * that today. Closing it is its own ticket, not a property to claim here.
 */
function terminalMiddleware(app) {
  return app._router.stack
    .filter((layer) => !layer.route && !(layer.handle && Array.isArray(layer.handle.stack)))
    .map((layer) => `${layer.name} ${mountPathOf(layer) || '/'}`);
}

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

test('no app-level middleware serves a directory except the SPA shell', () => {
  // `express.static` is the one middleware that turns a mount path into a
  // readable directory, and `app.use(path, express.static(dir))` is invisible
  // to the route classifier above: no `.route`, no nested stack. So it is
  // asserted directly, wherever it is mounted.
  const { app } = require('../server');
  const staticMounts = terminalMiddleware(app).filter((row) => row.startsWith('serveStatic '));
  assert.deepEqual(staticMounts, ['serveStatic /'], 'the only static mount is build/ at the root');
});

test('no app-level middleware is mounted at a path without a decision here', () => {
  // Everything `app.use(path, fn)` installs, other than the routers. Each is a
  // cross-cutting concern with no payload of its own; the list is pinned so
  // that mounting a NEW responder at a path is a failure naming the path,
  // rather than a surface the route classifier structurally cannot see.
  // Root-mounted middleware (cors, helmet, compression, the body parsers, the
  // error handlers) is excluded: it cannot expose a path on its own.
  const { app } = require('../server');
  const mounted = terminalMiddleware(app).filter((row) => !row.endsWith(' /'));
  assert.deepEqual(mounted, [
    '<anonymous> /api',                       // Cache-Control: private, no-store
    'rateLimitMiddleware /api',               // generalApiLimiter
    'rateLimitMiddleware /api/auth/login/?(?=/|$)|^/api/auth/register/?(?=/|$)|^/api/auth/forgot-password',
    'rateLimitMiddleware /api/auth/refresh',  // refreshLimiter
    '<anonymous> /api/public',                // the public CDN Cache-Control
    '<anonymous> /api',                       // the API 404
  ]);
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
  const { attachDraftSocket, closeDraftSocket } = require('../modules/draftSocket');
  const httpServer = http.createServer();
  const io = attachDraftSocket(httpServer);
  try {
    await io.redisReady;
    const middleware = io.sockets._fns;
    assert.deepEqual(
      middleware.map((fn) => fn.name),
      ['requireSocketAuth'],
      'the connection guard is the only handshake middleware'
    );
    assert.equal(middleware[0], requireSocketAuth, 'and it is the real one');

    // It refuses a handshake with no token, and one with a token it cannot verify.
    for (const auth of [{}, { token: 'not-a-jwt' }]) {
      const error = await new Promise((resolve) => {
        requireSocketAuth({ handshake: { auth } }, resolve);
      });
      assert.ok(error instanceof Error, `a handshake with ${JSON.stringify(auth)} is refused`);
      assert.equal(error.message, 'unauthorized');
    }
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
