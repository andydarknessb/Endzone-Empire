import { useEndpoint } from '../../../shared/lib';

/**
 * The league's blanket waiver clear time (`league.waivers_clear_at`), read from the same `GET /api/waivers`
 * the Waivers page reads (`entities/waiver-claim`'s `useWaiverClaims`), or null while it loads, when the read
 * fails, or when the league has none (the server NULLs a spent one). A null `leagueId` binds no URL, so a
 * caller that does not ask makes no read. The bye-cluster naming line is the only consumer: it mounts this
 * only when the card renders a line (spec #2347 ruling 4).
 */
export function useWaiversClearAt(leagueId) {
  const { status, data } = useEndpoint(leagueId != null ? `/api/waivers?leagueId=${leagueId}` : null);
  return status === 'ready' ? data?.league?.waivers_clear_at ?? null : null;
}

export default useWaiversClearAt;
