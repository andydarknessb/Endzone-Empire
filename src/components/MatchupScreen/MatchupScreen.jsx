import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Container,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Button,
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Skeleton,
  Stack,
  Chip,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { matchupWinProbability } from '../../lib/winProbability';
import { computeDefaultWeek } from '../../lib/matchupWeek';
import { MatchupStatusChip, RosterPreviewGrid } from '../MatchupDetail/MatchupExtras';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

const LIVE_INDICATOR_MS = 10000;

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
  const [selectedMatchupId, setSelectedMatchupId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
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

  // The featured card defaults to the viewer's own matchup, but the "Other
  // Matchups" chips below can swap it to preview any other game this week.
  const selectedMatchup = heroMatchup
    ? filteredMatchups.find((m) => m.id === selectedMatchupId) || heroMatchup
    : null;
  const isViewerMatchup = !!(selectedMatchup && heroMatchup && selectedMatchup.id === heroMatchup.id);
  const navMatchups = heroMatchup
    ? filteredMatchups.filter((m) => m.id !== selectedMatchup.id)
    : [];

  // Real slot-by-slot roster data for whichever matchup is featured, reusing
  // the same endpoint the full matchup detail page relies on.
  useEffect(() => {
    if (!selectedMatchup) {
      setSelectedDetail(null);
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiClient
      .get(`/api/league/${leagueId}/matchups/${selectedMatchup.id}`)
      .then((res) => {
        if (!cancelled) setSelectedDetail(res.data);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMatchup?.id, leagueId]);

  const heroHomeScore = selectedMatchup ? Number(selectedMatchup.home_score) : 0;
  const heroAwayScore = selectedMatchup ? Number(selectedMatchup.away_score) : 0;
  const heroHomeWins = heroHomeScore > heroAwayScore;
  const heroAwayWins = heroAwayScore > heroHomeScore;
  const heroWinProb = selectedMatchup
    ? matchupWinProbability({
        homeScore: heroHomeScore,
        awayScore: heroAwayScore,
        homeProjectedTotal: selectedDetail?.home?.projectedTotal || 0,
        awayProjectedTotal: selectedDetail?.away?.projectedTotal || 0,
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

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
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
          <Stack direction="row" alignItems="center">
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
          </Stack>
        )}
      </Stack>

      {navMatchups.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
            Other Matchups
          </Typography>
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
            {navMatchups.map((m) => (
              <Chip
                key={m.id}
                clickable
                variant="outlined"
                label={`${m.home_team_name} vs ${m.away_team_name}`}
                onClick={() => setSelectedMatchupId(m.id)}
                sx={{ flexShrink: 0 }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {selectedMatchup && (
        <Card sx={{ mb: 3, bgcolor: 'background.paper' }}>
          <CardActionArea component={Link} to={`/league/${leagueId}/matchups/${selectedMatchup.id}`}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                  {isViewerMatchup ? 'Your Matchup' : 'Featured Matchup'} — Week {selectedMatchup.week}
                </Typography>
                <MatchupStatusChip matchup={selectedMatchup} showLive={showLive} />
              </Box>
              <Grid container spacing={2} alignItems="center">
                <Grid xs={5}>
                  <Typography variant="h6" sx={{ fontWeight: heroHomeWins ? 700 : 400 }} noWrap>
                    {selectedMatchup.home_team_name}
                  </Typography>
                  <Typography
                    variant="stat"
                    sx={{ fontSize: '1.25rem', fontWeight: heroHomeWins ? 700 : 400, mt: 0.5 }}
                  >
                    {heroHomeScore}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                    Proj: {selectedDetail?.home?.projectedTotal != null
                      ? Number(selectedDetail.home.projectedTotal).toFixed(1)
                      : '—'}
                  </Typography>
                </Grid>
                <Grid xs={2} sx={{ textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    vs
                  </Typography>
                </Grid>
                <Grid xs={5} sx={{ textAlign: 'right' }}>
                  <Typography variant="h6" sx={{ fontWeight: heroAwayWins ? 700 : 400 }} noWrap>
                    {selectedMatchup.away_team_name}
                  </Typography>
                  <Typography
                    variant="stat"
                    sx={{ fontSize: '1.25rem', fontWeight: heroAwayWins ? 700 : 400, mt: 0.5 }}
                  >
                    {heroAwayScore}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                    Proj: {selectedDetail?.away?.projectedTotal != null
                      ? Number(selectedDetail.away.projectedTotal).toFixed(1)
                      : '—'}
                  </Typography>
                </Grid>
              </Grid>
              <Box
                role="img"
                aria-label={`Win probability: ${selectedMatchup.home_team_name} ${Math.round(heroWinProb.home * 100)}%, ${selectedMatchup.away_team_name} ${Math.round(heroWinProb.away * 100)}%`}
                sx={{ mt: 2 }}
              >
                <LinearProgress
                  variant="determinate"
                  value={heroWinProb.home * 100}
                  sx={{ height: 6, borderRadius: 3 }}
                />
              </Box>
            </CardContent>
          </CardActionArea>

          <Box sx={{ px: 2, pb: 2 }}>
            {detailLoading && !selectedDetail?.home?.starters?.length && (
              <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1 }} />
            )}
            {!!selectedDetail?.home?.starters?.length && (
              <>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                  Starting Lineups
                </Typography>
                <RosterPreviewGrid
                  homeStarters={selectedDetail.home.starters}
                  awayStarters={selectedDetail.away.starters}
                />
              </>
            )}
          </Box>
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
        <Accordion defaultExpanded={false} sx={{ bgcolor: 'background.paper' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">Commissioner Tools</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
          </AccordionDetails>
        </Accordion>
      )}
    </Container>
  );
}

export default MatchupScreen;
