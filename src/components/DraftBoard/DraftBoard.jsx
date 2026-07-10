import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Alert,
  CircularProgress,
  Box,
  Grid,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Pagination,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';

function DraftBoard() {
  const { leagueId } = useParams();
  const [league, setLeague] = useState(null);
  const [teams, setTeams] = useState([]);
  const [picks, setPicks] = useState([]);
  const [onTheClock, setOnTheClock] = useState(null);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const socketRef = useRef(null);
  const teamsRef = useRef([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [positionFilter, setPositionFilter] = useState('All');

  useEffect(() => {
    // Socket lives for the lifetime of this view; refs avoid stale closures
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      newSocket.emit('draft:join', { leagueId: Number(leagueId) }, (resp) => {
        if (resp?.error) {
          setError(resp.error);
        }
      });
    });

    newSocket.on('draft:state', (data) => {
      setLeague(data.league);
      setTeams(data.teams);
      teamsRef.current = data.teams;
      setPicks([...data.picks].reverse()); // history renders newest first
      setOnTheClock(data.onTheClock);
    });

    newSocket.on('draft:picked', (data) => {
      setPicks((prevPicks) => [
        {
          pick_number: data.pickNumber,
          team_id: data.teamId,
          player_id: data.player.id,
          name: data.player.name,
          position: data.player.position,
          nfl_team: data.player.nfl_team,
        },
        ...prevPicks,
      ]);

      setOnTheClock(
        data.nextTeamId
          ? teamsRef.current.find((t) => t.id === data.nextTeamId) || null
          : null
      );

      if (data.draftComplete) {
        setSuccessMessage('Draft complete!');
        setLeague((prev) => (prev ? { ...prev, draft_status: 'complete' } : prev));
      }

      fetchAvailablePlayers(0);
    });

    newSocket.on('draft:complete', () => {
      setSuccessMessage('Draft complete!');
    });

    fetchInitialData();

    return () => {
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setError(null);
      await fetchAvailablePlayers(0);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailablePlayers = async (pageNum) => {
    try {
      const params = {
        page: pageNum + 1,
        leagueId: Number(leagueId),
        available: true,
      };
      if (positionFilter !== 'All') {
        params.position = positionFilter;
      }

      const res = await apiClient.get('/api/players', { params });
      setAvailablePlayers(res.data.players);
      setTotalPages(res.data.totalPages);
      setPage(pageNum);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleDraftPlayer = (playerId) => {
    if (socketRef.current) {
      setError(null);
      socketRef.current.emit('draft:pick', { leagueId: Number(leagueId), playerId }, (resp) => {
        if (resp?.error) {
          setError(resp.error);
        }
      });
    }
  };

  const handlePositionFilterChange = (e) => {
    setPositionFilter(e.target.value);
    setPage(0);
    fetchAvailablePlayers(0);
  };

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
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

      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          {league?.name || 'Draft Board'}
        </Typography>
        {onTheClock ? (
          <Chip
            label={`On the clock: ${onTheClock.name} (${onTheClock.owner})`}
            color="primary"
            sx={{ fontWeight: 'bold' }}
          />
        ) : (
          <Chip
            label={league?.draft_status || 'Unknown status'}
            color={
              league?.draft_status === 'complete'
                ? 'success'
                : league?.draft_status === 'active'
                ? 'warning'
                : 'default'
            }
          />
        )}
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }}>
            <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Typography variant="h6">Available Players</Typography>
              <FormControl sx={{ minWidth: 120 }}>
                <InputLabel>Position</InputLabel>
                <Select
                  value={positionFilter}
                  label="Position"
                  onChange={handlePositionFilterChange}
                  size="small"
                >
                  <MenuItem value="All">All</MenuItem>
                  <MenuItem value="QB">QB</MenuItem>
                  <MenuItem value="RB">RB</MenuItem>
                  <MenuItem value="WR">WR</MenuItem>
                  <MenuItem value="TE">TE</MenuItem>
                  <MenuItem value="K">K</MenuItem>
                  <MenuItem value="DEF">DEF</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'primary.main' }}>
                    <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>
                      Name
                    </TableCell>
                    <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>
                      Position
                    </TableCell>
                    <TableCell sx={{ color: 'white', fontWeight: 'bold' }}>
                      NFL Team
                    </TableCell>
                    <TableCell sx={{ color: 'white', fontWeight: 'bold' }} align="center">
                      Action
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {availablePlayers.map((player) => (
                    <TableRow key={player.id}>
                      <TableCell>{player.name}</TableCell>
                      <TableCell>{player.position}</TableCell>
                      <TableCell>{player.nfl_team}</TableCell>
                      <TableCell align="center">
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => handleDraftPlayer(player.id)}
                        >
                          Draft
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination
                count={totalPages}
                page={page + 1}
                onChange={(event, value) => fetchAvailablePlayers(value - 1)}
              />
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Pick History
            </Typography>
            <Box sx={{ maxHeight: '600px', overflowY: 'auto' }}>
              {picks.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No picks yet
                </Typography>
              ) : (
                picks.map((pick) => (
                  <Paper
                    key={`${pick.pick_number}-${pick.player_id}`}
                    sx={{ p: 1.5, mb: 1, bgcolor: 'grey.50' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      #{pick.pick_number}
                    </Typography>
                    <Typography variant="body2">
                      {pick.name} ({pick.position})
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {pick.nfl_team}
                    </Typography>
                  </Paper>
                ))
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}

export default DraftBoard;
