import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Button, Pagination, Alert, Typography, Select, MenuItem, FormControl, InputLabel,
  TextField, InputAdornment, Tooltip, Box, TableSortLabel, Switch, FormControlLabel, Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import apiClient from '../../api/apiClient';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import PlayerAvatar from '../PlayerQuickView/PlayerAvatar';
import PositionChip from '../PlayerQuickView/PositionChip';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import AbbreviationTooltip from '../common/AbbreviationTooltip';
import { rosterActionForPhase } from '../../lib/leaguePhase';

// DE/DT/LB/CB/S/DB are individual defenders (DP-enabled leagues) — literal
// Tank01 position codes, not the DL/LB/DB roster-eligibility group keys.
const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DE', 'DT', 'LB', 'CB', 'S', 'DB'];
const PLAYERS_PAGE_SIZE = 25; // matches the server page size; for ADP rank numbers

const headCellSx = { fontWeight: 'bold', backgroundColor: 'primary.main', color: 'primary.contrastText' };
// Keep the action column reachable when the table overflows horizontally on
// narrow screens: pin it to the right edge so the primary button stays visible
// while the rest of the row scrolls under it.
const stickyActionHeadSx = { ...headCellSx, position: 'sticky', right: 0, zIndex: 3 };
// Body sticky cell inherits the row's (striped/hover) background so the pinned
// column reads as part of the row with no vertical seam at its left edge.
const stickyActionCellSx = { position: 'sticky', right: 0, backgroundColor: 'inherit', zIndex: 1 };

// Opaque zebra striping + hover so rows are scannable and the sticky column
// (which inherits these) has no seam. Values are theme tokens.
const stripedRowsSx = {
  '& tbody tr': { backgroundColor: 'var(--surface)' },
  '& tbody tr:nth-of-type(even)': { backgroundColor: 'var(--row-stripe)' },
  '& tbody tr:hover': { backgroundColor: 'var(--row-hover)' },
};

// Keep the sort arrow/label legible on the colored (primary.main) header.
const sortLabelSx = {
  color: 'primary.contrastText',
  '&.Mui-active': { color: 'primary.contrastText' },
  '&:hover': { color: 'primary.contrastText' },
  '& .MuiTableSortLabel-icon': { color: 'primary.contrastText !important' },
};

