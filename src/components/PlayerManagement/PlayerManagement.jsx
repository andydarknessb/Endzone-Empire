import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Button, Pagination, Alert, Typography, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import apiClient from '../../api/apiClient';

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const headCellSx = { fontWeight: 'bold', backgroundColor: 'primary.main', color: 'primary.contrastText' };

function PlayerManagement() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [players, setPlayers] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [positionFilter, setPositionFilter] = useState('All');
  const [pageNumber, setPageNumber] = useState(1);
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState(null);

  const report = (err) => setError(err.response?.data?.error || err.message);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiClient.get('/api/league');
        setLeagues(response.data);
        if (response.data.length > 0) setSelectedLeague(response.data[0].id);
      } catch (err) {
        report(err);
      }
    })();
  }, []);

  const fetchPlayers = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/players', {
        params: { page: pageNumber, position: positionFilter },
      });
      setPlayers(response.data.players);
      setTotalPages(response.data.totalPages);
    } catch (err) {
      report(err);
    }
  }, [pageNumber, positionFilter]);

  const fetchRoster = useCallback(async () => {
    if (!selectedLeague) return;
    try {
      const response = await apiClient.get(`/api/team/roster?leagueId=${selectedLeague}`);
      setRoster(response.data);
    } catch (err) {
      report(err);
    }
  }, [selectedLeague]);

  useEffect(() => { fetchPlayers(); }, [fetchPlayers]);
  useEffect(() => { fetchRoster(); }, [fetchRoster]);

  const addToRoster = async (player) => {
    setError(null);
    try {
      await apiClient.post(`/api/team/roster/${player.id}`, {
        leagueId: Number(selectedLeague),
      });
      fetchRoster();
    } catch (err) {
      report(err);
    }
  };

  const removeFromRoster = async (playerId) => {
    setError(null);
    try {
      await apiClient.delete(`/api/team/roster/${playerId}?leagueId=${selectedLeague}`);
      fetchRoster();
    } catch (err) {
      report(err);
    }
  };

  const isPlayerInRoster = (playerId) => roster.some((player) => player.id === playerId);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ m: 1 }}>{error}</Alert>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="pm-league-label">League</InputLabel>
          <Select labelId="pm-league-label" label="League" value={selectedLeague}
            onChange={(e) => setSelectedLeague(e.target.value)}>
            {leagues.map((league) => (
              <MenuItem key={league.id} value={league.id}>{league.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="pm-pos-label">Position</InputLabel>
          <Select labelId="pm-pos-label" label="Position" value={positionFilter}
            onChange={(e) => { setPositionFilter(e.target.value); setPageNumber(1); }}>
            {POSITIONS.map((pos) => <MenuItem key={pos} value={pos}>{pos}</MenuItem>)}
          </Select>
        </FormControl>
        <Pagination
          count={totalPages}
          page={pageNumber}
          onChange={(event, value) => setPageNumber(value)}
        />
      </div>

      <TableContainer component={Paper} sx={{ borderRadius: 2, m: 1, maxWidth: 900 }}>
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={headCellSx}>Name</TableCell>
              <TableCell sx={headCellSx} align="right">Position</TableCell>
              <TableCell sx={headCellSx} align="right">NFL Team</TableCell>
              <TableCell sx={headCellSx} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {players.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  {player.name}
                </TableCell>
                <TableCell align="right" sx={{ fontStyle: 'italic' }}>{player.position}</TableCell>
                <TableCell align="right">{player.nfl_team}</TableCell>
                <TableCell align="right">
                  <Button
                    sx={{ backgroundColor: 'primary.main', color: 'primary.contrastText', '&:hover': { backgroundColor: 'primary.dark' } }}
                    onClick={() => addToRoster(player)}
                    disabled={!selectedLeague || isPlayerInRoster(player.id)}
                  >
                    {isPlayerInRoster(player.id) ? 'Added' : 'Add to Roster'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="h6" sx={{ mt: 3 }}>My Roster</Typography>
      <TableContainer component={Paper} sx={{ borderRadius: 2, m: 1, maxWidth: 900 }}>
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={headCellSx}>Name</TableCell>
              <TableCell sx={headCellSx} align="right">Position</TableCell>
              <TableCell sx={headCellSx} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roster.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  {player.name}
                </TableCell>
                <TableCell align="right" sx={{ fontStyle: 'italic' }}>{player.position}</TableCell>
                <TableCell align="right">
                  <Button
                    sx={{ backgroundColor: 'primary.main', color: 'primary.contrastText', '&:hover': { backgroundColor: 'primary.dark' } }}
                    onClick={() => removeFromRoster(player.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

export default PlayerManagement;
