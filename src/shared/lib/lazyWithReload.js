import React, { lazy, useState } from 'react';

// After a deploy, a tab still running the old bundle asks for the old hashed
// chunk of a route it has not opened yet, and that file is gone (404). One
// reload picks up the new index.html and its new chunk names. The guard key in
// sessionStorage holds the time of the last reload, and a chunk failure reloads
// only if none happened in the last 60 seconds, so a real outage shows the error
// instead of reloading forever.
//
// A successful load deliberately does NOT clear the key. An unrelated chunk (a
// preload, a Nav piece) succeeding after the reload used to reset the guard, so a
// chunk that kept failing reloaded the page forever. The 60 s window still lets a
// long-lived tab reload once for each later deploy.
const GUARD_KEY = 'endzone.chunkReload';
const RELOAD_WINDOW_MS = 60 * 1000;

function isChunkLoadError(err) {
  return !!err && (err.name === 'ChunkLoadError' || /Loading (CSS )?chunk [^ ]+ failed/i.test(String(err.message || '')));
}

function defaultStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The import with the one-reload-per-window rule, separate from React.lazy for tests. */
export function loadWithReload(load, { storage = defaultStorage(), reload = () => window.location.reload(), now = Date.now } = {}) {
  return load().catch((err) => {
    if (!isChunkLoadError(err)) throw err;
    try {
      if (!storage) throw err;
      const at = now();
      const last = Number(storage.getItem(GUARD_KEY)); // missing or unparseable: 0 or NaN, allowed
      if (at - last >= 0 && at - last < RELOAD_WINDOW_MS) throw err;
      storage.setItem(GUARD_KEY, String(at));
    } catch {
      // Reloaded within the window, or no storage to remember it in: surface the error.
      throw err;
    }
    reload();
    return new Promise(() => {}); // the page is going away; never render the error
  });
}

/**
 * React.lazy for a route chunk, reloading once when the chunk is from a previous deploy.
 *
 * `.preload()` is speculative: it calls the raw load, never reloads and never touches
 * the reload guard. On success it records the module, so a component that mounts
 * afterwards renders the page directly with no Suspense round-trip (a preloaded route
 * never flashes its fallback); on failure it forgets the attempt so a later render goes
 * through loadWithReload. The render path (React.lazy) is the only one that reloads.
 * An instance that mounted before the load finished keeps the React.lazy component for
 * its lifetime, so it never remounts mid-life.
 */
export function lazyWithReload(load, options) {
  let loaded;
  let preloading;
  let rendering;
  const preload = () => {
    if (!preloading) {
      preloading = load().then(
        (module) => { loaded = module; return module; },
        (err) => { preloading = undefined; throw err; } // a failed preload can be retried
      );
    }
    return preloading;
  };
  const render = () => {
    if (loaded) return Promise.resolve(loaded);
    if (!rendering) {
      rendering = loadWithReload(load, options).then(
        (module) => { loaded = module; return module; },
        (err) => { rendering = undefined; throw err; }
      );
    }
    return rendering;
  };
  const Lazy = lazy(render);
  function LazyRoute(props) {
    const [Direct] = useState(() => (loaded ? loaded.default : null));
    return Direct ? <Direct {...props} /> : <Lazy {...props} />;
  }
  LazyRoute.preload = preload;
  return LazyRoute;
}
