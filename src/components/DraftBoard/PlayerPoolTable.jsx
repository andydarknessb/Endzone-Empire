import React, { useId, useRef, useCallback, useEffect } from 'react';
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
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import PositionChip from '../PlayerQuickView/PositionChip';
import AbbreviationTooltip from '../common/AbbreviationTooltip';
import ColumnGuide from './ColumnGuide';
import { pickActionExists, pickTemporarilyUnavailable, PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

// The real NFL regular season a Bye can fall in (mirrors REG_SEASON_WEEKS in
// server/services/bye.service.js) — every selectable option in the multi-select
// below, whether or not any team actually has a bye there this season; an
// empty result for an unused week is a normal, honest "no match", not a bug.
const BYE_WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);

// Same six sortable fields the desktop table's TableSortLabel column headers
// expose, in the same left-to-right order - the mobile card list has no
// column headers to sort by, so this drives a "Sort by" Select instead
// (issue #122 acceptance criterion 4: mobile keeps the full state, not a
// stripped-down view of it).
//
// Known duplication (code-review finding, deferred rather than expanding
// this PR further): the desktop table's six TableSortLabel headers below
// hardcode this same key/label pairing individually inline in their own
// JSX. Unifying the two would mean making the header row itself
// data-driven off this same list, which touches that stable, already
// well-tested markup - a follow-up, not a change to make alongside a
// layout PR.
const SORT_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'nfl_team', label: 'NFL Team' },
  { key: 'bye_week', label: 'Bye' },
  { key: 'adp', label: 'ADP' },
  { key: 'position_rank', label: 'Pos rank' },
  { key: 'proj', label: '17-game pace' },
];

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

/** Per-player derived state shared by both the desktop table row and the
 * mobile card - computed once per render pass rather than duplicated. */
function rowStateFor(player, { draftedIds, canManualPickBase, tablePickUnavailable, byeOverlapByWeek, queue }) {
  const isDrafted = draftedIds.has(player.id);
  // A drafted player has nothing left to Pick or Queue - both actions are
  // hidden entirely rather than shown disabled (#120 acceptance criterion 5);
  // the "Drafted" chip already says why.
  const canManualPick = !isDrafted && canManualPickBase;
  const pickUnavailable = canManualPick && tablePickUnavailable;
  // Rostered players (on the caller's own team) sharing this candidate's Bye
  // week — a neutral roster fact, not a warning. Excludes the candidate
  // itself, in case Hide drafted is off and this row IS one of the caller's
  // own picks.
  const overlap = (byeOverlapByWeek.get(player.bye_week) || []).filter((p) => p.id !== player.id);
  const queued = queue.some((p) => p.id === player.id);
  return { isDrafted, canManualPick, pickUnavailable, overlap, queued };
}

