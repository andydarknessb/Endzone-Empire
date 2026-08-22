import React, { useRef, useCallback } from 'react';
import {
  Paper,
  Box,
  Stack,
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
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import PositionChip from '../PlayerQuickView/PositionChip';
import AbbreviationTooltip from '../common/AbbreviationTooltip';
import ColumnGuide from './ColumnGuide';

// The real NFL regular season a Bye can fall in (mirrors REG_SEASON_WEEKS in
// server/services/bye.service.js) — every selectable option in the multi-select
// below, whether or not any team actually has a bye there this season; an
// empty result for an unused week is a normal, honest "no match", not a bug.
const BYE_WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);

// Applies to every numeric column (Bye, ADP, Pos rank, 17-game pace): fixed-
// width digit glyphs so a column of numbers lines up instead of drifting with
// each digit's natural width.
const numericCellSx = { fontVariantNumeric: 'tabular-nums' };

// Muted, dark-mode-friendly header: a step off the surrounding Paper instead
// of a saturated brand color, with a divider rule to separate it from rows.
const headCellSx = {
  color: 'text.primary',
  fontWeight: 'bold',
  bgcolor: 'background.default',
  borderBottom: '2px solid',
  borderBottomColor: 'divider',
};

// Pin the action column to the right edge so Draft/Queue stay reachable when
// the table overflows horizontally on narrow (phone) screens.
export const stickyActionHeadSx = {
  ...headCellSx,
  position: 'sticky',
  right: 0,
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
  byeWeeksFilter,
  onByeWeeksFilterChange,
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
  byeOverlapByWeek = new Map(),
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
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="h6">Available Players</Typography>
          <ColumnGuide />
        </Stack>
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
            {/* Individual defenders (DP-enabled leagues) — literal Tank01
                position codes, not the DL/LB/DB roster-eligibility group keys. */}
            <MenuItem value="DE">DE</MenuItem>
            <MenuItem value="DT">DT</MenuItem>
            <MenuItem value="LB">LB</MenuItem>
            <MenuItem value="CB">CB</MenuItem>
            <MenuItem value="S">S</MenuItem>
            <MenuItem value="DB">DB</MenuItem>
          </Select>
        </FormControl>
        <FormControl sx={{ minWidth: 220 }}>
          <InputLabel id="draft-bye-filter-label">Bye week</InputLabel>
          <Select
            labelId="draft-bye-filter-label"
            label="Bye week"
            multiple
            value={byeWeeksFilter}
            onChange={(e) => {
              const { value } = e.target;
              onByeWeeksFilterChange(typeof value === 'string' ? value.split(',').map(Number) : value);
            }}
            size="small"
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((week) => (
                  <Chip
                    key={week}
                    size="small"
                    label={`Bye ${week}`}
                    // Stops the click from also toggling the Select's open
                    // state, so the delete icon actually removes the chip
                    // instead of just reopening the dropdown.
                    onMouseDown={(e) => e.stopPropagation()}
                    onDelete={() => onByeWeeksFilterChange(selected.filter((w) => w !== week))}
                  />
                ))}
              </Box>
            )}
          >
            {BYE_WEEK_OPTIONS.map((week) => (
              <MenuItem key={week} value={week}>
                Week {week}
              </MenuItem>
            ))}
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
            <TableRow>
              <TableCell sx={headCellSx}>
                <TableSortLabel
                  active={sort === 'name'}
                  direction={sort === 'name' ? dir : 'asc'}
                  onClick={() => onSort('name')}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx}>Position</TableCell>
              <TableCell sx={headCellSx}>
                <TableSortLabel
                  active={sort === 'nfl_team'}
                  direction={sort === 'nfl_team' ? dir : 'asc'}
                  onClick={() => onSort('nfl_team')}
                >
                  NFL Team
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'bye_week'}
                  direction={sort === 'bye_week' ? dir : 'asc'}
                  onClick={() => onSort('bye_week')}
                >
                  <AbbreviationTooltip term="Bye" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'adp'}
                  direction={sort === 'adp' ? dir : 'asc'}
                  onClick={() => onSort('adp')}
                >
                  <AbbreviationTooltip term="ADP" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'position_rank'}
                  direction={sort === 'position_rank' ? dir : 'asc'}
                  onClick={() => onSort('position_rank')}
                >
                  <AbbreviationTooltip term="Pos rank" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'proj'}
                  direction={sort === 'proj' ? dir : 'asc'}
                  onClick={() => onSort('proj')}
                >
                  <AbbreviationTooltip term="17-game pace" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={stickyActionHeadSx} align="center">
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {displayPlayers.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} sx={{ color: 'text.secondary', textAlign: 'center' }}>
                  {search ? `No available players matching “${search}”` : 'No available players'}
                </TableCell>
              </TableRow>
            )}
            {displayPlayers.map((player) => {
              const isDrafted = draftedIds.has(player.id);
              const draftDisabled = !isMyTurn || !!draftPaused || isDrafted;
              const draftDisabledReason = isDrafted
                ? ''
                : draftPaused
                ? 'Draft is paused'
                : !isMyTurn
                ? `Waiting for ${onTheClockName || 'the next pick'}`
                : '';
              // Rostered players (on the caller's own team) sharing this
              // candidate's Bye week — a neutral roster fact, not a warning.
              // Excludes the candidate itself, in case Hide drafted is off and
              // this row IS one of the caller's own picks.
              const overlap = (byeOverlapByWeek.get(player.bye_week) || []).filter((p) => p.id !== player.id);
              return (
                <TableRow key={player.id}>
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
                  <TableCell align="right" sx={numericCellSx}>
                    {player.bye_week != null ? (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <span>{player.bye_week}</span>
                        {overlap.length > 0 && (
                          <Tooltip
                            title={`Also on your roster with this Bye: ${overlap.map((p) => p.name).join(', ')}`}
                          >
                            <Chip
                              size="small"
                              variant="outlined"
                              label={overlap.length}
                              aria-label={
                                `Bye overlap: ${overlap.length} rostered player${overlap.length === 1 ? '' : 's'} `
                                + `share this Bye week - ${overlap.map((p) => p.name).join(', ')}`
                              }
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell align="right" sx={numericCellSx}>{player.adp != null ? player.adp : '-'}</TableCell>
                  <TableCell align="right" sx={numericCellSx}>
                    {player.position_rank != null ? `#${player.position_rank}` : '-'}
                  </TableCell>
                  <TableCell align="right" sx={numericCellSx}>
                    {player.projected_points != null ? (
                      Number(player.projected_points).toFixed(1)
                    ) : (
                      <Tooltip title="17-game pace unavailable: not enough games in the prior completed season to extrapolate a pace.">
                        <Box component="span" tabIndex={0} sx={{ cursor: 'help' }}>
                          -
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="center" sx={stickyActionCellSx}>
                    <Stack direction="row" spacing={1} justifyContent="center" alignItems="center">
                      <Tooltip title={draftDisabledReason}>
                        <span>
                          <Button
                            variant="contained"
                            color="success"
                            size="small"
                            disabled={draftDisabled}
                            onClick={() => onDraft(player.id)}
                          >
                            Draft
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Queue">
                        <span>
                          <IconButton
                            aria-label="Queue"
                            size="small"
                            color="default"
                            disabled={isDrafted || queue.some((p) => p.id === player.id)}
                            onClick={() => onQueue(player)}
                          >
                            <PlaylistAddIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
            {loadingMore && (
              <TableRow>
                <TableCell colSpan={8} sx={{ textAlign: 'center', py: 2 }}>
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
