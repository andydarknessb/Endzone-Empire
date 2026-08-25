import React, { useMemo, useState } from 'react';
import {
  Box, Button, InputAdornment, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import PositionChip from '../PlayerQuickView/PositionChip';
import { positionGroupKey } from '../../lib/draftSim/cpuBrain';

const BASE_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const IDP_FILTERS = ['DL', 'LB', 'DB'];
const VISIBLE_ROWS = 60;

function numberCell(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

/** One line of stats for the mobile card: "Bye 6 · ADP 1.5 · RB1 · Proj 328". */
function statLine(player) {
  const parts = [];
  parts.push(`Bye ${player.byeWeek ?? '-'}`);
  parts.push(`ADP ${numberCell(player.adp)}`);
  if (player.positionRank != null) parts.push(`${positionGroupKey(player.position)}${player.positionRank}`);
  parts.push(`Proj ${numberCell(player.projectedPoints)}`);
  return parts.join(' · ');
}

/**
 * The available-player board. Filtering is entirely in memory (the whole pool
 * arrives in one fetch), so search and position toggles are instant and the sim
 * never touches the network mid-draft.
 *
 * Below the md breakpoint the table becomes a card list (the RankingTable
 * convention): a six-column table at phone width scrolls the Draft button —
 * the whole point of the screen — off the right edge.
 */
function SimPlayerPool({ players, includeIdp = false, onDraft, myTurn }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('ALL');

  const filters = includeIdp ? [...BASE_FILTERS, ...IDP_FILTERS] : BASE_FILTERS;

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return players.filter((player) => {
      if (position !== 'ALL' && positionGroupKey(player.position) !== position) return false;
      if (!query) return true;
      return String(player.name || '').toLocaleLowerCase().includes(query)
        || String(player.nflTeam || '').toLocaleLowerCase().includes(query);
    });
  }, [players, search, position]);

  const visible = filtered.slice(0, VISIBLE_ROWS);

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }} alignItems={{ md: 'center' }}>
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          label="Search players"
          inputProps={{ 'aria-label': 'Search players' }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
          sx={{ minWidth: { md: 240 } }}
        />
        <ToggleButtonGroup
          exclusive
          size={mobile ? 'medium' : 'small'}
          value={position}
          onChange={(_event, value) => value && setPosition(value)}
          aria-label="Filter by position"
          sx={{ flexWrap: 'wrap' }}
        >
          {filters.map((key) => (
            <ToggleButton key={key} value={key} aria-label={key}>{key}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {filtered.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          No available players match that filter.
        </Typography>
      ) : mobile ? (
        <Stack spacing={1} sx={{ maxHeight: 520, overflowY: 'auto' }}>
          {visible.map((player) => (
            <Paper key={player.playerId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <PositionChip position={player.position} size="small" />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{player.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {player.nflTeam || '-'}
                    {player.injuryStatus ? ` · ${player.injuryStatus}` : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {statLine(player)}
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  disabled={!myTurn}
                  onClick={() => onDraft(player.playerId)}
                  aria-label={`Draft ${player.name}`}
                  sx={{ minHeight: 44, flexShrink: 0 }}
                >
                  Draft
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : (
        <TableContainer sx={{ maxHeight: 520, overflowX: 'auto' }}>
          <Table size="small" stickyHeader aria-label="Available players">
            <TableHead>
              <TableRow>
                <TableCell>Player</TableCell>
                <TableCell align="right">Bye</TableCell>
                <TableCell align="right">ADP</TableCell>
                <TableCell align="right">Pos rank</TableCell>
                <TableCell align="right">Proj</TableCell>
                <TableCell align="right">Draft</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((player) => (
                <TableRow key={player.playerId} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <PositionChip position={player.position} size="small" />
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{player.name}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {player.nflTeam || '-'}
                          {player.injuryStatus ? ` · ${player.injuryStatus}` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{player.byeWeek ?? '-'}</TableCell>
                  <TableCell align="right">{numberCell(player.adp)}</TableCell>
                  <TableCell align="right">
                    {player.positionRank == null ? '-' : `${positionGroupKey(player.position)}${player.positionRank}`}
                  </TableCell>
                  <TableCell align="right">{numberCell(player.projectedPoints)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!myTurn}
                      onClick={() => onDraft(player.playerId)}
                      aria-label={`Draft ${player.name}`}
                    >
                      Draft
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {filtered.length > visible.length && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          Showing the top {visible.length} of {filtered.length} available. Search to narrow it down.
        </Typography>
      )}
    </Paper>
  );
}

export default SimPlayerPool;