/** Draft/Queue action row, identical gating logic and shared with the table's action cell. */
function PlayerActions({ player, isDrafted, canManualPick, pickUnavailable, queued, onDraft, onQueue, justify = 'center' }) {
  if (isDrafted) return null;
  return (
    <Stack direction="row" spacing={1} justifyContent={justify} alignItems="center">
      {canManualPick && (
        <Tooltip title={pickUnavailable ? PICK_UNAVAILABLE_EXPLANATION : ''}>
          <span>
            <Button
              variant="contained"
              color="success"
              size="small"
              aria-disabled={pickUnavailable || undefined}
              onClick={() => {
                if (pickUnavailable) return; // suppressed activation
                onDraft(player.id);
              }}
              sx={MIN_TOUCH_TARGET_SX}
            >
              Draft
            </Button>
          </span>
        </Tooltip>
      )}
      <Tooltip title="Queue">
        <span>
          <IconButton
            aria-label="Queue"
            size="small"
            color="default"
            disabled={queued}
            onClick={() => onQueue(player)}
            sx={MIN_TOUCH_TARGET_SX}
          >
            <PlaylistAddIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

/** One player's card on mobile (issue 122): the same approved columns the
 * desktop table shows (Name/Position/NFL Team/Bye/ADP/Pos rank/17-game pace)
 * stacked instead of columned, plus the same state-gated Draft/Queue actions. */
function PlayerCard({ player, isDrafted, canManualPick, pickUnavailable, overlap, queued, onDraft, onQueue, onOpenQuickView }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, mb: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
          <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} />
          <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
          {isDrafted && <Chip size="small" label="Drafted" color="default" />}
        </Box>
        <PositionChip position={player.position} />
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
        <Typography variant="body2" color="text.secondary">{player.nfl_team}</Typography>
        {/* Plain labels, not AbbreviationTooltip: that component adds its own
            focusable (tabIndex=0) hit target, fine once per column header but
            not repeated per stat per card - the Column guide button already
            covers these abbreviations in one reachable place (issue 122). */}
        <Typography variant="body2" sx={numericCellSx}>
          Bye: {player.bye_week != null ? player.bye_week : '-'}
        </Typography>
        {overlap.length > 0 && (
          <Tooltip title={`Also on your roster with this Bye: ${overlap.map((p) => p.name).join(', ')}`}>
            <Chip
              size="small"
              variant="outlined"
              label={overlap.length}
              aria-label={
                `Bye overlap: ${overlap.length} rostered player${overlap.length === 1 ? '' : 's'} `
                + `${overlap.length === 1 ? 'shares' : 'share'} this Bye week - `
                + overlap.map((p) => p.name).join(', ')
              }
            />
          </Tooltip>
        )}
        <Typography variant="body2" sx={numericCellSx}>
          ADP: {player.adp != null ? player.adp : '-'}
        </Typography>
        <Typography variant="body2" sx={numericCellSx}>
          Pos rank: {player.position_rank != null ? `#${player.position_rank}` : '-'}
        </Typography>
        <Typography variant="body2" sx={numericCellSx}>
          17-game pace: {player.projected_points != null ? Number(player.projected_points).toFixed(1) : '-'}
        </Typography>
      </Box>
      <PlayerActions
        player={player}
        isDrafted={isDrafted}
        canManualPick={canManualPick}
        pickUnavailable={pickUnavailable}
        queued={queued}
        onDraft={onDraft}
        onQueue={onQueue}
        justify="flex-start"
      />
    </Paper>
  );
}

