import { invalidate } from '../lib/resourceCache';
import { useResource } from './useResource';

// Scoring standings move only when a week's scores are synced or the week
// advances, and two widgets on the League Dashboard read them on one navigation
// (my-team-summary's record/rank line and the standings-table card), so a short
// TTL turns that pair of mounts into one request.
const TTL_MS = 30000;

// Keyed by league and current week. The endpoint takes NO week param and is
// SEASON-scoped, not week-scoped: getStandings recomputes from every finalised
// matchup of the league's current season on each request (its matchups query is
// `WHERE league_id = $1 AND season = leagues.current_season`, no week predicate,
// season.service.js), and current_week is only echoed back on the response's
// league row. So the URL is identical week to week while the standings genuinely
// change as more matchups finalise. The week lives in the KEY, not the URL:
// that is what makes a week advance a new cache entry and an immediate re-read
// rather than a wait on the TTL serving the stale prior-week table. (Drop the
// week from the key and that stale table comes back; the week is not in the URL
// to make it safe to drop.)
// A null week keys without it (the shorter key a prefix clear still covers),
// so a preseason league with no current week still reads once.
const keyFor = (leagueId, week) =>
  week == null ? ['standings', leagueId] : ['standings', leagueId, week];

const urlFor = (leagueId) => `/api/scoring/league/${leagueId}/standings`;

/**
 * Drops cached scoring standings for one league (every week), or everything
 * when called with no id. NOTHING wires this yet: it is here for the caller that
 * should reflect a standings change immediately rather than waiting out the TTL
 * (reloading the table already on screen) - a score sync or a week advance.
 * #644 (advance-week) is the natural first caller; until something calls it, a
 * change is only picked up when the TTL lapses.
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
 *
 * PRECONDITION of the dedupe: the week is the CALLER'S to supply, and keyFor
 * uses whatever week is passed. A consumer that mounts BEFORE its league has
 * resolved passes an undefined week, keys ['standings', id], then re-keys to
 * ['standings', id, week] when the league lands - two GETs, not one. The
 * dashboard reads a single GET only because LeagueDashboardPage gates its whole
 * body on `!league && loading`, so no widget mounts until the league (and its
 * current_week) is on hand; AC4's 1 -> 2 count holds because of that gate, in a
 * different file. A future consumer that mounts OUTSIDE such a gate will double
 * the read with nothing failing (its undefined -> week re-key is the same key
 * change AC4 exercises for 3 -> 4). Passing a week that is settled at mount time
 * is the contract. (Having this hook read useLeague internally would remove the
 * precondition by making the week not the caller's to get right; that changes
 * the signature and both current call sites, so it is a deliberate follow-up,
 * not bolted on here.)
 */
export function useStandings(leagueId, week) {
  const key = leagueId != null ? keyFor(leagueId, week) : null;
  return useResource(key, urlFor(leagueId), { ttl: TTL_MS });
}

export default useStandings;
