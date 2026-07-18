import React, { useState, useEffect } from 'react';
import {
  Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Select, MenuItem, Button, Alert, FormControl, InputLabel,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';

function TeamManagement() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);

  useEffect(() => {
    fetchLeagues();
  }, []);

  useEffect(() => {
    if (selectedLeague) fetchRoster(selectedLeague);
  }, [selectedLeague]);

  const report = (err) => setError(err.response?.data?.error || err.message);

  const fetchLeagues = async () => {
    try {
      const response = await apiClient.get('/api/league');
      setLeagues(response.data);
      if (response.data.length > 0) setSelectedLeague(response.data[0].id);
    } catch (err) {
      report(err);
    }
  };

  const fetchRoster = async (leagueId) => {
    try {
      const response = await apiClient.get(`/api/team/roster?leagueId=${leagueId}`);
      setRoster(response.data);
    } catch (err) {
      report(err);
    }
  };

  const dropPlayer = async (playerId) => {
    setError(null);
    try {
      await apiClient.delete(`/api/team/roster/${playerId}?leagueId=${selectedLeague}`);
      fetchRoster(selectedLeague);
    } catch (err) {
      report(err);
    }
  };

  return (
    <div>
      <Typography variant="h4" gutterBottom>Team Management</Typography>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <FormControl size="small" sx={{ minWidth: 240, my: 2 }}>
        <InputLabel id="league-select-label">League</InputLabel>
        <Select
          labelId="league-select-label"
          label="League"
          value={selectedLeague}
          onChange={(event) => setSelectedLeague(event.target.value)}
        >
          {leagues.map((league) => (
            <MenuItem key={league.id} value={league.id}>{league.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TableContainer component={Paper}>
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell>POS</TableCell>
              <TableCell>Player</TableCell>
              <TableCell>NFL Team</TableCell>
              <TableCell>Acquired</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roster.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row">{player.position}</TableCell>
                <TableCell>
                  <PlayerNameLink name={player.name} playerId={player.id} onOpen={setQuickViewId} />
                </TableCell>
                <TableCell>{player.nfl_team}</TableCell>
                <TableCell>
                  {player.acquired_at ? new Date(player.acquired_at).toLocaleDateString() : '—'}
                </TableCell>
                <TableCell align="right">
                  <Button size="small" color="error" onClick={() => dropPlayer(player.id)}>
                    Drop
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {roster.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography color="text.secondary">No players rostered yet.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
      />
    </div>
  );
}

export default TeamManagement;