/** Filters plus the available-players surface (windowed/infinite-append pool):
 * a sortable table on desktop, readable stacked cards below the medium
 * breakpoint (issue #122 acceptance criterion 4) - the wide table forces
 * horizontal scroll a phone-width screen can't afford. `isMobile` switches
 * both the rendering and how "near the bottom" is measured for pagination,
 * since mobile has no bounded scroll container of its own (the page itself
 * is the one scroll region - see DraftBoard.jsx), while desktop's Paper IS
 * a bounded, focusable scroll region (issue #122 acceptance criterion 1). */
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
  draftStatus,
  draftType,
  isMyTurn,
  draftPaused,
  queue,
  onDraft,
  onQueue,
  onOpenQuickView,
  hasMore,
  loadingMore,
  onLoadMore,
  byeOverlapByWeek = new Map(),
  isMobile = false,
}) {
  const scrollRef = useRef(null);
  const headingId = useId();

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // Mobile has no bounded scroll container of its own - the page scrolls -
  // so pagination watches the window's own scroll position instead of a
  // ref'd element's scrollTop.
  useEffect(() => {
    if (!isMobile) return undefined;
    const onWindowScroll = () => {
      if (!hasMore || loadingMore) return;
      const scrollBottom = window.scrollY + window.innerHeight;
      if (document.documentElement.scrollHeight - scrollBottom < NEAR_BOTTOM_PX) {
        onLoadMore();
      }
    };
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', onWindowScroll);
  }, [isMobile, hasMore, loadingMore, onLoadMore]);

  // Constant across every row in this render - computed once rather than
  // once per displayed player.
  const tableCanManualPick = pickActionExists({ draftStatus, draftType });
  const tablePickUnavailable = tableCanManualPick && pickTemporarilyUnavailable({ isMyTurn, draftPaused });

  const filtersBox = (
    <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography id={headingId} variant="h6" component="h2">Available Players</Typography>
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
            <IconButton
              size="small"
              aria-label="Clear search"
              onClick={() => onSearchInputChange('')}
              sx={{
                // Growing this button's own box to 44x44 (like everywhere
                // else) would grow with it - the small TextField it lives
                // inside as an endAdornment, taller than the Position/Bye
                // week Selects sitting next to it in the same filter row.
                // Keep the visible button MUI's normal small size and
                // expand only the invisible hit area via ::after instead -
                // the WCAG-sanctioned "target offset" technique (SC 2.5.8).
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 44,
                  height: 44,
                },
              }}
            >
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
        sx={MIN_TOUCH_TARGET_SX}
        control={
          <Switch size="small" checked={hideDrafted} onChange={(e) => onHideDraftedChange(e.target.checked)} />
        }
        label="Hide drafted"
      />
      {isMobile && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel id="draft-sort-field-label">Sort by</InputLabel>
            <Select
              labelId="draft-sort-field-label"
              label="Sort by"
              value={sort}
              onChange={(e) => onSort(e.target.value)}
              size="small"
            >
              {SORT_FIELDS.map((field) => (
                <MenuItem key={field.key} value={field.key}>
                  {field.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Tooltip title={dir === 'asc' ? 'Ascending - tap to sort descending' : 'Descending - tap to sort ascending'}>
            <IconButton
              aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
              size="small"
              // Re-selecting the SAME field toggles direction (see
              // usePlayerPool's handleSort) - the same rule the desktop
              // TableSortLabel headers already rely on.
              onClick={() => onSort(sort)}
              sx={MIN_TOUCH_TARGET_SX}
            >
              {dir === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );

  if (isMobile) {
    return (
      <Paper component="section" aria-labelledby={headingId} sx={{ p: 2 }}>
        {filtersBox}
        <Box>
          {displayPlayers.length === 0 && (
            <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 2 }}>
              {search ? `No available players matching “${search}”` : 'No available players'}
            </Typography>
          )}
          {displayPlayers.map((player) => {
            const state = rowStateFor(player, { draftedIds, canManualPickBase: tableCanManualPick, tablePickUnavailable, byeOverlapByWeek, queue });
            return (
              <PlayerCard
                key={player.id}
                player={player}
                {...state}
                onDraft={onDraft}
                onQueue={onQueue}
                onOpenQuickView={onOpenQuickView}
              />
            );
          })}
          {loadingMore && (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}
        </Box>
      </Paper>
    );
  }

  return (
    <Paper
      component="section"
      aria-labelledby={headingId}
      // The named landmark for this region (issue #122 acceptance criterion
      // 1); tabIndex makes it directly reachable by keyboard even though the
      // actual scrolling happens on the TableContainer nested inside it.
      tabIndex={0}
      sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {filtersBox}

      <TableContainer
        ref={scrollRef}
        onScroll={handleScroll}
        tabIndex={0}
        data-testid="players-scroll-region"
        sx={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}
      >
        <Table stickyHeader sx={stripedRowsSx}>
          <TableHead>
            <TableRow>
              <TableCell sx={headCellSx}>
                <TableSortLabel
                  active={sort === 'name'}
                  direction={sort === 'name' ? dir : 'asc'}
                  onClick={() => onSort('name')}
                  sx={MIN_TOUCH_TARGET_SX}
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
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  NFL Team
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'bye_week'}
                  direction={sort === 'bye_week' ? dir : 'asc'}
                  onClick={() => onSort('bye_week')}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <AbbreviationTooltip term="Bye" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'adp'}
                  direction={sort === 'adp' ? dir : 'asc'}
                  onClick={() => onSort('adp')}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <AbbreviationTooltip term="ADP" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'position_rank'}
                  direction={sort === 'position_rank' ? dir : 'asc'}
                  onClick={() => onSort('position_rank')}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <AbbreviationTooltip term="Pos rank" />
                </TableSortLabel>
              </TableCell>
              <TableCell sx={headCellSx} align="right">
                <TableSortLabel
                  active={sort === 'proj'}
                  direction={sort === 'proj' ? dir : 'asc'}
                  onClick={() => onSort('proj')}
                  sx={MIN_TOUCH_TARGET_SX}
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
              const { isDrafted, canManualPick, pickUnavailable, overlap, queued } = rowStateFor(player, {
                draftedIds, canManualPickBase: tableCanManualPick, tablePickUnavailable, byeOverlapByWeek, queue,
              });
              return (
                <TableRow key={player.id}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} />
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
                                + `${overlap.length === 1 ? 'shares' : 'share'} this Bye week - `
                                + overlap.map((p) => p.name).join(', ')
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
                    <PlayerActions
                      player={player}
                      isDrafted={isDrafted}
                      canManualPick={canManualPick}
                      pickUnavailable={pickUnavailable}
                      queued={queued}
                      onDraft={onDraft}
                      onQueue={onQueue}
                    />
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
