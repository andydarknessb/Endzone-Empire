import { invalidate } from '../lib/resourceCache';
import { useResource } from './useResource';

// Scoring standings move only when a week's scores are synced or the week
// advances, and two widgets on the League Dashboard read them on one navigation
// (my-team-summary's record/rank line and the standings-table card), so a short
// TTL turns that pair of mounts into one request.
const TTL_MS = 30000;

// Keyed by league and current week. The endpoint takes NO week param: it always
// computes from the league's own current week, so two weeks share one URL and
// would otherwise share one cache entry. Folding the week into the key is what
// makes a week advance a new entry and a fresh read (the standings genuinely
// differ once another week is final), rather than the stale prior-week table.
// A null week keys without it (the shorter key a prefix clear still covers),
// so a preseason league with no current week still reads once.
const keyFor = (leagueId, week) =>
  week == null ? ['standings', leagueId] : ['standings', leagueId, week];

const urlFor = (leagueId) => `/api/scoring/league/${leagueId}/standings`;

/**
 * Drops cached scoring standings for one league (every week), or everything
 * when called with no id. A score sync or week advance that a mounted table
 * should reflect immediately calls this, reloading what is on screen instead of
 * waiting out the TTL.
 */
export function clearStandingsCache(leagueId) {
  invalidate(leagueId == null ? ['standings'] : ['standings', leagueId]);
}

/**
 * Shared GET /api/scoring/league/:id/standings, keyed by current week (ADR
 * 0004). `/api/scoring/league/:id/standings` is on the service-worker allowlist
 * and, since #641, is read by more than one mount per dashboard navigation, so
 * it is admitted to the shared cache: both readers dedupe onto one request, and
 * the table for a league or week the hook has moved away from never lands as the
 * current one. A null leagueId never fetches.
 */
export function useStandings(leagueId, week) {
  const key = leagueId != null ? keyFor(leagueId, week) : null;
  return useResource(key, urlFor(leagueId), { ttl: TTL_MS });
}

export default useStandings;
