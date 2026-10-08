import { invalidate } from './lib/resourceCache';

/**
 * Everything the app remembers about the signed-in session outside redux:
 * the in-memory resource cache (viewer-scoped rows such as
 * /api/league/:id with is_commissioner and invite_code, the roster, the
 * pick'em week view with unlocked picks).
 * Called on every session change (login, logout, registration, expiry) so a
 * different account on the same device is not served the previous one's rows.
 * The store also refuses a response that was in flight when it was cleared.
 *
 * `reload: false` is the point of this call. `loginUser` drops caches while
 * the previous session's token is still installed, so telling mounted hooks to
 * reload there would refill the store with the outgoing account's
 * viewer-scoped rows moments before SET_USER. `logoutUser` has already cleared
 * the token, so a reload there would be an unauthenticated request against a
 * session that is about to be revoked.
 */
export function dropSessionCaches() {
  invalidate(undefined, { reload: false });
}
