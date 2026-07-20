import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Select, MenuItem, Button, Alert, FormControl, InputLabel, Box, Skeleton,
  Stack, Avatar, Chip, IconButton, Tooltip,
} from '@mui/material';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import apiClient from '../../api/apiClient';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import PlayerAvatar from '../PlayerQuickView/PlayerAvatar';
import PositionChip from '../PlayerQuickView/PositionChip';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

// Injury status -> chip fill. Not backed by real data yet (players has no
// injury_status column), so this only lights up once that field exists;
// today every player falls through to the em-dash below.
const STATUS_STYLE = {
  O: { bgcolor: 'error.main', color: 'error.contrastText' },
  D: { bgcolor: 'error.main', color: 'error.contrastText' },
  IR: { bgcolor: 'error.dark', color: 'error.contrastText' },
  Q: { bgcolor: 'warning.main', color: 'warning.contrastText' },
  P: { bgcolor: 'warning.light', color: 'warning.contrastText' },
};

function StatusChip({ status }) {
  if (!status) {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }
  return (
    <Chip
      label={status}
      size="small"
      sx={{ fontWeight: 700, minWidth: 30, ...(STATUS_STYLE[status] || { bgcolor: 'grey.500', color: 'common.white' }) }}
    />
  );
}

function initialsFor(name) {
  if (!name) return 'FF';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

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

  const activeLeague = leagues.find((league) => league.id === selectedLeague);
  const teamName = activeLeague?.my_team_name || 'My Team';
  const showEmptyState = !loading && roster.length === 0;

  return (
    <div>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 22, fontWeight: 700 }}>
              {initialsFor(teamName)}
            </Avatar>
            <Box>
              <Typography variant="h4" component="h1">{teamName}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Record: 4-0&nbsp;&nbsp;|&nbsp;&nbsp;Rank: 1st&nbsp;&nbsp;|&nbsp;&nbsp;Waiver: 3
              </Typography>
            </Box>
          </Stack>

          <FormControl size="small" sx={{ minWidth: 220 }}>
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
        </Stack>
      </Paper>

      {showEmptyState ? (
        <Paper
          variant="outlined"
          sx={{
            minHeight: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
          }}
        >
          <Stack alignItems="center" spacing={1.5} sx={{ py: 4, px: 3, textAlign: 'center' }}>
            <GroupAddOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
            {leagues.length === 0 ? (
              <>
                <Typography color="text.secondary">
                  You&apos;re not in a league yet — create or join one to start building your team.
                </Typography>
                <Button component={RouterLink} to="/league" variant="contained">
                  Go to Leagues
                </Button>
              </>
            ) : (
              <>
                <Typography color="text.secondary">
                  No players rostered yet. Head to the player pool to add players to your team.
                </Typography>
                <Button component={RouterLink} to="/player" variant="contained">
                  Browse Players
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      ) : (
        <TableContainer component={Paper} sx={{ bgcolor: 'background.paper' }}>
          <Table sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow>
                <TableCell>POS</TableCell>
                <TableCell>Player</TableCell>
                <TableCell>Bye</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Acquired</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`} data-testid="roster-skeleton">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton variant="text" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!loading &&
                roster.map((player) => (
                  <TableRow key={player.id} hover>
                    <TableCell component="th" scope="row">
                      <PositionChip position={player.position} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <PlayerAvatar name={player.name} position={player.position} photoUrl={player.photo_url} />
                        <Box>
                          <PlayerNameLink
                            name={player.name}
                            playerId={player.id}
                            onOpen={setQuickViewId}
                            sx={{ fontWeight: 600, display: 'block' }}
                          />
                          <Typography variant="body2" color="text.secondary">
                            {player.nfl_team || '—'} &middot; {player.position}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{player.bye_week ?? '—'}</TableCell>
                    <TableCell>
                      <StatusChip status={player.injury_status} />
                    </TableCell>
                    <TableCell>
                      {player.acquired_at ? new Date(player.acquired_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Start a trade">
                          <IconButton
                            size="small"
                            component={RouterLink}
                            to={`/league/${selectedLeague}/trades`}
                            aria-label="Trade"
                            sx={{ color: 'info.main' }}
                          >
                            <SwapHorizIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Drop player">
                          <IconButton
                            size="small"
                            onClick={() => dropPlayer(player)}
                            aria-label="Drop"
                            sx={{ color: 'error.main' }}
                          >
                            <PersonRemoveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
      />
    </div>
  );
}

export default TeamManagement;
