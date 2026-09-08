import { useStandings } from '../../../hooks/useStandings';
import { standingsFromResponse } from './standingsModel';

/**
 * The league's standings, read once and modelled once: the three surfaces that
 * show a Team's Record read it through here rather than each reshaping the wire
 * rows themselves (#959).
 *
 * The WEEK IS PASSED IN, never reached for. It lives on the raw League row, and
 * a League entity slice is not approved (#942 ruling R4), so this hook takes the
 * caller's week exactly as the transport below it does. The week is the cache
 * key, not a URL parameter, so two callers on one page that pass the same
 * settled week dedupe onto one request while a week advance re-keys both to a
 * fresh read (see the useStandings docblock for that precondition: a caller that
 * mounts before its league has resolved passes an undefined week and reads
 * twice).
 *
 * Returns:
 *   status       'loading' | 'error' | 'ready' - the spine both dashboard cards
 *                drive their skeletons and their compact error from.
 *   rows         Team standings in the server's order (standingsModel).
 *   playoffTeams the league's bracket size, or null when it sends none.
 */
export function useLeagueStandings(leagueId, week) {
  const standings = useStandings(leagueId, week);
  const status = standings.loading ? 'loading' : standings.error ? 'error' : 'ready';
  const { rows, playoffTeams } = standingsFromResponse(standings.data);
  return { status, rows, playoffTeams };
}

export default useLeagueStandings;
