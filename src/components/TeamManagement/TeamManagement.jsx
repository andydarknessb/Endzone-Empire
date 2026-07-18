import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Select, MenuItem, Button, Alert, FormControl, InputLabel, Box, Skeleton,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

function TeamManagement() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const notify = useSnackbar();

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
      if (response.data.length > 0) {
        setSelectedLeague(response.data[0].id);
        // Keep the skeleton up: fetchRoster (via the selectedLeague effect)
        // resolves the loading state.
      } else {
        setLoading(false); // no league -> nothing more to load
      }
    } catch (err) {
      report(err);
      setLoading(false);
    }
  };

  const fetchRoster = async (leagueId) => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/api/team/roster?leagueId=${leagueId}`);
      setRoster(response.data);
    } catch (err) {
      report(err);
    } finally {
      setLoading(false);
    }
  };

  const undoDrop = async (player) => {
    try {
      await apiClient.post(`/api/team/roster/${player.id}/undo-drop`, { leagueId: Number(selectedLeague) });
      fetchRoster(selectedLeague);
    } catch (err) {
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const dropPlayer = async (player) => {
    setError(null);
    try {
      await apiClient.delete(`/api/team/roster/${player.id}?leagueId=${selectedLeague}`);
      fetchRoster(selectedLeague);
      notify(`Dropped ${player.name}`, {
        severity: 'info',
        actionLabel: 'Undo',
        onAction: () => undoDrop(player),
      });
    } catch (err) {
      report(err);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
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
            {loading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`} data-testid="roster-skeleton">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading &&
              roster.map((player) => (
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
                    <Button size="small" color="error" onClick={() => dropPlayer(player)}>
                      Drop
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            {!loading && roster.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Box sx={{ py: 3, textAlign: 'center' }}>
                    {leagues.length === 0 ? (
                      <>
                        <Typography color="text.secondary" gutterBottom>
                          You&apos;re not in a league yet — create or join one to start building your team.
                        </Typography>
                        <Button component={RouterLink} to="/league" variant="contained">
                          Go to Leagues
                        </Button>
                      </>
                    ) : (
                      <>
                        <Typography color="text.secondary" gutterBottom>
                          No players rostered yet. Head to the player pool to add players to your team.
                        </Typography>
                        <Button component={RouterLink} to="/player" variant="contained">
                          Browse Players
                        </Button>
                      </>
                    )}
                  </Box>
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
