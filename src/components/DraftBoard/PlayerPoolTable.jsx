import React, { useId, useRef, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import {
  Box,
  Stack,
  FormControl,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { visuallyHidden } from '@mui/utils';
import {
  Frame, InjuryTag, PixelHeading, PosTag, PsButton, SR_ONLY_SX, Tag,
} from '../../shared/ui/playselect';
import { FieldLabel, FIELD_SX, MENU_PAPER } from '../../shared/ui/playselect/CardControls';
import { PsCheck, PsField, PsIconButton } from '../../widgets/player-pool/ui/psControls';
// Direct file import (#1311, draft-harness-coverage guard) - see DraftRail.jsx's
// identical comment: the entities/player barrel would pull usePlayerCard's
// non-literal apiClient.get call into the Draft room's import closure.
import PlayerNameLink from '../../entities/player/ui/PlayerNameLink';
import { STAT_DEFINITIONS, ABBREVIATION_STYLE } from '../../shared/ui/AbbreviationTooltip';
import ColumnGuide from './ColumnGuide';
import { SORT_FIELDS, SORT_FIELDS_BY_KEY, DESKTOP_COLUMNS, DESKTOP_COLUMN_COUNT } from './sortFields';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { chipsForRosterSlots } from '../../shared/lib/positionChips';
import { draftCursorPlayerId } from './draftCursor';

// A caller that doesn't thread `controls.chips` through (an older test double,
// or a future caller with no roster template of its own) gets the full
// canonical chip set - chipsForRosterSlots' own no-template fallback (#1420) -
// rather than this table re-declaring a menu of its own. Computed once at
// module load, not per render: chipsForRosterSlots([]) is pure and constant.
const DEFAULT_CHIPS = chipsForRosterSlots([]);

// The real NFL regular season a Bye can fall in (mirrors REG_SEASON_WEEKS in
// server/services/bye.service.js) — every selectable option in the multi-select
// below, whether or not any team actually has a bye there this season; an
// empty result for an unused week is a normal, honest "no match", not a bug.
const BYE_WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);

// SORT_FIELDS drives both the mobile "Sort by" Select below and the desktop
// table's TableSortLabel header row (issue 122 acceptance criterion 4:
// mobile keeps the full sort capability, not a stripped-down view of it; issue
// #163: the desktop headers used to hardcode this same key/label pairing a
// second time, free to drift from usePlayerPool's `?sort=` URL validation -
// see sortFields.js for why the list lives there instead of here) so all
// three - validation, the mobile select, and the desktop headers - read one
// list and can't drift apart again.
//
// Which columns are numeric (right-aligned, with a label:definition accessible
// name and a hover/focus tooltip - the same STAT_DEFINITIONS-keyed pattern
// AbbreviationTooltip supplies everywhere else in this table, built inline in
// SortableHeaderCell rather than by nesting an AbbreviationTooltip inside it,
// because that nesting gave every numeric header two Tab stops instead of one:
// AbbreviationTooltip's own focusable span nested inside the header's
// already-focusable TableSortLabel, issue #212) is now the `numeric` flag each
// SORT_FIELDS entry carries (issue #951), read as `field.numeric` in
// SortableHeaderCell. It used to be a separate hand-maintained
// right-aligned-keys Set here that nothing kept in step with SORT_FIELDS -
// a numeric field missing from it rendered a bare abbreviation with no
// definition for a screen-reader user, silently (issue #211). sortFields.test.js
// now pins every numeric entry to a STAT_DEFINITIONS term through the module's
// own interface.

// Applies to every numeric column (Bye, ADP, Pos rank, 17-game pace): fixed-
// width digit glyphs so a column of numbers lines up instead of drifting with
// each digit's natural width.
const numericCellSx = { fontVariantNumeric: 'tabular-nums' };

// The pool is a Play-select table: Ink text on the panel, a 2px Ink rule under the head and a 2px
// Rule under every row, Archivo 14 with tabular figures.
const headCellSx = {
  color: 'var(--ps-ink)',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 700,
  bgcolor: 'var(--ps-panel)',
  borderBottom: '2px solid var(--ps-ink)',
  px: '5px',
};
const bodyCellSx = {
  color: 'var(--ps-ink)', fontFamily: 'inherit', fontSize: '14px', borderBottom: '2px solid var(--ps-rule)',
};
const dimSx = { color: 'var(--ps-dim)', fontSize: '14px' };

// Desktop table buttons are 36px: ADR 0067's dense-table exception (the rail and the phone cards
// keep 44px). PsButton sets its own 44px, so this wrapper's selector, one class more specific,
// lowers it.
const DENSE_ACTIONS_SX = {
  '& [data-variant]': {
    minHeight: '36px', minWidth: '36px', padding: '0 8px', fontSize: '14px',
  },
  '& [data-variant][aria-label="Queue"]': { padding: 0 },
};

// The cursor's frame: a 3px Accent edge the kit's .cursor blink flashes. A stickyHeader table is
// border-collapse: separate, where a row's own border never paints, so the row carries only the
// colour and its cells carry the edges (the Players page's table does the same).
const CURSOR_SX = { border: '3px solid var(--ps-accent)' };
const CURSOR_ROW_SX = { borderColor: 'var(--ps-accent)' };
const CURSOR_NOTE = 'Your next pick: the first player in your queue, or the best available';
const cursorCellSx = (i) => ({
  borderTop: '3px solid',
  borderBottom: '3px solid',
  ...(i === 0 ? { borderLeft: '3px solid' } : null),
  ...(i === LAST_COLUMN ? { borderRight: '3px solid' } : null),
  // After the side shorthands, which would reset their colour.
  borderColor: 'inherit',
});
// The Actions cell is the last column; the cursor frame closes its right edge there.
const LAST_COLUMN = DESKTOP_COLUMN_COUNT - 1;
const cellSx = (isCursor, i, extra) => ({ ...bodyCellSx, ...extra, ...(isCursor ? cursorCellSx(i) : null) });

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

/** One desktop sortable column header, driven off a single SORT_FIELDS entry
 * (issue #163) - active/direction/onSort/touch-target behaviour identical to
 * what the six hardcoded headers had. Numeric columns (field.numeric)
 * right-align and carry the same label:definition accessible name and
 * hover/focus tooltip AbbreviationTooltip supplies everywhere else in this
 * table (issue #211); Name shows its label plain, same as before.
 *
 * The definition is built inline off STAT_DEFINITIONS rather than by nesting
 * an AbbreviationTooltip inside this header's own TableSortLabel (issue
 * #212): AbbreviationTooltip's definition span carries its own tabIndex=0,
 * and nesting it inside TableSortLabel's already-focusable button gave every
 * numeric header two Tab stops instead of one. Wrapping the WHOLE
 * TableSortLabel in a Tooltip keeps the tooltip reachable from that single
 * focusable control instead of dropping it from the tab order - the same
 * trap #211 was about, just moved rather than fixed.
 *
 * numericAriaLabel is passed to TableSortLabel itself, NOT left to
 * name-from-content, and NOT left to MUI's Tooltip to fill in on its own -
 * two code-review findings on this issue, both about where an aria-label
 * ends up winning:
 *
 * 1. Wrapping TableSortLabel in <Tooltip title={definition}> without an
 *    explicit aria-label on TableSortLabel does NOT fall back to computing
 *    the name from content. MUI's Tooltip (describeChild default: false)
 *    itself injects `aria-label: title` onto whatever it clones, UNLESS
 *    the child already carries its own aria-label prop (children.props is
 *    spread after Tooltip's own props, so an explicit one wins) - so
 *    omitting it here doesn't restore content-based naming, it just hands
 *    the override to Tooltip's own auto-injected (and prefix-less) one
 *    instead of this component's.
 * 2. Whichever aria-label wins completely replaces the computed name -
 *    content is never consulted once aria-label is present - so a STATIC
 *    aria-label (just "label: definition", independent of active/direction)
 *    silently discards the sibling "sorted ascending"/"sorted descending"
 *    text below for exactly these four headers. That's the same kind of
 *    silent loss #211 was about, moved from the definition onto the
 *    direction announcement. numericAriaLabel is built to include the
 *    direction phrase whenever this header is active, so there is nothing
 *    left for it to silently discard.
 *
 * The hidden direction Box still renders unconditionally by `active` (not
 * gated on `alignRight`) so its DOM presence stays a single, uniform rule
 * across every header - for Name (no aria-label anywhere in its
 * header) it's what makes the direction reach the name via ordinary
 * name-from-content; for the numeric headers it's redundant with
 * numericAriaLabel already saying so, not a second, divergent source of
 * truth for whether the direction is announced.
 *
 * The active column also carries aria-sort - TableCell's sortDirection prop
 * (MUI renders aria-sort="ascending"/"descending" when it's 'asc'/'desc' and
 * omits the attribute entirely, rather than writing aria-sort="none", when
 * it's false) - following the MUI table-sorting example pattern (this
 * repo's own visuallyHidden convention - see Countdown.jsx and
 * ReadinessAnnouncer.jsx) for the hidden text. */
function SortableHeaderCell({ field, sort, dir, onSort }) {
  const alignRight = field.numeric;
  const active = sort === field.key;
  const direction = active ? dir : 'asc';
  const definition = STAT_DEFINITIONS[field.label];
  const sortStatusText = active ? (direction === 'desc' ? 'sorted descending' : 'sorted ascending') : null;
  const numericAriaLabel = `${field.label}: ${definition || field.label}${sortStatusText ? `, ${sortStatusText}` : ''}`;

  const sortLabel = (
    <TableSortLabel
      active={active}
      direction={direction}
      onClick={() => onSort(field.key)}
      sx={{
        ...MIN_TOUCH_TARGET_SX,
        color: 'inherit',
        '&:hover, &.Mui-active': { color: 'inherit' },
        '& .MuiTableSortLabel-icon': { color: 'inherit !important' },
      }}
      {...(alignRight ? { 'aria-label': numericAriaLabel } : {})}
    >
      {alignRight ? (
        <Box
          component="span"
          sx={{ ...ABBREVIATION_STYLE }}
        >
          {field.label}
        </Box>
      ) : (
        field.label
      )}
      {sortStatusText && (
        <Box component="span" sx={visuallyHidden}>
          {sortStatusText}
        </Box>
      )}
    </TableSortLabel>
  );

  return (
    <TableCell sx={headCellSx} align={alignRight ? 'right' : undefined} sortDirection={active ? dir : false}>
      {alignRight ? (
        <Tooltip title={definition || field.label} arrow>
          {sortLabel}
        </Tooltip>
      ) : (
        sortLabel
      )}
    </TableCell>
  );
}

/** Draft/Queue action row, identical gating logic and shared with the table's
 * action cell. The one shared explanation for a temporarily-unavailable Pick
 * arrives as `explanation` from the room's `pickState` (issue #792 ruling 3),
 * so this file no longer imports pickAvailability itself. */
function PlayerActions({
  player, isDrafted, canManualPick, pickUnavailable, explanation, queued, onDraft, onQueue, isCursor, dense = false, justify = 'center',
}) {
  if (isDrafted) return null;
  return (
    <Stack direction="row" spacing={1} justifyContent={justify} alignItems="center" sx={dense ? DENSE_ACTIONS_SX : undefined}>
      {canManualPick && (
        <Tooltip title={pickUnavailable ? explanation : ''}>
          <span>
            <PsButton
              variant={isCursor ? 'fill' : 'ghost'}
              aria-disabled={pickUnavailable || undefined}
              onClick={() => {
                if (pickUnavailable) return; // suppressed activation
                onDraft(player.id);
              }}
            >
              Draft
            </PsButton>
          </span>
        </Tooltip>
      )}
      <Tooltip title="Queue">
        <span>
          <PsButton variant="ghost" ariaLabel="Queue" disabled={queued} onClick={() => onQueue(player)}>
            <PlaylistAddIcon fontSize="small" />
          </PsButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

/** Bye-overlap count: a neutral roster fact, so a plain Tag, not a warning. */
function ByeOverlapTag({ overlap }) {
  const names = overlap.map((p) => p.name).join(', ');
  return (
    <Tooltip title={`Also on your roster with this Bye: ${names}`}>
      <span>
        <Tag
          aria-label={
            `Bye overlap: ${overlap.length} rostered player${overlap.length === 1 ? '' : 's'} `
            + `${overlap.length === 1 ? 'shares' : 'share'} this Bye week - ${names}`
          }
        >
          {overlap.length}
        </Tag>
      </span>
    </Tooltip>
  );
}

/** One player's card on mobile (issue 122): the desktop facts, including its
 * inline NFL team, stacked into labeled fields plus the same state-gated
 * Draft/Queue actions. */
function PlayerCard({
  player, isDrafted, canManualPick, pickUnavailable, explanation, overlap, queued, isCursor, onDraft, onQueue, onOpenQuickView,
}) {
  return (
    <Box
      role="listitem"
      className={isCursor ? 'cursor' : undefined}
      sx={{
        p: 1.5, mb: 1.5, display: 'flex', flexDirection: 'column', gap: 1, border: '2px solid var(--ps-rule)', ...(isCursor ? CURSOR_SX : null),
      }}
    >
      {isCursor && <Box component="span" sx={SR_ONLY_SX}>{CURSOR_NOTE}</Box>}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
          <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} />
          <InjuryTag status={player.injury_status} title={player.injury_detail || undefined} />
          {isDrafted && <Tag>Drafted</Tag>}
        </Box>
        <PosTag position={player.position} />
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
        {/* Every stat here is labeled, including NFL Team. The desktop name
            cell gives the team enough context inline; card layout needs an
            explicit label (QA finding: a screen reader read a bare "ATL"
            with no context). Plain labels, not AbbreviationTooltip: that
            component adds its own focusable (tabIndex=0) hit target, fine
            once per column header but not repeated per stat per card - the
            Column guide button already covers these abbreviations in one
            reachable place (issue 122). */}
        <Box component="span" sx={{ ...dimSx, fontSize: '15px' }}>NFL Team: {player.nfl_team}</Box>
        <Box component="span" sx={{ ...numericCellSx, fontSize: '15px' }}>
          Bye: {player.bye_week != null ? player.bye_week : '-'}
        </Box>
        {overlap.length > 0 && <ByeOverlapTag overlap={overlap} />}
        <Box component="span" sx={{ ...numericCellSx, fontSize: '15px' }}>
          ADP: {player.adp != null ? player.adp : '-'}
        </Box>
        <Box component="span" sx={{ ...numericCellSx, fontSize: '15px' }}>
          Pos rank: {player.position_rank != null ? `#${player.position_rank}` : '-'}
        </Box>
        <Box component="span" sx={{ ...numericCellSx, fontSize: '15px' }}>
          17-game pace: {player.projected_points != null ? Number(player.projected_points).toFixed(1) : '-'}
        </Box>
      </Box>
      {player.projected_points == null && (
        // Same explanation the desktop table's null-pace tooltip gives (QA
        // finding: the card dropped it entirely), but as plain, always-
        // visible text rather than a Tooltip: a hover-only explanation on a
        // generic <span> both needs its own tabIndex=0 stop (which the
        // comment above rejects AbbreviationTooltip for doing, once per
        // stat, for this exact reason) and isn't reliably announced (a
        // role-less element isn't a valid aria-label target under ARIA 1.2).
        // Plain text sidesteps all of that and reaches every user, sighted
        // or not, without hovering - which is also strictly better than the
        // desktop cell's hover-gated version.
        <Box component="span" sx={dimSx}>
          17-game pace unavailable: not enough games in the prior completed season to extrapolate a pace.
        </Box>
      )}
      <PlayerActions
        player={player}
        isDrafted={isDrafted}
        canManualPick={canManualPick}
        pickUnavailable={pickUnavailable}
        explanation={explanation}
        queued={queued}
        onDraft={onDraft}
        onQueue={onQueue}
        isCursor={isCursor}
        justify="flex-start"
      />
    </Box>
  );
}

/** Filters plus the available-players surface (windowed/infinite-append pool):
 * a sortable table on desktop, readable stacked cards below the medium
 * breakpoint (issue #122 acceptance criterion 4) - the wide table forces
 * horizontal scroll a phone-width screen can't afford. `isMobile` switches
 * both the rendering and how "near the bottom" is measured for pagination,
 * since mobile has no bounded scroll container of its own (the page itself
 * is the one scroll region - see DraftBoard.jsx), while desktop's Frame IS
 * a bounded, focusable scroll region (issue #122 acceptance criterion 1). */
function PlayerPoolTable({
  players,
  controls,
  draftedIds,
  pickState,
  queue,
  onDraft,
  onQueue,
  onOpenQuickView,
  byeOverlapByWeek = new Map(),
  isMobile = false,
  headerAction = null,
}) {
  // Everything the pool's own filter/sort/search/paging controls need arrives
  // in one `controls` object the room threads straight through (issue #792
  // ruling 1); the room reads none of these itself.
  const {
    searchInput,
    setSearchInput,
    search,
    positionFilter,
    onPositionFilterChange,
    chips = DEFAULT_CHIPS,
    hideDrafted,
    setHideDrafted,
    byeWeeksFilter,
    onByeWeeksFilterChange,
    sort,
    dir,
    onSort,
    hasMore,
    loadingMore,
    loadMore,
  } = controls;
  // Whether a manual Pick exists in this draft at all, whether it is only
  // temporarily unavailable right now, and the one shared explanation for that -
  // derived once by the room from pickAvailability.js and shared with the queue
  // rail and Quick View (issue #792 ruling 3), so this table no longer imports
  // pickAvailability or takes the four raw draft facts it used to key on.
  const {
    canManualPick, pickUnavailable, explanation, onTheClock,
  } = pickState;
  // The room's one cursor (spec #2432): the first queued player still on screen, else the first row.
  const cursorId = draftCursorPlayerId({
    onTheClock: !!onTheClock,
    canPick: !!canManualPick && !pickUnavailable,
    queue,
    rows: players.map((p) => ({ id: p.id, isDrafted: draftedIds.has(p.id) })),
  });
  const scrollRef = useRef(null);
  const headingId = useId();

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      loadMore();
    }
  }, [hasMore, loadingMore, loadMore]);

  // Mobile has no bounded scroll container of its own - the page scrolls -
  // so pagination watches the window's own scroll position instead of a
  // ref'd element's scrollTop.
  useEffect(() => {
    if (!isMobile) return undefined;
    const onWindowScroll = () => {
      if (!hasMore || loadingMore) return;
      const scrollBottom = window.scrollY + window.innerHeight;
      if (document.documentElement.scrollHeight - scrollBottom < NEAR_BOTTOM_PX) {
        loadMore();
      }
    };
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', onWindowScroll);
  }, [isMobile, hasMore, loadingMore, loadMore]);

  // Single source of truth for the mobile sort-direction toggle's visible
  // Tooltip AND accessible name - see the comment at its usage below.
  const sortDirectionLabel = dir === 'asc'
    ? 'Sort direction: ascending. Activate to sort descending.'
    : 'Sort direction: descending. Activate to sort ascending.';

  const filtersBox = (
    <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap', flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, width: '100%' }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <PixelHeading id={headingId} size={16}>Available Players</PixelHeading>
          <ColumnGuide />
        </Stack>
        {headerAction}
      </Box>
      {/* The pool's own filter, named apart from the Nav bar's global player search (issue #123
          acceptance criterion 6): this narrows the available players already on screen; that one
          looks up any player in the league's world. */}
      <PsField
        label="Filter available"
        placeholder="Filter by name…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        onClear={() => setSearchInput('')}
        clearLabel="Clear filter"
        width={190}
      />
      <FormControl sx={{ width: 100, gap: '6px' }}>
        <FieldLabel id="draft-position-filter-label">Position</FieldLabel>
        <Select
          labelId="draft-position-filter-label"
          value={positionFilter}
          onChange={(e) => onPositionFilterChange(e.target.value)}
          sx={FIELD_SX}
          MenuProps={{ PaperProps: MENU_PAPER }}
        >
          {/* One entry per distinct starting slot key the draft's own roster template carries,
              canonical order, with group chips (DL/LB/DB) in place of granular defender codes
              (#1420) - the same chipsForRosterSlots derivation the Players page chip menu reuses
              (#1419), never a second hand-kept position list. */}
          {chips.map((chip) => (
            <MenuItem key={chip.key} value={chip.key}>{chip.key}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl sx={{ width: 190, gap: '6px' }}>
        <FieldLabel id="draft-bye-filter-label">Bye week</FieldLabel>
        <Select
          labelId="draft-bye-filter-label"
          multiple
          value={byeWeeksFilter}
          onChange={(e) => {
            const { value } = e.target;
            onByeWeeksFilterChange(typeof value === 'string' ? value.split(',').map(Number) : value);
          }}
          // Chosen weeks wrap, so the field grows past 44px instead of cutting them off.
          sx={{
            ...FIELD_SX,
            height: 'auto',
            minHeight: '44px',
            '& .MuiSelect-select.MuiSelect-select.MuiSelect-select': { ...FIELD_SX['& .MuiSelect-select.MuiSelect-select.MuiSelect-select'], height: 'auto', minHeight: '44px' },
          }}
          MenuProps={{ PaperProps: MENU_PAPER }}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, py: 0.5 }}>
              {selected.map((week) => (
                <Tag key={week}>
                  <span>{`Bye ${week}`}</span>
                  {/* A real button, so a keyboard user can Tab to it and remove the week. The
                      Select opens on Enter, Space and the arrows and on mouse down, so the button
                      keeps those from reaching it. */}
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Remove Bye ${week}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onClick={() => onByeWeeksFilterChange(selected.filter((w) => w !== week))}
                    sx={{
                      border: 0, background: 'none', color: 'inherit', font: 'inherit', padding: 0, ml: '6px', minWidth: '20px', cursor: 'pointer',
                    }}
                  >
                    <span aria-hidden="true">×</span>
                  </Box>
                </Tag>
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
      <PsCheck label="Hide drafted" checked={hideDrafted} onChange={(e) => setHideDrafted(e.target.checked)} />
      {isMobile && (
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5 }}>
          <FormControl sx={{ minWidth: 160, gap: '6px' }}>
            <FieldLabel id="draft-sort-field-label">Sort by</FieldLabel>
            <Select
              labelId="draft-sort-field-label"
              // No fallback needed here (QA correction to the prior round): usePlayerPool validates
              // `?sort=` against this same field list at the source, so `sort` is guaranteed to
              // always name a real field by the time it reaches this Select - guarding again at
              // this layer would let the Select display a DIFFERENT field than what's in effect.
              value={sort}
              onChange={(e) => onSort(e.target.value)}
              sx={FIELD_SX}
              MenuProps={{ PaperProps: MENU_PAPER }}
            >
              {SORT_FIELDS.map((field) => (
                <MenuItem key={field.key} value={field.key}>
                  {field.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {/* One string drives both the visible Tooltip and the accessible name (QA finding: they
              used to disagree), so they cannot diverge again. Neither says "tap" - the control is
              present up to the medium breakpoint, including keyboard/mouse laptop widths. */}
          <Tooltip title={sortDirectionLabel}>
            {/* Re-selecting the SAME field toggles direction (see usePlayerPool's handleSort) - the
                same rule the desktop TableSortLabel headers already rely on. */}
            <span>
              <PsIconButton label={sortDirectionLabel} onClick={() => onSort(sort)}>
                {dir === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
              </PsIconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
  );

  if (isMobile) {
    return (
      <Frame labelledBy={headingId} sx={{ p: 2 }}>
        {filtersBox}
        {players.length === 0 ? (
          <Box sx={{ ...dimSx, fontSize: '15px', textAlign: 'center', py: 2 }}>
            {search ? `No available players matching “${search}”` : 'No available players'}
          </Box>
        ) : (
          // A real list, not a bare stack of boxes (QA finding): browse-mode
          // screen readers announce a count and each item's position ("N of
          // M") the same way the desktop table's rows did implicitly. role
          // + aria-label rather than a semantic <ul>/<li> (this repo's own
          // established pattern - see StatCardList in PlayerQuickView.jsx and
          // RankingTable.jsx): WebKit drops the list accessibility mapping
          // for a <ul> styled list-style: none, and VoiceOver - the primary
          // screen reader on the mobile layout this exists for - honors the
          // explicit role regardless of styling.
          <Box role="list" aria-label="Available players">
            {players.map((player) => {
              const state = rowStateFor(player, { draftedIds, canManualPickBase: canManualPick, tablePickUnavailable: pickUnavailable, byeOverlapByWeek, queue });
              return (
                <PlayerCard
                  key={player.id}
                  player={player}
                  {...state}
                  explanation={explanation}
                  isCursor={player.id === cursorId}
                  onDraft={onDraft}
                  onQueue={onQueue}
                  onOpenQuickView={onOpenQuickView}
                />
              );
            })}
          </Box>
        )}
        {loadingMore && (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <CircularProgress size={20} sx={{ color: 'var(--ps-ink)' }} />
          </Box>
        )}
      </Frame>
    );
  }

  return (
    <Frame
      labelledBy={headingId}
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
        <Table
          stickyHeader
          size="small"
          aria-labelledby={headingId}
          sx={{ '& .MuiTableCell-body': { px: '5px', py: 0 }, fontVariantNumeric: 'tabular-nums' }}
        >
          <TableHead>
            <TableRow>
              {/* The header row maps DESKTOP_COLUMNS - the FULL desktop column
                  sequence, sortable and non-sortable alike - in its own fixed
                  order (issue #951), each sortable column looked up by key
                  rather than by SORT_FIELDS' array position, so reordering
                  SORT_FIELDS (its order only has to stay meaningful for the
                  mobile "Sort by" Select) can't silently reorder these headers
                  out of step with the TableBody's own column sequence below.

                  Position and Actions are the two non-sortable columns. Each
                  now carries its OWN index in DESKTOP_COLUMNS rather than
                  riding on a neighbour: Position used to render as a side
                  effect of hitting the 'name' key, so reordering the sortable
                  keys dragged Position along with name and desynced it from the
                  body's Position cell on a green suite (issue #1003). */}
              {DESKTOP_COLUMNS.map((column) => (
                column.sortKey ? (
                  <SortableHeaderCell
                    key={column.sortKey}
                    field={SORT_FIELDS_BY_KEY[column.sortKey]}
                    sort={sort}
                    dir={dir}
                    onSort={onSort}
                  />
                ) : (
                  <TableCell key={column.label} sx={headCellSx} align={column.align}>
                    {column.label}
                  </TableCell>
                )
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {players.length === 0 && (
              <TableRow>
                <TableCell colSpan={DESKTOP_COLUMN_COUNT} sx={{ ...bodyCellSx, color: 'var(--ps-dim)', textAlign: 'center' }}>
                  {search ? `No available players matching “${search}”` : 'No available players'}
                </TableCell>
              </TableRow>
            )}
            {players.map((player) => {
              const { isDrafted, canManualPick: rowCanManualPick, pickUnavailable: rowPickUnavailable, overlap, queued } = rowStateFor(player, {
                draftedIds, canManualPickBase: canManualPick, tablePickUnavailable: pickUnavailable, byeOverlapByWeek, queue,
              });
              const isCursor = player.id === cursorId;
              return (
                <TableRow
                  key={player.id}
                  className={isCursor ? 'cursor' : undefined}
                  sx={{ height: 44, ...(isCursor ? CURSOR_ROW_SX : null) }}
                >
                  <TableCell sx={cellSx(isCursor, 0, { whiteSpace: 'nowrap' })}>
                    {isCursor && <Box component="span" sx={SR_ONLY_SX}>{CURSOR_NOTE}</Box>}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
                      <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} />
                      <Box component="span" sx={dimSx}>
                        · {player.nfl_team || 'FA'}
                      </Box>
                      <InjuryTag status={player.injury_status} title={player.injury_detail || undefined} />
                      {isDrafted && <Tag>Drafted</Tag>}
                    </Box>
                  </TableCell>
                  <TableCell sx={cellSx(isCursor, 1)}>
                    <PosTag position={player.position} />
                  </TableCell>
                  <TableCell align="right" sx={cellSx(isCursor, 2, numericCellSx)}>
                    {player.bye_week != null ? (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <span>{player.bye_week}</span>
                        {overlap.length > 0 && <ByeOverlapTag overlap={overlap} />}
                      </Stack>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell align="right" sx={cellSx(isCursor, 3, numericCellSx)}>{player.adp != null ? player.adp : '-'}</TableCell>
                  <TableCell align="right" sx={cellSx(isCursor, 4, numericCellSx)}>
                    {player.position_rank != null ? `#${player.position_rank}` : '-'}
                  </TableCell>
                  <TableCell align="right" sx={cellSx(isCursor, 5, numericCellSx)}>
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
                  <TableCell align="center" sx={cellSx(isCursor, 6)}>
                    <PlayerActions
                      player={player}
                      isDrafted={isDrafted}
                      canManualPick={rowCanManualPick}
                      pickUnavailable={rowPickUnavailable}
                      explanation={explanation}
                      queued={queued}
                      onDraft={onDraft}
                      onQueue={onQueue}
                      isCursor={isCursor}
                      dense
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {loadingMore && (
              <TableRow>
                <TableCell colSpan={DESKTOP_COLUMN_COUNT} sx={{ ...bodyCellSx, textAlign: 'center', py: 2 }}>
                  <CircularProgress size={20} sx={{ color: 'var(--ps-ink)' }} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Frame>
  );
}

// The pool panel's declared contract, eleven props (issue #792 ruling 2): the
// fifteen filter/sort/search/paging fields ride inside `controls` and the four
// draft facts inside `pickState`, so a new filter or a new pick rule never
// widens this list. This declaration is what the sibling keys test
// (PlayerPoolTable.test.jsx) pins: it reads Object.keys(propTypes), so adding a
// key here (or dropping/renaming one) is what turns it red - it keeps the
// DECLARATION honest, not the destructure. It cannot catch a twelfth prop that
// is only added to the signature and left undeclared: eslint-config-react-app
// does not enable react/prop-types (see DraftRail.jsx - ~30 props, no propTypes,
// lint clean). Of these, only the eight top-level isRequired props warn at
// dev time when a caller omits one; the fifteen `controls` and three
// `pickState` fields are optional inside their shapes, so a missing loadMore or
// explanation warns about nothing (the tooltip-text tests in the two suites are
// what actually guard the threaded explanation).
PlayerPoolTable.propTypes = {
  players: PropTypes.arrayOf(PropTypes.object).isRequired,
  controls: PropTypes.shape({
    searchInput: PropTypes.string,
    setSearchInput: PropTypes.func,
    search: PropTypes.string,
    positionFilter: PropTypes.string,
    onPositionFilterChange: PropTypes.func,
    chips: PropTypes.arrayOf(PropTypes.shape({
      key: PropTypes.string,
      positions: PropTypes.arrayOf(PropTypes.string),
    })),
    hideDrafted: PropTypes.bool,
    setHideDrafted: PropTypes.func,
    byeWeeksFilter: PropTypes.arrayOf(PropTypes.number),
    onByeWeeksFilterChange: PropTypes.func,
    sort: PropTypes.string,
    dir: PropTypes.string,
    onSort: PropTypes.func,
    hasMore: PropTypes.bool,
    loadingMore: PropTypes.bool,
    loadMore: PropTypes.func,
  }).isRequired,
  draftedIds: PropTypes.instanceOf(Set).isRequired,
  pickState: PropTypes.shape({
    canManualPick: PropTypes.bool,
    pickUnavailable: PropTypes.bool,
    explanation: PropTypes.string,
    // The room's isMyTurn: only the viewer's own turn carries the cursor (spec #2432).
    onTheClock: PropTypes.bool,
  }).isRequired,
  queue: PropTypes.arrayOf(PropTypes.object).isRequired,
  onDraft: PropTypes.func.isRequired,
  onQueue: PropTypes.func.isRequired,
  onOpenQuickView: PropTypes.func.isRequired,
  byeOverlapByWeek: PropTypes.instanceOf(Map),
  isMobile: PropTypes.bool,
  headerAction: PropTypes.node,
};

export default PlayerPoolTable;
