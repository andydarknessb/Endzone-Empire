import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { useLeague } from '../../hooks/useLeague';
import { useMatchup, matchupStatusView } from '../../entities/matchup';
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

/** Players remaining as the model reports it (integer or null): the count, or a dash. */
function playersRemainingLabel(value) {
  return value != null && Number.isFinite(Number(value)) ? String(Number(value)) : '-';
}

function MatchupDetail() {
  const { leagueId, matchupId } = useParams();
  const { league } = useLeague(leagueId);
  // League roster_slots keys in commissioner order, so the two lineup views
  // pair rows by slot in the order the league defines them (IDP slots included).
  const slotOrder = useMemo(
    () => (Array.isArray(league?.roster_slots) ? league.roster_slots : [])
      .map((s) => (s && s.key != null ? String(s.key) : null))
      .filter(Boolean),
    [league]
  );
  const { realGameIds } = useFantasyMatchupGames(matchupId);

  // The lineups (starters/bench per side) and the viewer's Team id live on the
  // hook's `detail` now: the model (entities/matchup) is the scoreboard, the
  // hook's `starterRows` are the paired starters with their optimistic bumps, and
  // `detail` carries the raw lineups this page still reads for bench arrays, id
  // sets and the viewer roster check - all of which the score feed never mutates,
  // so there is no second lineup copy to keep here.
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

  const toastSeq = useRef(0);
  const cutsceneSeq = useRef(0);
  const retroDashTimeoutRef = useRef(null);
  // Touchdown-celebration preference (opt-out: default on). A ref, not state:
  // it configures the play handler without driving a re-render on load.
  const celebrationsRef = useRef(true);
  // The latest detail body, so the async play handler reads the current lineups
  // and viewer id without closing over them (and without re-subscribing the feed
  // when they change). Updated in an effect below from the hook's `detail`.
  const detailRef = useRef(null);

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

  // Matchup Detail keeps its own play-driven concerns - cutscenes, toasts, the
  // ticker and the retro field - fed by the score feed's whole event through the
  // hook's `onScores`. The scores, Expected final, Players remaining and status
  // all move on the model inside the hook (applyScoreEvent), and the optimistic
  // per-starter point bumps now live in the hook too (on the paired rows it
  // exposes), so this handler never touches any of them - it reads the lineups
  // only to route plays to the right side. It reads them from `detailRef` (the
  // latest detail body) rather than closing over state, so it stays stable and
  // the hook, which reads this callback through its own `onScoresRef`, never
  // re-subscribes the feed.
  const handleScores = useCallback((event) => {
    const plays = (event && event.plays) || [];
    if (!plays.length) return;

    const detailNow = detailRef.current;
    const viewerTeamId = detailNow?.viewerTeamId ?? null;
    const homeStarters = detailNow?.home?.starters || [];
    const awayStarters = detailNow?.away?.starters || [];
    const homeIds = new Set(homeStarters.map((p) => p.id));
    const awayIds = new Set(awayStarters.map((p) => p.id));

    const iAmHome = viewerTeamId && detailNow?.home?.teamId === viewerTeamId;
    const myIds = viewerTeamId ? (iAmHome ? homeIds : awayIds) : new Set();
    const oppIds = viewerTeamId ? (iAmHome ? awayIds : homeIds) : new Set();

    // Cutscenes/toasts/ticker are touchdown-only; non-TD "moment" plays
    // (sack/FG/INT/fumble/punt return) never reach this gate.
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

    // Retro field animation: EVERY play type by either team in this matchup,
    // not just touchdowns - a touchdown gets the sprite dash, anything else a
    // quick flash banner (see RetroField).
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
  }, [pushToasts]);

  // The Matchup as a read model (entities/matchup), with the score feed and the
  // Team identity feed composed over the pure module inside the hook. The whole
  // score event is handed to `handleScores` for the play-driven concerns above.
  const { matchup: model, detail, starterRows, loading, error } = useMatchup(leagueId, matchupId, {
    onScores: handleScores,
    slotOrder,
  });

  const whatIf = detail?.viewerWhatIf ?? null;

  // Keep the play handler's view of the lineups current: it reads `detailRef`
  // rather than closing over `detail`, so it never re-subscribes the feed when a
  // resync replaces the body.
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // Touchdown-celebration preference (opt-out: default on).
  useEffect(() => {
    apiClient
      .get('/api/notifications/prefs')
      .then((res) => {
        celebrationsRef.current = res.data?.touchdownCelebrations !== false;
      })
      .catch(() => { celebrationsRef.current = true; });
  }, []);

  // Points left on the bench: only meaningful once a week is final. Per-team
  // from the hindsight endpoint; skipped silently on error (supplementary stat).
  const fetchBenchLeft = useCallback(async (matchupData, homeData, awayData) => {
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
  }, [leagueId]);

  useEffect(() => {
    if (detail?.matchup?.final && detail.home && detail.away) {
      fetchBenchLeft(detail.matchup, detail.home, detail.away);
    } else {
      setHomeBenchLeft(null);
      setAwayBenchLeft(null);
    }
  }, [detail, fetchBenchLeft]);

  // Clear the retro dash timer on unmount so a late timeout never fires after
  // the page is gone.
  useEffect(() => () => {
    if (retroDashTimeoutRef.current) {
      clearTimeout(retroDashTimeoutRef.current);
      retroDashTimeoutRef.current = null;
    }
  }, []);

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

  const homeScore = model ? Number(model.home.score) : 0;
  const awayScore = model ? Number(model.away.score) : 0;
  const winProb = matchupWinProbability({
    homeScore,
    awayScore,
    homeExpectedFinal: model?.home.expectedFinal,
    awayExpectedFinal: model?.away.expectedFinal,
  });

  // The status chip and the started state are the server's status fact (ADR
  // 0030), read through the entity's one predicate - never inferred from a
  // score-arrived timer or a five-conjunct liveness rule. `chipLabel` drives
  // both the header chip and the scoreboard chips (identical, so they never
  // disagree), and is null for a status the server could not compute (no chip,
  // never a guessed "Scheduled"/"Not started"). `hasStarted` gates the win
  // probability: true once started (live/played/final), false before kickoff,
  // and null (unknown) asserts neither - exactly as Game Center reads it.
  // The chip's whole presentation - label, colour and variant - comes from the
  // one status predicate (G7), so a fifth status is defined once in the entity
  // rather than in a ternary duplicated here and in Game Center.
  const { chipLabel, color: chipColor, variant: chipVariant, hasStarted } = matchupStatusView(model?.status);
  const isFinal = !!model?.final;
  // `isLive` is the exact live status, deliberately NOT the started state: it
  // gates the live-broadcast surfaces (the real-game strip, the live scoring
  // ticker, the live bench what-if), which show only while a matchup is
  // actually live and never for a played or final one.
  const isLive = model?.status === 'live';

  const homeName = model?.home.name;
  const awayName = model?.away.name;

  // Best ball sets no lineup, so nothing is ever left on the bench and the line
  // is hidden rather than printed as a zero (ADR 0023). Until the league is
  // known the line stays hidden too, so a best-ball zero never flashes.
  const showBenchLeft = !!league && !league.best_ball;
  const viewerTeamId = detail?.viewerTeamId ?? null;
  const viewerTeam = viewerTeamId === detail?.home?.teamId
    ? detail?.home
    : viewerTeamId === detail?.away?.teamId
      ? detail?.away
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

      {model && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h4">Week {model.week} Matchup</Typography>
              {detail?.matchup?.is_playoff && <Chip label="Playoff" />}
              {chipLabel && (
                <Chip
                  data-testid="matchup-status-chip"
                  size="small"
                  label={chipLabel}
                  color={chipColor}
                  variant={chipVariant}
                />
              )}
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

          {isLive && realGameIds.length > 0 && (
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
                homeName={homeName}
                awayName={awayName}
                homeScore={homeScore}
                awayScore={awayScore}
                chipLabel={chipLabel}
              />
              <Box sx={{ mt: 2, mb: 2 }}>
                <RetroField
                  homeName={homeName}
                  awayName={awayName}
                  homeProb={winProb.home}
                  starterRows={starterRows}
                  homeBench={detail?.home?.bench}
                  awayBench={detail?.away?.bench}
                  activePlay={retroActivePlay}
                />
              </Box>
              {isLive && <LiveTicker items={ticker} />}
              {isLive && (
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
                homeName={homeName}
                awayName={awayName}
                homeScore={homeScore}
                awayScore={awayScore}
                homeProb={winProb.home}
                chipLabel={chipLabel}
                chipColor={chipColor}
                chipVariant={chipVariant}
                started={hasStarted}
              />

              {hasStarted === true && (
                <WinProbabilityBar
                  homeName={homeName}
                  awayName={awayName}
                  homeProb={winProb.home}
                  isLive={isLive}
                />
              )}

              {isLive && <LiveTicker items={ticker} />}

              {isLive && (
                <BenchWhatIf
                  whatIf={whatIf}
                  hasRoster={viewerHasRoster}
                  open={whatIfOpen}
                  onToggle={() => setWhatIfOpen((o) => !o)}
                />
              )}

              <Grid container spacing={2} sx={{ mb: 2 }}>
                {[{ side: model.home, name: homeName, score: homeScore, benchLeft: homeBenchLeft },
                  { side: model.away, name: awayName, score: awayScore, benchLeft: awayBenchLeft }].map((col, i) => (
                  <Grid xs={6} key={i}>
                    <Typography variant="h6" noWrap>{col.name}</Typography>
                    <Typography variant="stat" sx={{ mb: 0.5, fontSize: '1.125rem' }}>
                      {col.score}
                    </Typography>
                    {isFinal && showBenchLeft && col.benchLeft != null && (
                      <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                        Left {col.benchLeft} on the bench
                      </Typography>
                    )}
                    {/* Projection is hidden once final (a settled game has a
                        score, not a forecast), exactly as Game Center does. */}
                    {!isFinal && col.side.expectedFinal != null && (
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        Projected {Number(col.side.expectedFinal).toFixed(1)}
                      </Typography>
                    )}
                    {/* Players remaining is shown throughout, final included (it
                        is a real 0 there), so the two surfaces this ticket
                        unifies agree - Game Center gates the projection, not this. */}
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                      Players remaining {playersRemainingLabel(col.side.playersRemaining)}
                    </Typography>
                  </Grid>
                ))}
              </Grid>

              <Paper sx={{ p: 2 }}>
                <SlotComparisonList
                  rows={starterRows}
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
