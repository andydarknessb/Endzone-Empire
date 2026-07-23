import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Typography,
  Paper,
  Chip,
  Alert,
  Box,
  Skeleton,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { useLeague } from '../../hooks/useLeague';
import useFantasyMatchupGames from '../../hooks/useFantasyMatchupGames';
import { classifyPlays } from '../../lib/scoringEvents';
import { matchupWinProbability } from '../../lib/winProbability';
import TecmoCutscene from './TecmoCutscene';
import RetroScoreboard from './RetroScoreboard';
import RetroField from './RetroField';
import LiveGameStatus from '../LiveGameStatus/LiveGameStatus';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import {
  WinProbabilityBar,
  StickyScoreboard,
  SlotComparisonList,
  LiveTicker,
  BenchWhatIf,
  MatchupToasts,
} from './MatchupExtras';

const RETRO_DASH_MS = 1000;
const RETRO_MOMENT_MS = 1800;

const TICKER_LIMIT = 12;

function MatchupDetail() {
  const { leagueId, matchupId } = useParams();
  const { league } = useLeague(leagueId);
  const { realGameIds } = useFantasyMatchupGames(matchupId);
  const [matchup, setMatchup] = useState(null);
  const [home, setHome] = useState(null);
  const [away, setAway] = useState(null);
  const [viewerTeamId, setViewerTeamId] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [receivedLiveScore, setReceivedLiveScore] = useState(false);

  const [homeBenchLeft, setHomeBenchLeft] = useState(null);
  const [awayBenchLeft, setAwayBenchLeft] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [cutsceneQueue, setCutsceneQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [ticker, setTicker] = useState([]);
  const [viewMode, setViewMode] = useState('standard');
  const [retroActivePlay, setRetroActivePlay] = useState(null);

  const socketRef = useRef(null);
  const toastSeq = useRef(0);
  const cutsceneSeq = useRef(0);
  const retroDashTimeoutRef = useRef(null);
  // Refs so the socket handler always sees current lineups/prefs, not stale closures.
  const homeRef = useRef(null);
  const awayRef = useRef(null);
  const viewerTeamRef = useRef(null);
  const celebrationsRef = useRef(true);

  homeRef.current = home;
  awayRef.current = away;
  viewerTeamRef.current = viewerTeamId;

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      setReceivedLiveScore(false);
      const res = await apiClient.get(`/api/league/${leagueId}/matchups/${matchupId}`);
      setMatchup(res.data.matchup);
      setHome(res.data.home);
      setAway(res.data.away);
      setViewerTeamId(res.data.viewerTeamId || null);
      setWhatIf(res.data.viewerWhatIf || null);
      if (res.data.matchup?.final) {
        fetchBenchLeft(res.data.matchup, res.data.home, res.data.away);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  // Points left on the bench: only meaningful once a week is final. Per-team
  // from the hindsight endpoint; skipped silently on error (supplementary stat).
  const fetchBenchLeft = async (matchupData, homeData, awayData) => {
    const [homeResult, awayResult] = await Promise.allSettled([
      apiClient.get(
        `/api/team/hindsight?leagueId=${leagueId}&teamId=${homeData.teamId}&season=${matchupData.season}&week=${matchupData.week}`
      ),
      apiClient.get(
        `/api/team/hindsight?leagueId=${leagueId}&teamId=${awayData.teamId}&season=${matchupData.season}&week=${matchupData.week}`
      ),
    ]);
    setHomeBenchLeft(
      homeResult.status === 'fulfilled' && typeof homeResult.value.data?.pointsLeftOnBench === 'number'
        ? homeResult.value.data.pointsLeftOnBench
        : null
    );
    setAwayBenchLeft(
      awayResult.status === 'fulfilled' && typeof awayResult.value.data?.pointsLeftOnBench === 'number'
        ? awayResult.value.data.pointsLeftOnBench
        : null
    );
  };

  useEffect(() => {
    fetchData();
    // fetchData closes over both route identifiers listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, matchupId]);

  // Touchdown-celebration preference (opt-out: default on).
  useEffect(() => {
    apiClient
      .get('/api/notifications/prefs')
      .then((res) => {
        celebrationsRef.current = res.data?.touchdownCelebrations !== false;
      })
      .catch(() => { celebrationsRef.current = true; });
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToasts = useCallback((items) => {
    if (!items.length) return;
    setToasts((prev) => [
      ...prev,
      ...items.map((t) => ({ ...t, id: (toastSeq.current += 1) })),
    ]);
  }, []);

  useEffect(() => {
    const socket = createDraftSocket();
    socketRef.current = socket;

    const joinLeagueRoom = () => socket.emit('league:join', { leagueId: Number(leagueId) });
    joinLeagueRoom();
    // Missed play deltas never reach the client while disconnected, so a bare
    // room re-join can leave starter rows drifted from the authoritative total —
    // resync with a full refetch alongside it.
    const onSocketReconnect = () => {
      joinLeagueRoom();
      fetchData();
    };
    const offReconnect = onReconnect(socket, onSocketReconnect);

    socket.on('scores:updated', (data) => {
      const scored = (data.scored || []).find((s) => s.matchupId === Number(matchupId));
      if (scored) {
        setReceivedLiveScore(true);
        setMatchup((prev) =>
          prev ? { ...prev, home_score: scored.homeScore, away_score: scored.awayScore } : prev
        );
      }

      const plays = data.plays || [];
      if (plays.length) {
        const homeStarters = homeRef.current?.starters || [];
        const awayStarters = awayRef.current?.starters || [];
        const homeIds = new Set(homeStarters.map((p) => p.id));
        const awayIds = new Set(awayStarters.map((p) => p.id));

        // Optimistically bump the scoring players' displayed points by the
        // reported delta so rows track the live score without a full refetch.
        const deltaById = new Map();
        for (const p of plays) {
          deltaById.set(p.playerId, (deltaById.get(p.playerId) || 0) + (Number(p.pointsDelta) || 0));
        }
        const applyDeltas = (team) => {
          if (!team) return team;
          let touched = false;
          const starters = team.starters.map((s) => {
            const d = deltaById.get(s.id);
            if (!d) return s;
            touched = true;
            return { ...s, points: Math.round(((Number(s.points) || 0) + d) * 100) / 100 };
          });
          return touched ? { ...team, starters } : team;
        };
        setHome((prev) => applyDeltas(prev));
        setAway((prev) => applyDeltas(prev));

        const viewer = viewerTeamRef.current;
        const iAmHome = viewer && homeRef.current?.teamId === viewer;
        const myIds = viewer ? (iAmHome ? homeIds : awayIds) : new Set();
        const oppIds = viewer ? (iAmHome ? awayIds : homeIds) : new Set();

        // Cutscenes/toasts/ticker are touchdown-only, same as before this
        // session's non-TD "moment" plays (sack/FG/INT/fumble/punt return)
        // were added to the feed — those never reach this gate.
        const tdPlays = plays.filter((p) => p.isTouchdown !== false);

        const { cutscenes, summaryToast, toasts: oppToasts } = classifyPlays(tdPlays, {
          myStarterIds: myIds,
          oppStarterIds: oppIds,
          celebrationsEnabled: celebrationsRef.current,
        });
        if (cutscenes.length) {
          setCutsceneQueue((q) => [
            ...q,
            ...cutscenes.map((c) => ({ ...c, _cid: (cutsceneSeq.current += 1) })),
          ]);
        }
        const toastBatch = [...oppToasts];
        if (summaryToast) toastBatch.push(summaryToast);
        pushToasts(toastBatch);

        // Ticker: every TD by either team in this matchup, colored by side.
        const tickerAdds = tdPlays
          .filter((p) => homeIds.has(p.playerId) || awayIds.has(p.playerId))
          .map((p) => ({ ...p, side: homeIds.has(p.playerId) ? 'home' : 'away' }));
        if (tickerAdds.length) {
          setTicker((prev) => [...prev, ...tickerAdds].slice(-TICKER_LIMIT));
        }

        // Retro field animation: EVERY play type by either team in this
        // matchup, not just touchdowns — a touchdown gets the sprite dash,
        // anything else gets a quick flash banner (see RetroField).
        const retroAdds = plays.filter((p) => homeIds.has(p.playerId) || awayIds.has(p.playerId));
        if (retroAdds.length) {
          const latest = retroAdds[retroAdds.length - 1];
          const side = homeIds.has(latest.playerId) ? 'home' : 'away';
          if (retroDashTimeoutRef.current) clearTimeout(retroDashTimeoutRef.current);
          setRetroActivePlay({
            side,
            type: latest.type,
            isTouchdown: latest.isTouchdown !== false,
            nflTeam: latest.nflTeam,
            opponent: latest.opponent,
          });
          retroDashTimeoutRef.current = setTimeout(() => {
            setRetroActivePlay(null);
            retroDashTimeoutRef.current = null;
          }, latest.isTouchdown === false ? RETRO_MOMENT_MS : RETRO_DASH_MS);
        }
      }
    });

    return () => {
      offReconnect?.();
      socketRef.current?.disconnect();
      socketRef.current = null;
      if (retroDashTimeoutRef.current) {
        clearTimeout(retroDashTimeoutRef.current);
        retroDashTimeoutRef.current = null;
      }
    };
    // Socket lifecycle is route-bound; pushToasts is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, matchupId, pushToasts]);

  const dismissCutscene = useCallback(() => {
    setCutsceneQueue((q) => q.slice(1));
  }, []);

  const toggleRow = useCallback((id) => {
    setExpandedId((cur) => (cur === id ? null : id));
  }, []);

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={260} height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={80} sx={{ mb: 2, borderRadius: 1 }} />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid xs={6}>
            <Skeleton variant="text" width={140} height={32} />
            <Skeleton variant="text" width={80} height={40} />
          </Grid>
          <Grid xs={6}>
            <Skeleton variant="text" width={140} height={32} />
            <Skeleton variant="text" width={80} height={40} />
          </Grid>
        </Grid>
        <Skeleton variant="rectangular" height={320} sx={{ borderRadius: 1 }} />
      </Container>
    );
  }

  const homeScore = matchup ? Number(matchup.home_score) : 0;
  const awayScore = matchup ? Number(matchup.away_score) : 0;
  const winProb = matchupWinProbability({
    homeScore,
    awayScore,
    homeProjectedTotal: home?.projectedTotal || 0,
    awayProjectedTotal: away?.projectedTotal || 0,
  });
  const isCurrentSeason = Number(matchup?.season) === Number(league?.current_season);
  const isCurrentWeek = Number(matchup?.week) === Number(league?.current_week);
  const hasRecordedScore = homeScore !== 0 || awayScore !== 0;
  const showLive = !!matchup
    && !matchup.final
    && league?.draft_status === 'complete'
    && league?.season_status !== 'complete'
    && isCurrentSeason
    && isCurrentWeek
    && (receivedLiveScore || hasRecordedScore);
  const viewerTeam = viewerTeamId === home?.teamId
    ? home
    : viewerTeamId === away?.teamId
      ? away
      : null;
  const viewerHasRoster = !!viewerTeam
    && ((viewerTeam.starters || []).length > 0 || (viewerTeam.bench || []).length > 0);
  const currentCutscene = cutsceneQueue[0] || null;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {matchup && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h4">Week {matchup.week} Matchup</Typography>
              {matchup.is_playoff && <Chip label="Playoff" />}
              {matchup.final
                ? <Chip label="Final" color="success" />
                : showLive
                  ? <Chip label="LIVE" color="error" />
                  : <Chip label="Not started" variant="outlined" />}
            </Box>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={viewMode}
              onChange={(e, next) => next && setViewMode(next)}
              aria-label="Matchup view"
            >
              <ToggleButton value="standard">Standard</ToggleButton>
              <ToggleButton value="scoreboard">Scoreboard</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {showLive && realGameIds.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'nowrap',
                overflowX: 'auto',
                gap: 1,
                mb: 2,
                pb: 0.5,
              }}
            >
              {realGameIds.map((gameId) => (
                <Paper
                  key={gameId}
                  variant="outlined"
                  sx={{ px: 1.5, py: 0.75, borderRadius: 2, flexShrink: 0 }}
                >
                  <LiveGameStatus gameId={gameId} />
                </Paper>
              ))}
            </Box>
          )}

          {viewMode === 'scoreboard' ? (
            <>
              <RetroScoreboard
                leagueName={league?.name}
                homeName={matchup.home_team_name}
                awayName={matchup.away_team_name}
                homeScore={homeScore}
                awayScore={awayScore}
                isFinal={matchup.final}
                isLive={showLive}
              />
              <Box sx={{ mt: 2, mb: 2 }}>
                <RetroField
                  homeName={matchup.home_team_name}
                  awayName={matchup.away_team_name}
                  homeProb={winProb.home}
                  homeStarters={home?.starters}
                  awayStarters={away?.starters}
                  homeBench={home?.bench}
                  awayBench={away?.bench}
                  activePlay={retroActivePlay}
                />
              </Box>
              {showLive && <LiveTicker items={ticker} />}
              {showLive && (
                <BenchWhatIf
                  whatIf={whatIf}
                  hasRoster={viewerHasRoster}
                  open={whatIfOpen}
                  onToggle={() => setWhatIfOpen((o) => !o)}
                />
              )}
            </>
          ) : (
            <>
              <StickyScoreboard
                homeName={matchup.home_team_name}
                awayName={matchup.away_team_name}
                homeScore={homeScore}
                awayScore={awayScore}
                homeProb={winProb.home}
                final={matchup.final}
                isLive={showLive}
              />

              {showLive && (
                <WinProbabilityBar
                  homeName={matchup.home_team_name}
                  awayName={matchup.away_team_name}
                  homeProb={winProb.home}
                />
              )}

              {showLive && <LiveTicker items={ticker} />}

              {showLive && (
                <BenchWhatIf
                  whatIf={whatIf}
                  hasRoster={viewerHasRoster}
                  open={whatIfOpen}
                  onToggle={() => setWhatIfOpen((o) => !o)}
                />
              )}

              <Grid container spacing={2} sx={{ mb: 2 }}>
                {[{ team: home, name: matchup.home_team_name, score: homeScore, benchLeft: homeBenchLeft },
                  { team: away, name: matchup.away_team_name, score: awayScore, benchLeft: awayBenchLeft }].map((col, i) => (
                  <Grid xs={6} key={i}>
                    <Typography variant="h6" noWrap>{col.name}</Typography>
                    <Typography variant="stat" sx={{ mb: 0.5, fontSize: '1.125rem' }}>
                      {col.score}
                    </Typography>
                    {matchup.final && col.benchLeft != null && (
                      <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                        Left {col.benchLeft} on the bench
                      </Typography>
                    )}
                    {showLive && col.team?.projectedTotal != null && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                        Projected {Number(col.team.projectedTotal).toFixed(1)}
                      </Typography>
                    )}
                  </Grid>
                ))}
              </Grid>

              <Paper sx={{ p: 2 }}>
                <SlotComparisonList
                  homeStarters={home?.starters}
                  awayStarters={away?.starters}
                  expandedId={expandedId}
                  onToggle={toggleRow}
                  onOpenPlayer={setQuickViewId}
                />
              </Paper>
            </>
          )}
        </>
      )}

      <MatchupToasts toasts={toasts} onDismiss={dismissToast} />
      {currentCutscene && (
        <TecmoCutscene
          key={currentCutscene._cid}
          play={currentCutscene}
          onDone={dismissCutscene}
        />
      )}

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
      />
    </Container>
  );
}

export default MatchupDetail;
