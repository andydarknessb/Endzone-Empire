import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';
import { useStandings } from '../../../hooks/useStandings';
import { matchupWinProbability } from '../../../lib/winProbability';
import { useMatchup, matchupStatusView } from '../../../entities/matchup';
import { recordsFromStandings } from '../../../widgets/matchup-grid';
import { useCelebrateTouchdown } from '../../../features/celebrate-touchdown';
import { useMatchupView } from '../../../features/toggle-matchup-view';

/**
 * The Matchup page's data (ADR 0031, #903): everything the page composes its
 * widgets and features from, derived in one place so the page stays a
 * layout. It replaces the state the legacy Matchup Detail page kept inline.
 *
 *   - The league, through the shared league cache (useLeague / ADR 0004):
 *     its name for the breadcrumb and the LED board, its `roster_slots` keys
 *     in commissioner order as the `slotOrder` the entity pairs starters by
 *     (IDP slots included; pairing refuses without it, so both lineup views
 *     render nothing until the league row arrives), and its `best_ball` flag
 *     for the bench-left rule.
 *   - The Matchup as a read model (entities/matchup, ADR 0029) with the score
 *     feed and the Team identity feed composed inside the hook: `matchup`
 *     (the scoreboard, with the live NFL game rows on `.games`, #885),
 *     `detail` (the lineup payload beneath it: benches, the viewer's Team id,
 *     the what-if, `is_playoff`) and `starterRows`, the ONE paired row list
 *     both views render. A `scores:updated` event moves the model with no
 *     refetch; a reconnect refetches silently.
 *   - The status chip and the started state are the server's status fact
 *     (ADR 0030) read through the entity's one predicate, never a timer.
 *     `isLive` is the exact live status (not the started state) and gates
 *     the live-only surfaces: the NFL game strip, the last-plays ticker and
 *     the bench what-if.
 *   - The scoring standings, through the shared week-keyed cache
 *     (useStandings), for the record the scoreboard strip prints under a
 *     Team name: a Team's record does not join the Matchup wire (spec #890's
 *     ruling), so the page passes it down. Held until the league row is on
 *     hand so the cache key carries the current week from the first request.
 *   - The play-driven concerns, fed by the score feed's whole event through
 *     the hook's `onScores`: the touchdown celebrations (the
 *     celebrate-touchdown feature's `handlePlays`, with the two starter id
 *     sets read from the latest detail body through a ref so the handler
 *     stays stable and the feed never re-subscribes), the ticker of touchdown
 *     plays by either side for the Scoreboard view (newest first, capped),
 *     and the retro field's active play: EVERY play type by either side, a
 *     touchdown dashing the sprite and a moment play flashing the callout,
 *     cleared by a timer sized to the play.
 *   - Points left on the bench, per side from the hindsight endpoint
 *     (`GET /api/team/hindsight`), read only once the Matchup is final AND the
 *     league is known and not best ball: best ball sets no lineup, so nothing
 *     is ever left on a bench (ADR 0023), and until the league is known no
 *     read happens so a best-ball zero never flashes. A failed read is
 *     skipped silently (a supplementary stat).
 *   - The view (Standard or Scoreboard), remembered per viewer by the
 *     toggle-matchup-view feature under a key that names the viewer: the
 *     viewer's Team id from the detail body (the league read's as a
 *     fallback), else the signed-in user's id, so two managers on one browser
 *     never share the choice.
 */

const RETRO_DASH_MS = 1000;
const RETRO_MOMENT_MS = 1800;
const TICKER_LIMIT = 12;

/** The league's roster_slots keys in commissioner order, or an empty list. */
export function slotOrderFor(league) {
  return (Array.isArray(league?.roster_slots) ? league.roster_slots : [])
    .map((s) => (s && s.key != null ? String(s.key) : null))
    .filter(Boolean);
}

