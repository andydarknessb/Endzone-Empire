import React, { useRef, useCallback } from 'react';
import {
  Paper,
  Box,
  Typography,
  TextField,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  Button,
  Chip,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import PositionChip from '../PlayerQuickView/PositionChip';

// Pin the action column to the right edge so Draft/Queue stay reachable when
// the table overflows horizontally on narrow (phone) screens.
export const stickyActionHeadSx = {
  color: 'primary.contrastText',
  fontWeight: 'bold',
  position: 'sticky',
  right: 0,
  bgcolor: 'primary.main',
  zIndex: 3,
};
// Inherit the row's (striped/hover) background so the pinned column has no
// vertical seam against the row.
export const stickyActionCellSx = { position: 'sticky', right: 0, bgcolor: 'inherit', zIndex: 1 };

// Opaque zebra striping + hover; the sticky action cell inherits these.
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

// Fetch the next page once the scroller is within this many pixels of the
// bottom, so the next window of rows is ready before the user hits the edge.
const NEAR_BOTTOM_PX = 200;

/** Filters + the scrollable available-players table (windowed/infinite-append pool). */
function PlayerPoolTable({
  searchInput,
  onSearchInputChange,
  positionFilter,
  onPositionFilterChange,
  hideDrafted,
  onHideDraftedChange,
  sort,
  dir,
  onSort,
  search,
  displayPlayers,
  draftedIds,
  isMyTurn,
  draftPaused,
  onTheClockName,
  queue,
  onDraft,
  onQueue,
  onOpenQuickView,
  hasMore,
  loadingMore,
  onLoadMore,
}) {
  const scrollRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6">Available Players</Typography>
        <TextField
          size="small"
          label="Search"
          placeholder="Search by name…"
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          sx={{ minWidth: 200 }}
          InputProps={{
            endAdornment: searchInput ? (
              <IconButton size="small" aria-label="Clear search" onClick={() => onSearchInputChange('')}>
                <CloseIcon fontSize="small" />
              </IconButton>
            ) : null,
          }}
        />
        <FormControl sx={{ minWidth: 120 }}>
          <InputLabel id="draft-position-filter-label">Position</InputLabel>
          <Select
            labelId="draft-position-filter-label"
            value={positionFilter}
            label="Position"
            onChange={(e) => onPositionFilterChange(e.target.value)}
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
        <FormControlLabel
          control={
            <Switch size="small" checked={hideDrafted} onChange={(e) => onHideDraftedChange(e.target.checked)} />
          }
          label="Hide drafted"
        />
      </Box>

      <TableContainer ref={scrollRef} onScroll={handleScroll} sx={{ maxHeight: '60vh', overflow: 'auto' }}>
        <Table stickyHeader sx={stripedRowsSx}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold', bgcolor: 'primary.main' }} align="right">
                #
              </TableCell>
              <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold', bgcolor: 'primary.main' }}>
                <TableSortLabel
                  active={sort === 'name'}
                  direction={sort === 'name' ? dir : 'asc'}
                  onClick={() => onSort('name')}
                  sx={sortLabelSx}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold', bgcolor: 'primary.main' }}>
                Pos
              </TableCell>
              <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold', bgcolor: 'primary.main' }}>
                NFL Team
              </TableCell>
              <TableCell
                sx={{ color: 'primary.contrastText', fontWeight: 'bold', bgcolor: 'primary.main' }}
                align="right"
              >
                <TableSortLabel
                  active={sort === 'adp'}
                  direction={sort === 'adp' ? dir : 'asc'}
                  onClick={() => onSort('adp')}
                  sx={sortLabelSx}
                >
                  ADP
                </TableSortLabel>
              </TableCell>
              <TableCell
                sx={{ color: 'primary.contrastText', fontWeight: 'bold', bgcolor: 'primary.main' }}
                align="right"
              >
                <TableSortLabel
                  active={sort === 'proj'}
                  direction={sort === 'proj' ? dir : 'asc'}
                  onClick={() => onSort('proj')}
                  sx={sortLabelSx}
                >
                  Season Proj
                </TableSortLabel>
              </TableCell>
              <TableCell sx={stickyActionHeadSx} align="center">
                Action
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {displayPlayers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: 'text.secondary', textAlign: 'center' }}>
                  {search ? `No available players matching “${search}”` : 'No available players'}
                </TableCell>
              </TableRow>
            )}
            {displayPlayers.map((player, idx) => {
              const isDrafted = draftedIds.has(player.id);
              const draftDisabled = !isMyTurn || !!draftPaused || isDrafted;
              const draftDisabledReason = isDrafted
                ? ''
                : draftPaused
                ? 'Draft is paused'
                : !isMyTurn
                ? `Waiting for ${onTheClockName || 'the next pick'}`
                : '';
              return (
                <TableRow key={player.id}>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} />
                      <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
                      {isDrafted && <Chip size="small" label="Drafted" color="default" />}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <PositionChip position={player.position} />
                  </TableCell>
                  <TableCell>{player.nfl_team}</TableCell>
                  <TableCell align="right">{player.adp != null ? player.adp : '—'}</TableCell>
                  <TableCell align="right">
                    {player.projected_points != null ? player.projected_points : '—'}
                  </TableCell>
                  <TableCell align="center" sx={stickyActionCellSx}>
                    <Tooltip title={draftDisabledReason}>
                      <span>
                        <Button variant="contained" size="small" disabled={draftDisabled} onClick={() => onDraft(player.id)}>
                          Draft
                        </Button>
                      </span>
                    </Tooltip>
                    <Button
                      variant="outlined"
                      size="small"
                      sx={{ ml: 1 }}
                      disabled={isDrafted || queue.some((p) => p.id === player.id)}
                      onClick={() => onQueue(player)}
                    >
                      Queue
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {loadingMore && (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: 'center', py: 2 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export default PlayerPoolTable;
