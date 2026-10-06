import { lazy } from 'react';

// After a deploy, a tab still running the old bundle asks for the old hashed
// chunk of a route it has not opened yet, and that file is gone (404). One
// reload picks up the new index.html and its new chunk names. The guard key in
// sessionStorage keeps it to one reload, so a real outage shows the error
// instead of reloading forever; a successful load clears it for the next deploy.
const GUARD_KEY = 'endzone.chunkReload';

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

/** The import with the one-reload rule, separate from React.lazy for tests. */
export function loadWithReload(load, { storage = defaultStorage(), reload = () => window.location.reload() } = {}) {
  return load().then(
    (module) => {
      try { storage?.removeItem(GUARD_KEY); } catch { /* storage blocked: nothing to clear */ }
      return module;
    },
    (err) => {
      if (!isChunkLoadError(err)) throw err;
      try {
        if (!storage || storage.getItem(GUARD_KEY)) throw err;
        storage.setItem(GUARD_KEY, '1');
      } catch {
        // Already reloaded once, or no storage to remember it in: surface the error.
        throw err;
      }
      reload();
      return new Promise(() => {}); // the page is going away; never render the error
    }
  );
}

/** React.lazy for a route chunk, reloading once when the chunk is from a previous deploy. */
export function lazyWithReload(load) {
  return lazy(() => loadWithReload(load));
}
