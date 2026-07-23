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
import TeamAvatarUploader from '../common/TeamAvatarUploader';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../lib/leaguePhase';

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

function TeamSummary({ league, summary }) {
  if (!league || summary.status === 'idle') return null;
  if (summary.status === 'loading') {
    return <Skeleton data-testid="team-summary-skeleton" variant="text" width={220} sx={{ mt: 0.5 }} />;
  }

  const isPreDraft = league.draft_status === 'pending';
  const isFaab = league.waiver_type === 'faab';
  const row = summary.row;
  const gamesPlayed = row ? row.wins + row.losses + row.ties : 0;
  const parts = [];

  if (isPreDraft || (row && gamesPlayed === 0)) {
    parts.push('No record yet');
  } else if (row) {
    parts.push(`Record: ${row.wins}-${row.losses}-${row.ties}`);
    parts.push(`Rank: #${row.rank}`);
  } else {
    parts.push('Record unavailable');
  }

  if (isPreDraft) {
    parts.push('Waiver order not set');
  } else if (isFaab) {
    parts.push(league.my_team_faab_remaining == null
      ? 'FAAB unavailable'
      : `FAAB remaining: $${league.my_team_faab_remaining}`);
  } else {
    parts.push(league.my_team_waiver_priority == null
      ? 'Waiver order not set'
      : `Waiver priority: #${league.my_team_waiver_priority}`);
  }

  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
      {parts.join(' · ')}
    </Typography>
  );
}

function TeamManagement() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState({ status: 'idle', row: null });
  const [quickViewId, setQuickViewId] = useState(null);
  const notify = useSnackbar();
  const activeLeague = leagues.find((league) => league.id === selectedLeague);
  const activeTeamId = activeLeague?.my_team_id;
  const leaguePhase = deriveLeaguePhase(activeLeague);

  useEffect(() => {
    fetchLeagues();
  }, []);

  useEffect(() => {
    if (selectedLeague) fetchRoster(selectedLeague);
  }, [selectedLeague]);

  useEffect(() => {
    let ignore = false;
    if (!selectedLeague || activeTeamId == null) {
      setSummary({ status: 'idle', row: null });
      return () => { ignore = true; };
    }

    setSummary({ status: 'loading', row: null });
    apiClient.get(`/api/scoring/league/${selectedLeague}/standings`)
      .then((response) => {
        if (ignore) return;
        const rows = Array.isArray(response.data?.standings) ? response.data.standings : [];
        setSummary({
          status: 'success',
          row: rows.find((row) => row.teamId === activeTeamId) || null,
        });
      })
      .catch(() => {
        if (!ignore) setSummary({ status: 'error', row: null });
      });

    return () => { ignore = true; };
  }, [selectedLeague, activeTeamId]);

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

  const teamName = activeLeague?.my_team_name || 'My Team';
  const showEmptyState = !loading && roster.length === 0;
  const draftInProgress = leaguePhase === LEAGUE_PHASE.PRE_DRAFT || leaguePhase === LEAGUE_PHASE.DRAFTING;

  const handleAvatarUpdated = (team) => {
    setLeagues((prev) => prev.map((league) => (league.id === selectedLeague
      ? { ...league, my_team_avatar_url: team.avatar_url, my_team_avatar_static_url: team.avatar_static_url }
      : league)));
  };

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
            {activeLeague ? (
              <TeamAvatarUploader
                teamId={activeLeague.my_team_id}
                teamName={teamName}
                avatarUrl={activeLeague.my_team_avatar_url}
                avatarStaticUrl={activeLeague.my_team_avatar_static_url}
                onUpdated={handleAvatarUpdated}
                size={64}
              />
            ) : (
              <Avatar sx={{ width: 64, height: 64 }} />
            )}
            <Box>
              <Typography variant="h4" component="h1">{teamName}</Typography>
              <TeamSummary league={activeLeague} summary={summary} />
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
                  {draftInProgress
                    ? 'Your roster fills during the draft. Head to the Draft Room when it is time to pick.'
                    : 'No players rostered yet. Head to the player pool to add players to your team.'}
                </Typography>
                <Button
                  component={RouterLink}
                  to={draftInProgress ? `/league/${selectedLeague}/draft` : '/player'}
                  variant="contained"
                >
                  {draftInProgress ? 'Draft Room' : 'Browse Players'}
                </Button>
              </>
            )}
          </Stack>
        </Paper>
      ) : (
        <Paper sx={{ bgcolor: 'background.paper', overflow: 'hidden' }}>
          {!loading && roster.length > 0 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1} sx={{ p: 2 }}>
              <Box>
                <Typography variant="h6">Current lineup</Typography>
                <Typography variant="body2" color="text.secondary">
                  Starter and bench assignments reflect the current week. Position eligibility is shown for every player.
                </Typography>
              </Box>
              <Button component={RouterLink} to={`/league/${selectedLeague}/lineup`} variant="contained">
                Set Lineup
              </Button>
            </Stack>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell>Slot</TableCell>
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
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton variant="text" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!loading &&
                roster.map((player) => (
                  <TableRow key={player.id} hover>
                    <TableCell>
                      <Chip
                        size="small"
                        label={player.lineup_slot || 'Not set'}
                        variant={player.lineup_slot && !['BENCH', 'IR'].includes(player.lineup_slot) ? 'filled' : 'outlined'}
                        color={player.lineup_slot && !['BENCH', 'IR'].includes(player.lineup_slot) ? 'primary' : 'default'}
                      />
                    </TableCell>
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
        </Paper>
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
