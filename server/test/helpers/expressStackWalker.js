const { requireAuth } = require('../../modules/auth');

/**
 * The Express-stack walker, shared by the tests that need to enumerate what the
 * real app actually mounts rather than read route names and judge (#201, #241,
 * #477).
 *
 * `unauthenticatedRouteInventory.test.js` walks the stack to classify each route
 * by whether `requireAuth` runs for it. `draftHarnessRouteExistence.test.js`
 * (#477) walks the same stack to prove every E2E-harness route table entry still
 * matches a mounted route. Both must agree on how Express dispatch is read, so
 * the walker lives here and is required by both; a second copy would be exactly
 * the drift #474/#477 exist to prevent, one level down.
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
 * `requireAuth` - is closed by the source assertion at the end of the
 * inventory file: no router may define or import a `requireAuth` that is not
 * the real one.
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
 * Every mounted route as `{ method, path }`, split from the signatures
 * `classifyApp` builds. The path is a single token (no spaces), so the split on
 * the first space is total. This is the enumeration side of #477's inverse
 * guard: what the app really serves, to compare the harness route table against.
 */
function mountedRoutes(app) {
  return classifyApp(app).map(({ signature }) => {
    const spaceAt = signature.indexOf(' ');
    return {
      method: signature.slice(0, spaceAt),
      path: signature.slice(spaceAt + 1),
    };
  });
}

// Only the primitives with a consumer are exported: the inventory test needs
// mountPathOf/isRootMiddleware/canContinue for its middleware pins and
// classifyApp for the route inventory; #477's guard needs mountedRoutes.
// isAuthGuard, guardsMethod and classifyRoutes are internal to the walk, so
// they stay unexported - a declaration nothing reads is unaudited (ADR 0010).
module.exports = {
  mountPathOf,
  isRootMiddleware,
  canContinue,
  classifyApp,
  mountedRoutes,
};
