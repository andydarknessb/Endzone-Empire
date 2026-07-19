import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Button,
  Typography,
  Chip,
  Alert,
  Box,
  Skeleton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import apiClient from '../../api/apiClient';
import { classifyPlays } from '../../lib/scoringEvents';
import { matchupWinProbability } from '../../lib/winProbability';
import TecmoCutscene from '../MatchupDetail/TecmoCutscene';
import {
  WinProbabilityBar,
  StickyScoreboard,
  LiveTicker,
  MatchupToasts,
} from '../MatchupDetail/MatchupExtras';

const TICKER_LIMIT = 12;

/**
 * Focused single-matchup live view opened from a Game Center scoreboard
 * card: sticky score, win probability, a scoring ticker, and Tecmo
 * touchdown cutscenes. Deliberately doesn't show lineups/slot comparisons —
 * that stays on the full MatchupDetail page, linked from the footer.
 *
 * Score ticks arrive via the `lastScoreEvent` prop rather than an own socket
 * connection — Game Center already holds the one socket for the page, and
 * every open modal would otherwise duplicate that connection for the exact
 * same broadcast. A tick that lands in the gap between opening the modal and
 * its fetch resolving is simply missed (no backfill) — the same limitation
 * MatchupDetail already has for events before its own socket subscribes.
 */
function MatchupLiveModal({ leagueId, matchupId, celebrationsEnabled, lastScoreEvent, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [matchup, setMatchup] = useState(null);
  const [home, setHome] = useState(null);
  const [away, setAway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [cutsceneQueue, setCutsceneQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [ticker, setTicker] = useState([]);

  const toastSeq = useRef(0);
  const cutsceneSeq = useRef(0);
  // Refs so the score-event effect always sees the latest lineups without
  // having to add them to its dependency array (which would re-run it on
  // every optimistic point update).
  const homeRef = useRef(null);
  const awayRef = useRef(null);
  const viewerTeamIdRef = useRef(null);
  homeRef.current = home;
  awayRef.current = away;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/league/${leagueId}/matchups/${matchupId}`)
      .then((res) => {
        if (cancelled) return;
        setMatchup(res.data.matchup);
        setHome(res.data.home);
        setAway(res.data.away);
        viewerTeamIdRef.current = res.data.viewerTeamId || null;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId, matchupId]);

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

  const dismissCutscene = useCallback(() => {
    setCutsceneQueue((q) => q.slice(1));
  }, []);

  // A new object identity from the parent every tick, so this effect just
  // re-runs on `[lastScoreEvent]` without needing to diff a sequence number.
  useEffect(() => {
    if (!lastScoreEvent) return;
    const data = lastScoreEvent.data;

    const scored = (data.scored || []).find((s) => s.matchupId === Number(matchupId));
    if (scored) {
      setMatchup((prev) =>
        prev ? { ...prev, home_score: scored.homeScore, away_score: scored.awayScore } : prev
      );
    }

    const plays = data.plays || [];
    if (!plays.length) return;

    const homeStarters = homeRef.current?.starters || [];
    const awayStarters = awayRef.current?.starters || [];
    const homeIds = new Set(homeStarters.map((p) => p.id));
    const awayIds = new Set(awayStarters.map((p) => p.id));

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

    const viewer = viewerTeamIdRef.current;
    const iAmHome = viewer && homeRef.current?.teamId === viewer;
    const myIds = viewer ? (iAmHome ? homeIds : awayIds) : new Set();
    const oppIds = viewer ? (iAmHome ? awayIds : homeIds) : new Set();

    const { cutscenes, summaryToast, toasts: oppToasts } = classifyPlays(plays, {
      myStarterIds: myIds,
      oppStarterIds: oppIds,
      celebrationsEnabled,
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
    const tickerAdds = plays
      .filter((p) => homeIds.has(p.playerId) || awayIds.has(p.playerId))
      .map((p) => ({ ...p, side: homeIds.has(p.playerId) ? 'home' : 'away' }));
    if (tickerAdds.length) {
      setTicker((prev) => [...prev, ...tickerAdds].slice(-TICKER_LIMIT));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastScoreEvent]);

  const homeScore = matchup ? Number(matchup.home_score) : 0;
  const awayScore = matchup ? Number(matchup.away_score) : 0;
  const winProb = matchup
    ? matchupWinProbability({
        homeScore,
        awayScore,
        homeProjectedTotal: home?.projectedTotal || 0,
        awayProjectedTotal: away?.projectedTotal || 0,
      })
    : null;
  const currentCutscene = cutsceneQueue[0] || null;

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6">
            {matchup ? `Week ${matchup.week} Matchup` : 'Matchup'}
          </Typography>
          {matchup?.is_playoff && <Chip label="Playoff" size="small" />}
        </Box>
        <IconButton aria-label="Close" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <>
            <Skeleton variant="rectangular" height={64} sx={{ mb: 2, borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1 }} />
          </>
        )}
        {!loading && error && <Alert severity="error">{error}</Alert>}
        {!loading && !error && matchup && (
          <>
            <StickyScoreboard
              homeName={matchup.home_team_name}
              awayName={matchup.away_team_name}
              homeScore={homeScore}
              awayScore={awayScore}
              homeProb={winProb.home}
              final={matchup.final}
            />
            {!matchup.final && (
              <WinProbabilityBar
                homeName={matchup.home_team_name}
                awayName={matchup.away_team_name}
                homeProb={winProb.home}
              />
            )}
            <LiveTicker items={ticker} />
            <MatchupToasts toasts={toasts} onDismiss={dismissToast} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button component={Link} to={`/league/${leagueId}/matchups/${matchupId}`}>
          View full box score
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
      {currentCutscene && (
        <TecmoCutscene
          key={currentCutscene._cid}
          play={currentCutscene}
          onDone={dismissCutscene}
        />
      )}
    </Dialog>
  );
}

MatchupLiveModal.propTypes = {
  leagueId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  matchupId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  celebrationsEnabled: PropTypes.bool,
  lastScoreEvent: PropTypes.shape({
    seq: PropTypes.number,
    data: PropTypes.object,
  }),
  onClose: PropTypes.func.isRequired,
};

export default MatchupLiveModal;
