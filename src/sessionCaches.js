import { clearLeagueCache } from './hooks/useLeague';
import { clearPickemStandingsCache } from './hooks/usePickemStandings';

/**
 * Everything the app remembers about the signed-in session outside redux:
 * the service worker's offline API store (viewer-scoped rows such as
 * /api/league/:id with is_commissioner and invite_code, the roster, the
 * pick'em week view with unlocked picks) and the in-memory module caches.
 * Called on every session change (login, logout, registration, expiry) so a
 * different account on the same device is not served the previous one's rows.
 * The in-memory caches also refuse a response that was in flight when they
 * were cleared; the offline API store is best-effort for a request already on
 * the wire (a fresh session's token is not on it, and its 401 is never
 * cached).
 */
export function dropSessionCaches() {
  clearLeagueCache();
  clearPickemStandingsCache();
  if (typeof caches !== 'undefined') {
    caches.delete('api-cache-v1').catch(() => {});
  }
}