/**
 * The key the remembered view is stored under: the viewer's Team id first (a
 * manager is a Team in this league), else the user id (a viewer without a
 * Team here), else null (unknown: nothing is remembered).
 */
export function viewerKeyFor({ teamId, userId }) {
  if (teamId != null) return `team:${teamId}`;
  if (userId != null) return `user:${userId}`;
  return null;
}

export function useMatchupPage(leagueId, matchupId) {
  const { league, viewerTeamId: leagueViewerTeamId } = useLeague(leagueId);
  const userId = useSelector((state) => state.user?.id ?? null);
  const slotOrder = useMemo(() => slotOrderFor(league), [league]);

  const celebration = useCelebrateTouchdown();
  const { handlePlays } = celebration;

  const [ticker, setTicker] = useState([]);
  const [retroActivePlay, setRetroActivePlay] = useState(null);
  const [homeBenchLeft, setHomeBenchLeft] = useState(null);
  const [awayBenchLeft, setAwayBenchLeft] = useState(null);
  const retroTimeoutRef = useRef(null);
  // The latest detail body, so the play handler reads the current lineups and
  // viewer id without closing over them (and without re-subscribing the feed).
  const detailRef = useRef(null);

  const handleScores = useCallback((event) => {
    const plays = (event && event.plays) || [];
    if (!plays.length) return;

    const detailNow = detailRef.current;
    const viewerTeamId = detailNow?.viewerTeamId ?? null;
    const homeIds = new Set((detailNow?.home?.starters || []).map((p) => p.id));
    const awayIds = new Set((detailNow?.away?.starters || []).map((p) => p.id));
    const iAmHome = viewerTeamId != null && detailNow?.home?.teamId === viewerTeamId;
    const myStarterIds = viewerTeamId != null ? (iAmHome ? homeIds : awayIds) : new Set();
    const oppStarterIds = viewerTeamId != null ? (iAmHome ? awayIds : homeIds) : new Set();

    handlePlays(plays, { myStarterIds, oppStarterIds });

    // The ticker: every touchdown by either side of this Matchup, newest first.
    const tickerAdds = plays
      .filter((p) => p && p.isTouchdown !== false && (homeIds.has(p.playerId) || awayIds.has(p.playerId)))
      .map((p) => ({ ...p, side: homeIds.has(p.playerId) ? 'home' : 'away' }));
    if (tickerAdds.length) {
      setTicker((prev) => [...tickerAdds.reverse(), ...prev].slice(0, TICKER_LIMIT));
    }

    // The retro field: every play type by either side, the latest one wins.
    const retroAdds = plays.filter((p) => p && (homeIds.has(p.playerId) || awayIds.has(p.playerId)));
    if (retroAdds.length) {
      const latest = retroAdds[retroAdds.length - 1];
      const isTouchdown = latest.isTouchdown !== false;
      if (retroTimeoutRef.current) clearTimeout(retroTimeoutRef.current);
      setRetroActivePlay({
        side: homeIds.has(latest.playerId) ? 'home' : 'away',
        type: latest.type,
        isTouchdown,
        nflTeam: latest.nflTeam,
        opponent: latest.opponent,
      });
      retroTimeoutRef.current = setTimeout(() => {
        setRetroActivePlay(null);
        retroTimeoutRef.current = null;
      }, isTouchdown ? RETRO_DASH_MS : RETRO_MOMENT_MS);
    }
  }, [handlePlays]);

  const { matchup, detail, starterRows, loading, error } = useMatchup(leagueId, matchupId, {
    onScores: handleScores,
    slotOrder,
  });

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // Clear the retro timer on unmount so a late timeout never fires after the
  // page is gone.
  useEffect(() => () => {
    if (retroTimeoutRef.current) {
      clearTimeout(retroTimeoutRef.current);
      retroTimeoutRef.current = null;
    }
  }, []);

  // Points left on the bench: only once final, and only for a league that
  // sets a lineup (ADR 0023). Both gates are read here, so a best-ball league
  // or an unknown league issues no read at all.
  const benchLeftEligible = !!(detail?.matchup?.final && detail.home && detail.away && league && !league.best_ball);
  const benchLeftWeek = detail?.matchup?.week;
  const benchLeftSeason = detail?.matchup?.season;
  const homeTeamId = detail?.home?.teamId;
  const awayTeamId = detail?.away?.teamId;
  useEffect(() => {
    if (!benchLeftEligible) {
      setHomeBenchLeft(null);
      setAwayBenchLeft(null);
      return undefined;
    }
    let cancelled = false;
    const url = (teamId) =>
      `/api/team/hindsight?leagueId=${leagueId}&teamId=${teamId}&season=${benchLeftSeason}&week=${benchLeftWeek}`;
    const read = (result) =>
      (result.status === 'fulfilled' && typeof result.value?.data?.pointsLeftOnBench === 'number'
        ? result.value.data.pointsLeftOnBench
        : null);
    Promise.allSettled([apiClient.get(url(homeTeamId)), apiClient.get(url(awayTeamId))]).then(([home, away]) => {
      if (cancelled) return;
      setHomeBenchLeft(read(home));
      setAwayBenchLeft(read(away));
    });
    return () => { cancelled = true; };
  }, [benchLeftEligible, leagueId, homeTeamId, awayTeamId, benchLeftSeason, benchLeftWeek]);

  // Standings, held until the league row (and so its current week) is on
  // hand: useStandings keys its shared cache entry by that week.
  const standings = useStandings(league ? leagueId : null, league?.current_week);
  // A plain object keyed by Team id, the lookup shape the scoreboard strip reads.
  const records = useMemo(() => {
    const rows = Array.isArray(standings.data?.standings) ? standings.data.standings : [];
    return rows.length ? Object.fromEntries(recordsFromStandings(rows)) : null;
  }, [standings.data]);

  const viewerTeamId = detail?.viewerTeamId ?? leagueViewerTeamId ?? null;
  const viewerKey = viewerKeyFor({ teamId: viewerTeamId, userId });
  const [view, setView] = useMatchupView(viewerKey);

  const status = matchupStatusView(matchup?.status);
  const isLive = matchup?.status === 'live';
  const isFinal = !!matchup?.final;

  const homeProb = useMemo(() => {
    if (!matchup) return null;
    return matchupWinProbability({
      homeScore: matchup.home.score,
      awayScore: matchup.away.score,
      homeExpectedFinal: matchup.home.expectedFinal,
      awayExpectedFinal: matchup.away.expectedFinal,
    }).home;
  }, [matchup]);

  const viewerSide = viewerTeamId != null && detail
    ? (detail.home?.teamId === viewerTeamId ? detail.home : detail.away?.teamId === viewerTeamId ? detail.away : null)
    : null;
  const viewerHasRoster = !!viewerSide
    && ((viewerSide.starters || []).length > 0 || (viewerSide.bench || []).length > 0);

  return {
    league,
    leagueName: league?.name ?? null,
    viewerTeamId,
    matchup,
    detail,
    starterRows,
    loading,
    error,
    records,
    status,
    isLive,
    isFinal,
    isPlayoff: !!detail?.matchup?.is_playoff,
    homeProb,
    games: matchup?.games || [],
    benches: {
      home: detail?.home?.bench || [],
      away: detail?.away?.bench || [],
    },
    benchLeft: { home: homeBenchLeft, away: awayBenchLeft },
    // The line shows only for a final Matchup in a league that sets a lineup
    // (ADR 0023); it waits for the league so a best-ball zero never flashes.
    showBenchLeft: isFinal && !!league && !league.best_ball,
    whatIf: detail?.viewerWhatIf ?? null,
    viewerHasRoster,
    ticker,
    retroActivePlay,
    celebration,
    view,
    setView,
  };
}

export default useMatchupPage;