function PlayerManagement() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [players, setPlayers] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const notify = useSnackbar();

  // Table state lives in the URL so refresh and back/forward restore it.
  const [searchParams, setSearchParams] = useSearchParams();
  const pageNumber = Math.max(1, Number(searchParams.get('page')) || 1);
  const positionFilter = searchParams.get('pos') || 'All';
  const search = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'adp';
  const dir = searchParams.get('dir') || 'asc';
  const hideRostered = searchParams.get('hide') === '1';
  const [searchInput, setSearchInput] = useState(search);
  const [jumpPage, setJumpPage] = useState('');
  const activeLeague = leagues.find((league) => league.id === selectedLeague);
  const rosterAction = rosterActionForPhase(activeLeague);

  // Merge updates into the query string, dropping keys set to a default/empty.
  const updateParams = useCallback(
    (updates) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(updates).forEach(([k, v]) => {
            if (v === '' || v == null || v === false) next.delete(k);
            else next.set(k, String(v));
          });
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const report = (err) => setError(err.response?.data?.error || err.message);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiClient.get('/api/league');
        // A pick'em-only league has no roster to add players to, so it never
        // appears in this selector.
        const rosterLeagues = response.data.filter((league) => !league.pickem_only);
        setLeagues(rosterLeagues);
        if (rosterLeagues.length > 0) setSelectedLeague(rosterLeagues[0].id);
      } catch (err) {
        report(err);
      }
    })();
  }, []);

  const fetchPlayers = useCallback(async () => {
    try {
      const params = { page: pageNumber, position: positionFilter, sort };
      if (dir === 'desc') params.dir = 'desc';
      if (search) params.search = search;
      const response = await apiClient.get('/api/players', { params });
      setPlayers(response.data.players);
      setTotalPages(response.data.totalPages);
      setTotalPlayers(response.data.total ?? 0);
    } catch (err) {
      report(err);
    }
  }, [pageNumber, positionFilter, search, sort, dir]);

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

  // Debounce the search box; commit the term to the URL (resetting to page 1).
  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (trimmed !== search) updateParams({ q: trimmed, page: 1 });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, search, updateParams]);

  const handleSort = (key) => {
    const nextDesc = sort === key && dir === 'asc';
    updateParams({
      sort: key === 'adp' ? '' : key, // adp is the default sort — keep URL clean
      dir: nextDesc ? 'desc' : '',
      page: 1,
    });
  };

  // Keep the (uncontrolled-feel) search box in sync when the URL term changes
  // externally, e.g. via the back/forward buttons.
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const addToRoster = async (player) => {
    setError(null);
    try {
      await apiClient.post(`/api/team/roster/${player.id}`, {
        leagueId: Number(selectedLeague),
      });
      fetchRoster();
      notify(`Added ${player.name} to your roster`);
    } catch (err) {
      report(err);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const undoDrop = async (player) => {
    try {
      await apiClient.post(`/api/team/roster/${player.id}/undo-drop`, {
        leagueId: Number(selectedLeague),
      });
      fetchRoster();
    } catch (err) {
      report(err);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const removeFromRoster = async (player) => {
    setError(null);
    try {
      await apiClient.delete(`/api/team/roster/${player.id}?leagueId=${selectedLeague}`);
      fetchRoster();
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

  const isPlayerInRoster = (playerId) => roster.some((player) => player.id === playerId);
  const shownPlayers = hideRostered ? players.filter((p) => !isPlayerInRoster(p.id)) : players;

  // Context action for the quick-view: Add to Roster for the currently-viewed
  // player, mirroring the row button's disabled/tooltip logic.
  const quickViewPlayer =
    players.find((p) => p.id === quickViewId) || roster.find((p) => p.id === quickViewId);
  const quickViewActions = quickViewPlayer
    ? [
        {
          label: isPlayerInRoster(quickViewPlayer.id) ? 'Added' : rosterAction.label,
          onClick: () => addToRoster(quickViewPlayer),
          disabled: !selectedLeague || isPlayerInRoster(quickViewPlayer.id) || rosterAction.disabled,
          tooltip: !selectedLeague ? 'Select a league first' : rosterAction.helper,
        },
      ]
    : [];

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ m: 1 }}>{error}</Alert>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Search players"
          placeholder="Search by name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          sx={{ minWidth: 220 }}
          InputProps={{
            startAdornment: <InputAdornment position="start">🔍</InputAdornment>,
            endAdornment: searchInput ? (
              <InputAdornment position="end">
                <Button size="small" onClick={() => setSearchInput('')} sx={{ minWidth: 0, p: 0.5 }} aria-label="Clear search">
                  <CloseIcon fontSize="small" />
                </Button>
              </InputAdornment>
            ) : null,
          }}
        />
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
            onChange={(e) => updateParams({ pos: e.target.value === 'All' ? '' : e.target.value, page: 1 })}>
            {POSITIONS.map((pos) => <MenuItem key={pos} value={pos}>{pos}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideRostered}
              onChange={(e) => updateParams({ hide: e.target.checked ? '1' : '' })}
            />
          }
          label="Hide rostered"
        />
        <Pagination
          count={totalPages}
          page={pageNumber}
          onChange={(event, value) => updateParams({ page: value })}
        />
        <TextField
          size="small"
          label="Jump to page"
          type="number"
          value={jumpPage}
          onChange={(event) => setJumpPage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const nextPage = Math.min(totalPages, Math.max(1, Number(jumpPage) || 1));
            updateParams({ page: nextPage });
            setJumpPage('');
          }}
          inputProps={{ min: 1, max: totalPages, 'aria-label': 'Jump to page' }}
          sx={{ width: 130 }}
        />
      </div>

      <TableContainer component={Paper} sx={{ borderRadius: 2, m: 1, width: '100%', maxWidth: 1100, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 900, ...stripedRowsSx }}>
          <TableHead>
            <TableRow>
              <TableCell sx={headCellSx} align="right">#</TableCell>
              <TableCell sx={headCellSx}>
                <TableSortLabel
                  active={sort === 'name'}
                  direction={sort === 'name' ? dir : 'asc'}
                  onClick={() => handleSort('name')}
                  sx={sortLabelSx}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">Position</TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'position_rank'}
                  direction={sort === 'position_rank' ? dir : 'asc'}
                  onClick={() => handleSort('position_rank')}
                  sx={sortLabelSx}
                >
                  <AbbreviationTooltip term="Pos rank" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">NFL Team</TableCell>
              <TableCell sx={headCellSx} align="right">Bye / status</TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'adp'}
                  direction={sort === 'adp' ? dir : 'asc'}
                  onClick={() => handleSort('adp')}
                  sx={sortLabelSx}
                >
                  <AbbreviationTooltip term="ADP" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'projected_points'}
                  direction={sort === 'projected_points' ? dir : 'asc'}
                  onClick={() => handleSort('projected_points')}
                  sx={sortLabelSx}
                >
                  <AbbreviationTooltip term="Projected" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={stickyActionHeadSx} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shownPlayers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ color: 'text.secondary', textAlign: 'center' }}>
                  {search ? `No players matching “${search}”` : 'No players found'}
                </TableCell>
              </TableRow>
            )}
            {shownPlayers.map((player, idx) => (
              <TableRow key={player.id}>
                <TableCell align="right" sx={{ color: 'text.secondary' }}>
                  {(pageNumber - 1) * PLAYERS_PAGE_SIZE + idx + 1}
                </TableCell>
                <TableCell component="th" scope="row">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <PlayerAvatar
                      name={player.name}
                      position={player.position}
                      photoUrl={player.photo_url}
                    />
                    <PlayerNameLink
                      name={player.name}
                      playerId={player.id}
                      onOpen={setQuickViewId}
                      sx={{ fontWeight: 'bold' }}
                    />
                  </Box>
                </TableCell>
                <TableCell align="right"><PositionChip position={player.position} /></TableCell>
                <TableCell align="right">{player.position_rank != null ? `#${player.position_rank}` : '-'}</TableCell>
                <TableCell align="right">{player.nfl_team}</TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Chip size="small" label={player.bye_week ? `Bye ${player.bye_week}` : 'Bye -'} variant="outlined" />
                    {player.injury_status && <Chip size="small" label={player.injury_status} color="warning" />}
                  </Box>
                </TableCell>
                <TableCell align="right">{player.adp != null ? player.adp : '-'}</TableCell>
                <TableCell align="right">
                  {player.projected_points != null ? Number(player.projected_points).toFixed(1) : '-'}
                </TableCell>
                <TableCell align="right" sx={stickyActionCellSx}>
                  <Tooltip title={!selectedLeague ? 'Select a league first' : rosterAction.helper}>
                    <span>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={() => addToRoster(player)}
                        disabled={!selectedLeague || isPlayerInRoster(player.id) || rosterAction.disabled}
                      >
                        {isPlayerInRoster(player.id) ? 'Added' : rosterAction.label}
                      </Button>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, mt: 1 }}>
        <Pagination count={totalPages} page={pageNumber} onChange={(event, value) => updateParams({ page: value })} />
        <Typography variant="caption" color="text.secondary">
          {totalPlayers} player{totalPlayers === 1 ? '' : 's'}
          {search ? ` matching “${search}”` : ''}
        </Typography>
      </Box>

      <Typography variant="h6" sx={{ mt: 3 }}>My Roster</Typography>
      <TableContainer component={Paper} sx={{ borderRadius: 2, m: 1, maxWidth: 900 }}>
        <Table sx={{ minWidth: 650, ...stripedRowsSx }}>
          <TableHead>
            <TableRow>
              <TableCell sx={headCellSx}>Name</TableCell>
              <TableCell sx={headCellSx} align="right">Position</TableCell>
              <TableCell sx={stickyActionHeadSx} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roster.map((player) => (
              <TableRow key={player.id}>
                <TableCell component="th" scope="row">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <PlayerAvatar
                      name={player.name}
                      position={player.position}
                      photoUrl={player.photo_url}
                    />
                    <PlayerNameLink
                      name={player.name}
                      playerId={player.id}
                      onOpen={setQuickViewId}
                      sx={{ fontWeight: 'bold' }}
                    />
                  </Box>
                </TableCell>
                <TableCell align="right"><PositionChip position={player.position} /></TableCell>
                <TableCell align="right" sx={stickyActionCellSx}>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => removeFromRoster(player)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={selectedLeague ? Number(selectedLeague) : undefined}
        playerIds={shownPlayers.map((p) => p.id)}
        onNavigate={setQuickViewId}
        actions={quickViewActions}
      />
    </div>
  );
}

export default PlayerManagement;
