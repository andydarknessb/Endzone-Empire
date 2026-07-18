import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Button, Pagination, Alert, Typography, Select, MenuItem, FormControl, InputLabel,
  TextField, InputAdornment,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';

const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const PLAYERS_PAGE_SIZE = 25; // matches the server page size; for ADP rank numbers

const headCellSx = { fontWeight: 'bold', backgroundColor: 'primary.main', color: 'primary.contrastText' };

function PlayerManagement() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [players, setPlayers] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [positionFilter, setPositionFilter] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);

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
      const params = { page: pageNumber, position: positionFilter, sort: 'adp' };
      if (search) params.search = search;
      const response = await apiClient.get('/api/players', { params });
      setPlayers(response.data.players);
      setTotalPages(response.data.totalPages);
    } catch (err) {
      report(err);
    }
  }, [pageNumber, positionFilter, search]);

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

  // Debounce the search box so we're not firing a request per keystroke, and
  // reset to page 1 whenever the committed term changes.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageNumber(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

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
                  ✕
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
              <TableCell sx={headCellSx} align="right">#</TableCell>
              <TableCell sx={headCellSx}>Name</TableCell>
              <TableCell sx={headCellSx} align="right">Position</TableCell>
              <TableCell sx={headCellSx} align="right">NFL Team</TableCell>
              <TableCell sx={headCellSx} align="right">ADP</TableCell>
              <TableCell sx={headCellSx} align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {players.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary', textAlign: 'center' }}>
                  {search ? `No players matching “${search}”` : 'No players found'}
                </TableCell>
              </TableRow>
            )}
            {players.map((player, idx) => (
              <TableRow key={player.id}>
                <TableCell align="right" sx={{ color: 'text.secondary' }}>
                  {(pageNumber - 1) * PLAYERS_PAGE_SIZE + idx + 1}
                </TableCell>
                <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  <PlayerNameLink
                    name={player.name}
                    playerId={player.id}
                    onOpen={setQuickViewId}
                    sx={{ fontWeight: 'bold' }}
                  />
                </TableCell>
                <TableCell align="right" sx={{ fontStyle: 'italic' }}>{player.position}</TableCell>
                <TableCell align="right">{player.nfl_team}</TableCell>
                <TableCell align="right">{player.adp != null ? player.adp : '—'}</TableCell>
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
                  <PlayerNameLink
                    name={player.name}
                    playerId={player.id}
                    onOpen={setQuickViewId}
                    sx={{ fontWeight: 'bold' }}
                  />
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

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={selectedLeague ? Number(selectedLeague) : undefined}
      />
    </div>
  );
}

export default PlayerManagement;
