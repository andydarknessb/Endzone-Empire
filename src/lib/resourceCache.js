/**
 * The React-free half of the shared resource cache (ADR 0004). The React
 * binding lives in src/hooks/useResource.js; sessionCaches.js talks to this
 * module directly, because dropping a session must not depend on React.
 *
 * Admission rule: a GET is cached through this module only when it is on the
 * service worker's API allowlist (read-only and viewer-safe) AND more than one
 * mount reads it in a typical navigation. Everything else stays a plain fetch
 * in the component that needs it. The transaction log is the deliberate
 * exception: one consumer, not on the allowlist, and every roster mutation
 * would be an invalidation site.
 *
 * Keys are arrays, e.g. ['league', 7] or ['pickem-standings', 7, 2026]. Each
 * element is stored under String(), so a route-param string and a numeric id
 * for the same resource share one entry, and a null or undefined element is
 * omitted, so "no season" is simply the shorter key that a prefix match
 * already covers. Elements are joined with a NUL, a character no id can
 * contain, so a serialized key splits back into exactly the elements it was
 * built from: prefix matching compares element against element rather than
 * running startsWith over the joined string, and ['pickem-standings', 7] can
 * never sweep away league 70.
 */

const SEPARATOR = '\u0000';

function keyParts(key) {
  if (key == null) return [];
  if (Array.isArray(key)) return key.filter((part) => part != null).map(String);
  // A serialized key is itself a valid key: it splits back into the elements
  // it was built from. That is what lets useResource carry one string around
  // instead of rebuilding its key array on every render.
  if (typeof key === 'string') return key === '' ? [] : key.split(SEPARATOR);
  return [String(key)];
}

/** Array key -> the string the store is keyed by. Exported for tests and hooks. */
export function serializeKey(key) {
  return keyParts(key).join(SEPARATOR);
}

function matchesPrefix(serialized, prefix) {
  if (prefix.length === 0) return true; // no prefix means every entry
  const parts = keyParts(serialized);
  if (parts.length < prefix.length) return false;
  return prefix.every((part, index) => parts[index] === part);
}

// One entry per key, shared by every mount reading that key. A pending fetch
// is kept as `promise` so concurrent mounts await the same request instead of
// each firing their own; once it settles, `data`/`fetchedAt` serve later
// mounts inside the TTL without a network round-trip.
const entries = new Map();
// Bumped by setResource and by invalidate. A response that was already in
// flight when its key was invalidated (a logout mid-fetch, a save landing
// mid-fetch) must not repopulate the store as fresh, and a write-through must
// not be overwritten by a request that started before it, so a fetch only
// stores its result if the generation it began under is still current. The
// mount that asked still gets its answer either way.
const generations = new Map();
// Mounted hooks, keyed by the exact serialized key, so an invalidation reaches
// what is on screen (the standings table while the commissioner changes the
// mode above it) instead of only the next mount.
const listeners = new Map();

const generationOf = (serialized) => generations.get(serialized) || 0;

function bumpGeneration(serialized) {
  generations.set(serialized, generationOf(serialized) + 1);
}

function notify(serialized, event) {
  const subscribers = listeners.get(serialized);
  if (!subscribers) return;
  // Copy first: a listener may subscribe or unsubscribe while being notified.
  Array.from(subscribers).forEach((listener) => listener(event));
}

/** The stored entry for a key, or undefined. Shape: { data, promise, fetchedAt }. */
export function read(key) {
  return entries.get(serializeKey(key));
}

/** An entry is fresh while it holds a settled response younger than the ttl. */
export function isFresh(entry, ttl) {
  if (!entry || entry.fetchedAt == null) return false;
  if (!(ttl > 0)) return false;
  return Date.now() - entry.fetchedAt < ttl;
}

/**
 * Runs `fetcher` for a key unless a request for it is already in flight, in
 * which case every caller shares that one promise. The returned promise always
 * settles for the caller, even when the result is refused by the store: the
 * mount that asked gets its answer, the store just does not keep it.
 */
export function load(key, fetcher) {
  const serialized = serializeKey(key);
  const existing = entries.get(serialized);
  if (existing?.promise) return existing.promise;

  const generation = generationOf(serialized);
  const promise = fetcher();
  // Keep whatever data was already there: a reload serves the previous
  // response to other mounts until the new one lands.
  entries.set(serialized, { data: existing?.data, promise, fetchedAt: null });
  promise.then(
    (data) => {
      if (generationOf(serialized) === generation) {
        entries.set(serialized, { data, promise: null, fetchedAt: Date.now() });
      }
    },
    () => {
      // Failures are never cached: the next mount must be free to try again.
      if (generationOf(serialized) === generation) entries.delete(serialized);
    }
  );
  return promise;
}

/**
 * Write-through: stores `data` as a fresh response and pushes it to every
 * mount on that exact key, with no network. The generation bump is what stops
 * a request that started before the write from landing on top of it.
 */
export function setResource(key, data) {
  const serialized = serializeKey(key);
  entries.set(serialized, { data, promise: null, fetchedAt: Date.now() });
  bumpGeneration(serialized);
  notify(serialized, { type: 'set', data });
}

/**
 * Forgets every entry whose key starts with `keyPrefix`, element by element,
 * and with no prefix forgets everything. Mounted hooks on a matching key are
 * told to reload, keeping their current data on screen until the new response
 * lands.
 *
 * `reload: false` forgets without telling anyone, which is what a session drop
 * needs: login.saga drops caches before the user is unset, so a reload here
 * would fire requests carrying a token that has just been revoked.
 */
export function invalidate(keyPrefix, { reload = true } = {}) {
  const prefix = keyParts(keyPrefix);
  const matched = new Set();
  for (const serialized of entries.keys()) {
    if (matchesPrefix(serialized, prefix)) matched.add(serialized);
  }
  // A mounted hook whose entry was already dropped still has to hear about a
  // later invalidation, so listener keys are matched too.
  for (const serialized of listeners.keys()) {
    if (matchesPrefix(serialized, prefix)) matched.add(serialized);
  }

  matched.forEach((serialized) => {
    entries.delete(serialized);
    bumpGeneration(serialized);
  });
  if (reload) matched.forEach((serialized) => notify(serialized, { type: 'invalidate' }));
}

/** Subscribes to one exact key. Returns the unsubscribe function. */
export function subscribe(key, listener) {
  const serialized = serializeKey(key);
  let subscribers = listeners.get(serialized);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(serialized, subscribers);
  }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(serialized);
  };
}
