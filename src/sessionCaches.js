import { invalidate } from './lib/resourceCache';

/**
 * Everything the app remembers about the signed-in session outside redux:
 * the service worker's offline API store (viewer-scoped rows such as
 * /api/league/:id with is_commissioner and invite_code, the roster, the
 * pick'em week view with unlocked picks) and the in-memory resource cache.
 * Called on every session change (login, logout, registration, expiry) so a
 * different account on the same device is not served the previous one's rows.
 * The in-memory store also refuses a response that was in flight when it was
 * cleared; the offline API store is best-effort for a request already on the
 * wire (a fresh session's token is not on it, and its 401 is never cached).
 *
 * `reload: false` is the point of this call: login.saga drops caches before
 * the user is unset, so telling mounted hooks to reload here would fire
 * requests carrying a token that has just been revoked.
 */
export function dropSessionCaches() {
  invalidate(undefined, { reload: false });
  if (typeof caches !== 'undefined') {
    caches.delete('api-cache-v1').catch(() => {});
  }
}
