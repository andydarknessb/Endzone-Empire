import { invalidate, setResource } from '../lib/resourceCache';
import { useResource } from './useResource';

// The Pick'em page and the rules view both read the same settings row on the
// same visit, and it changes only when the commissioner saves it.
const TTL_MS = 60000;

const keyFor = (leagueId) => ['pickem-settings', leagueId];
const urlFor = (leagueId) => `/api/pickem/league/${leagueId}/settings`;

/**
 * Write-through for the row a successful PUT returns, so the screens showing
 * the settings update without a follow-up request.
 */
export function setPickemSettings(leagueId, settings) {
  if (leagueId == null || !settings) return;
  setResource(keyFor(leagueId), settings);
}

/** Drops cached settings for one league, or every league when called with no id. */
export function clearPickemSettingsCache(leagueId) {
  invalidate(leagueId == null ? ['pickem-settings'] : keyFor(leagueId));
}

/** Shared GET /api/pickem/league/:id/settings. */
export function usePickemSettings(leagueId) {
  const key = leagueId != null ? keyFor(leagueId) : null;
  const { data, loading, error, refetch } = useResource(key, urlFor(leagueId), { ttl: TTL_MS });
  return { settings: data ?? null, loading, error, refetch };
}
