import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Container,
  Paper,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Button,
  Alert,
  Box,
  Chip,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Skeleton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { matchupWinProbability } from '../../lib/winProbability';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

const LIVE_INDICATOR_MS = 10000;

/**
 * Picks the week the screen opens to: the league's current week when it's
 * one of the weeks we actually have matchups for, else the latest week that
 * still has an unfinished matchup (closest thing to "in progress"), else the
 * latest week that exists at all. 'All' only when there's nothing to pick.
 */
function computeDefaultWeek(league, matchups, weeks) {
  if (league?.current_week && weeks.includes(league.current_week)) {
    return league.current_week;
  }
  const nonFinalWeeks = matchups.filter((m) => !m.final).map((m) => m.week);
  if (nonFinalWeeks.length) {
    return Math.max(...nonFinalWeeks);
  }
  if (weeks.length) {
    return Math.max(...weeks);
  }
  return 'All';
}

function MatchupStatusChip({ matchup, showLive }) {
  if (matchup.final) {
    return <Chip size="small" label="Final" color="success" />;
  }
  if (showLive) {
    return <Chip size="small" label="LIVE" color="error" />;
  }
  return <Chip size="small" label="Scheduled" variant="outlined" />;
}

function MatchupScreen() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const notify = useSnackbar();
  const [matchups, setMatchups] = useState([]);
  const { league, loading: leagueLoading, error: leagueError } = useLeague(leagueId);
  const [rosters, setRosters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [weekFilter, setWeekFilter] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [season, setSeason] = useState('2025');
  const [week, setWeek] = useState('1');
  const [showLive, setShowLive] = useState(false);
  const socketRef = useRef(null);
  const liveTimeoutRef = useRef(null);
  const weekFilterInitialized = useRef(false);

  useEffect(() => {
    fetchData();
  }, [leagueId]);

  // Picks the default week once both the matchups fetch and the shared
  // league fetch have settled, whichever order they resolve in.
  useEffect(() => {
    if (weekFilterInitialized.current || loading || leagueLoading) return;
    weekFilterInitialized.current = true;
    setWeekFilter(computeDefaultWeek(league, matchups, weeks));
  }, [loading, leagueLoading, league, matchups, weeks]);

  useEffect(() => {
    // Socket lives for the lifetime of this view; a ref avoids stale closures
    // in the cleanup function below.
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    const joinLeagueRoom = () => {
      newSocket.emit('league:join', { leagueId: Number(leagueId) });
    };

    joinLeagueRoom();

    // Re-join on reconnect so the server re-adds us to the room — otherwise
    // a dropped connection would silently stop delivering scores:updated.
    const offReconnect = onReconnect(newSocket, joinLeagueRoom);

    newSocket.on('scores:updated', (data) => {
      setMatchups((prevMatchups) =>
        prevMatchups.map((m) => {
          const scored = data.scored.find((s) => s.matchupId === m.id);
          if (!scored) return m;
          return { ...m, home_score: scored.homeScore, away_score: scored.awayScore };
        })
      );

      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
      }
      setShowLive(true);
      liveTimeoutRef.current = setTimeout(() => {
        setShowLive(false);
        liveTimeoutRef.current = null;
      }, LIVE_INDICATOR_MS);
    });

    return () => {
      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
        liveTimeoutRef.current = null;
      }
      offReconnect?.(); // reconnect listener lives on the manager, which outlives the socket
      socketRef.current.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [matchupsRes, rostersRes] = await Promise.all([
        apiClient.get(`/api/league/${leagueId}/matchups`),
        // Best-effort: only needed to spot the viewer's own team for the hero
        // card, so a failure here shouldn't take down the rest of the screen.
        apiClient.get(`/api/league/${leagueId}/rosters`).catch(() => ({ data: [] })),
      ]);

      const matchupsData = matchupsRes.data;
      setMatchups(matchupsData);

      const uniqueWeeks = Array.from(
        new Set(matchupsData.map((m) => m.week))
      ).sort((a, b) => a - b);
      setWeeks(uniqueWeeks);

      setRosters(rostersRes.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMatchups = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/matchups`, {
        season: parseInt(season),
        week: parseInt(week),
      });
      notify('Matchups generated successfully!');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleScoreWeek = async () => {
    try {
      setError(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/score`, {
        season: parseInt(season),
        week: parseInt(week),
      });
      notify('Week scored successfully!');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const isOwner = user && league && user.id === league.owner_id;

  const viewerTeam = rosters.find((t) => t.ownerId === user?.id);
  const viewerTeamId = viewerTeam ? viewerTeam.teamId : null;

  const filteredMatchups =
    weekFilter === 'All' || weekFilter == null
      ? matchups
      : matchups.filter((m) => m.week === parseInt(weekFilter, 10));

  const heroMatchup = viewerTeamId
    ? filteredMatchups.find(
        (m) => m.home_team_id === viewerTeamId || m.away_team_id === viewerTeamId
      )
    : null;
  const restMatchups = heroMatchup
    ? filteredMatchups.filter((m) => m.id !== heroMatchup.id)
    : filteredMatchups;

  const heroHomeScore = heroMatchup ? Number(heroMatchup.home_score) : 0;
  const heroAwayScore = heroMatchup ? Number(heroMatchup.away_score) : 0;
  const heroHomeWins = heroHomeScore > heroAwayScore;
  const heroAwayWins = heroAwayScore > heroHomeScore;
  const heroIsLive = !!heroMatchup && !heroMatchup.final && showLive;
  const heroWinProb = heroMatchup
    ? matchupWinProbability({
        homeScore: heroHomeScore,
        awayScore: heroAwayScore,
        homeProjectedTotal: 0,
        awayProjectedTotal: 0,
      })
    : null;

  const weekIndex = weekFilter === 'All' || weekFilter == null ? -1 : weeks.indexOf(weekFilter);

  if (loading || leagueLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={280} height={48} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" width={150} height={56} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" height={180} sx={{ mb: 3, borderRadius: 1 }} />
        <Grid container spacing={2}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Grid xs={12} sm={6} md={4} key={i}>
              <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
            </Grid>
          ))}
        </Grid>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      {(error || leagueError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || leagueError}
        </Alert>
      )}

      <Typography variant="h4" sx={{ mb: 3 }}>
        Matchups {league && `— ${league.name}`}
      </Typography>

      <Box sx={{ mb: 3, display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <FormControl sx={{ minWidth: 150 }}>
          <InputLabel id="week-filter-label">Week</InputLabel>
          <Select
            labelId="week-filter-label"
            value={weekFilter ?? 'All'}
            label="Week"
            onChange={(e) => setWeekFilter(e.target.value)}
          >
            <MenuItem value="All">All</MenuItem>
            {weeks.map((w) => (
              <MenuItem key={w} value={w}>
                Week {w}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {weekFilter !== 'All' && weekFilter != null && (
          <>
            <IconButton
              aria-label="Previous week"
              onClick={() => setWeekFilter(weeks[weekIndex - 1])}
              disabled={weekIndex <= 0}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              aria-label="Next week"
              onClick={() => setWeekFilter(weeks[weekIndex + 1])}
              disabled={weekIndex < 0 || weekIndex >= weeks.length - 1}
            >
              <ChevronRightIcon />
            </IconButton>
          </>
        )}
      </Box>

      {heroMatchup && (
        <Card sx={{ mb: 3 }}>
          <CardActionArea component={Link} to={`/league/${leagueId}/matchups/${heroMatchup.id}`}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                  Your Matchup — Week {heroMatchup.week}
                </Typography>
                <MatchupStatusChip matchup={heroMatchup} showLive={showLive} />
              </Box>
              <Grid container spacing={2} alignItems="center">
                <Grid xs={5}>
                  <Typography variant="h6" sx={{ fontWeight: heroHomeWins ? 700 : 400 }} noWrap>
                    {heroMatchup.home_team_name}
                  </Typography>
                  <Typography
                    variant="stat"
                    sx={{ fontSize: '1.25rem', fontWeight: heroHomeWins ? 700 : 400, mt: 0.5 }}
                  >
                    {heroHomeScore}
                  </Typography>
                </Grid>
                <Grid xs={2} sx={{ textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    vs
                  </Typography>
                </Grid>
                <Grid xs={5} sx={{ textAlign: 'right' }}>
                  <Typography variant="h6" sx={{ fontWeight: heroAwayWins ? 700 : 400 }} noWrap>
                    {heroMatchup.away_team_name}
                  </Typography>
                  <Typography
                    variant="stat"
                    sx={{ fontSize: '1.25rem', fontWeight: heroAwayWins ? 700 : 400, mt: 0.5 }}
                  >
                    {heroAwayScore}
                  </Typography>
                </Grid>
              </Grid>
              {heroIsLive && (
                <Box
                  role="img"
                  aria-label={`Win probability: ${heroMatchup.home_team_name} ${Math.round(heroWinProb.home * 100)}%, ${heroMatchup.away_team_name} ${Math.round(heroWinProb.away * 100)}%`}
                  sx={{
                    display: 'flex',
                    height: 4,
                    borderRadius: 2,
                    overflow: 'hidden',
                    mt: 2,
                    bgcolor: 'action.hover',
                  }}
                >
                  <Box sx={{ width: `${heroWinProb.home * 100}%`, bgcolor: 'primary.main', transition: 'width 0.8s ease' }} />
                  <Box sx={{ width: `${heroWinProb.away * 100}%`, bgcolor: 'secondary.main', transition: 'width 0.8s ease' }} />
                </Box>
              )}
            </CardContent>
          </CardActionArea>
        </Card>
      )}

      <Grid container spacing={2} sx={{ mb: 4 }}>
        {restMatchups.map((matchup) => {
          // pg returns DECIMAL columns as strings — compare numerically
          const homeScore = Number(matchup.home_score);
          const awayScore = Number(matchup.away_score);
          const homeWins = homeScore > awayScore;
          const awayWins = awayScore > homeScore;

          return (
            <Grid xs={12} sm={6} md={4} key={matchup.id}>
              <Card>
                <CardActionArea component={Link} to={`/league/${leagueId}/matchups/${matchup.id}`}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        Week {matchup.week}
                      </Typography>
                      <MatchupStatusChip matchup={matchup} showLive={showLive} />
                    </Box>
                    <Box sx={{ mt: 1 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: homeWins ? 'bold' : 'normal' }}
                      >
                        {matchup.home_team_name} ({homeScore})
                      </Typography>
                      <Typography variant="body2" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                        vs
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: awayWins ? 'bold' : 'normal' }}
                      >
                        {matchup.away_team_name} ({awayScore})
                      </Typography>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {isOwner && (
        <Paper sx={{ p: 3, bgcolor: 'action.hover' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Owner Tools
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <TextField
              label="Season"
              type="number"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              size="small"
              sx={{ width: 100 }}
            />
            <TextField
              label="Week"
              type="number"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              size="small"
              sx={{ width: 100 }}
            />
            <Button variant="contained" color="primary" onClick={handleGenerateMatchups}>
              Generate Matchups
            </Button>
            <Button variant="contained" color="primary" onClick={handleScoreWeek}>
              Score Week
            </Button>
          </Box>
        </Paper>
      )}
    </Container>
  );
}

export default MatchupScreen;
