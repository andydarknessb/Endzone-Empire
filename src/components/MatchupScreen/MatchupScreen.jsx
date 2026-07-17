import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
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
  CircularProgress,
  Box,
  Grid,
  Chip,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';

const LIVE_INDICATOR_MS = 10000;

function MatchupScreen() {
  const { leagueId } = useParams();
  const [matchups, setMatchups] = useState([]);
  const [league, setLeague] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [weekFilter, setWeekFilter] = useState('All');
  const [weeks, setWeeks] = useState([]);
  const [season, setSeason] = useState('2025');
  const [week, setWeek] = useState('1');
  const [showLive, setShowLive] = useState(false);
  const socketRef = useRef(null);
  const liveTimeoutRef = useRef(null);

  useEffect(() => {
    fetchData();
  }, [leagueId]);

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

      const matchupsRes = await apiClient.get(`/api/league/${leagueId}/matchups`);
      setMatchups(matchupsRes.data);

      const uniqueWeeks = Array.from(
        new Set(matchupsRes.data.map((m) => m.week))
      ).sort((a, b) => a - b);
      setWeeks(uniqueWeeks);

      const leagueRes = await apiClient.get(`/api/league/${leagueId}`);
      setLeague(leagueRes.data.league);

      const userRes = await apiClient.get('/api/user');
      setUser(userRes.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMatchups = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/matchups`, {
        season: parseInt(season),
        week: parseInt(week),
      });
      setSuccessMessage('Matchups generated successfully!');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleScoreWeek = async () => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.post(`/api/scoring/league/${leagueId}/score`, {
        season: parseInt(season),
        week: parseInt(week),
      });
      setSuccessMessage('Week scored successfully!');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const isOwner = user && league && user.id === league.owner_id;

  const filteredMatchups =
    weekFilter === 'All'
      ? matchups
      : matchups.filter((m) => m.week === parseInt(weekFilter));

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Typography variant="h4">
          Matchups {league && `— ${league.name}`}
        </Typography>
        {showLive && <Chip label="LIVE" color="error" size="small" />}
      </Box>

      <Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
        <FormControl sx={{ minWidth: 150 }}>
          <InputLabel id="week-filter-label">Week</InputLabel>
          <Select
            labelId="week-filter-label"
            value={weekFilter}
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
      </Box>

      <Grid container spacing={2} sx={{ mb: 4 }}>
        {filteredMatchups.map((matchup) => {
          // pg returns DECIMAL columns as strings — compare numerically
          const homeScore = Number(matchup.home_score);
          const awayScore = Number(matchup.away_score);
          const homeWins = homeScore > awayScore;
          const awayWins = awayScore > homeScore;

          return (
            <Grid item xs={12} sm={6} md={4} key={matchup.id}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Week {matchup.week}
                </Typography>
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
                <Box sx={{ mt: 1, textAlign: 'right' }}>
                  <Link
                    to={`/league/${leagueId}/matchups/${matchup.id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <Button size="small" variant="outlined">
                      Details
                    </Button>
                  </Link>
                </Box>
              </Paper>
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
