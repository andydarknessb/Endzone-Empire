import React from 'react';
import { Box, Drawer, Pagination } from '@mui/material';
import { SegmentedControl } from '../../../shared/ui';
import {
  BODY_FONT, Frame, FrameHead, PixelHeading, PsButton, SR_ONLY_SX, Skel,
} from '../../../shared/ui/playselect';
import {
  PsCheck, PsField, PsIconButton, PsPageItem, PsSelect,
} from './psControls';

const SORT_ICON = 'M3 2h2v9h2v2H5v1H3zM9 2h2v2h2v2H9zM9 7h4v2H9zM9 12h4v2H9z';
const BYE_OPTIONS = [{ value: '', label: 'Any' }, ...Array.from({ length: 18 }, (_, i) => ({ value: String(i + 1), label: `Wk ${i + 1}` }))];

/**
 * The Play-select view of the player pool (ADR 0067 wave 3, boards Waivers and WaiversPhone), drawn
 * by `PlayerPool`. It holds no state of its own: `PlayerPool` owns the reads
 * and the URL params and hands this the values and handlers.
 *
 * Desktop: a primary frame ("Players") with the filter row, the table (sticky Player column, tabular
 * figures) and the pager. From `md` down the filters are a Filters button and a bottom drawer; below
 * the cards breakpoint the rows are cards with no frame around them.
 */
export default function PlayerPoolPlayselect({
  isMobile, cardLayout, filtersOpen, setFiltersOpen,
  searchInput, setSearchInput,
  chips, positionKey, onPosition,
  byeWeekFilter, byeWeek, onBye,
  sort, sortOptions, onSort, dir, onDir,
  watchingOnly, onWatching,
  availabilityLock, availabilityFilter, availabilityOptions, onAvailability,
  leadingControl, afterAvailabilityControl,
  visiblePlayers, renderRow, renderTableHead, columnCount, bestBall, currentWeek, emptyCopy,
  loading, placeholder, showEmpty, showPager,
  totalPages, pageNumber, onPage, topRef, totalPlayers, search, stickyHead = false, regionClipped = false,
}) {
  const searchField = (
    <PsField
      label="Search this list"
      placeholder="Search by name"
      value={searchInput}
      onChange={(event) => setSearchInput(event.target.value)}
      onClear={() => setSearchInput('')}
      clearLabel="Clear search"
      width={isMobile ? undefined : 250}
    />
  );

  const controls = (layout) => {
    const row = layout === 'row';
    const w = (n) => (row ? n : undefined);
    return (
      <>
        {leadingControl?.(layout)}
        <PsSelect
          label="Position"
          value={positionKey}
          onChange={(event) => onPosition(event.target.value)}
          options={chips.map((chip) => ({ value: chip.key, label: chip.key }))}
          width={w(120)}
        />
        {!availabilityLock && (
          <SegmentedControl
            aria-label="Availability"
            options={availabilityOptions}
            value={availabilityFilter}
            onChange={onAvailability}
            scrollable={!row}
          />
        )}
        {afterAvailabilityControl?.(layout)}
        {byeWeekFilter && (
          <PsSelect label="Bye week" value={byeWeek ? String(byeWeek) : ''} onChange={(event) => onBye(event.target.value)} options={BYE_OPTIONS} width={w(120)} />
        )}
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flex: row ? 'none' : 1 }}>
          <PsSelect label="Sort" value={sort} onChange={(event) => onSort(event.target.value)} options={sortOptions.map((o) => ({ value: o.key, label: o.label }))} width={w(170)} />
          <PsIconButton label={`Sort ${dir === 'asc' ? 'ascending' : 'descending'}`} onClick={onDir}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges">
              <path d={SORT_ICON} fill="currentColor" fillRule="evenodd" />
            </svg>
          </PsIconButton>
        </Box>
        <PsCheck label="Watching" checked={watchingOnly} onChange={(event) => onWatching(event.target.checked)} />
      </>
    );
  };

  const filterRow = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 16px', padding: '16px 20px', borderBottom: '2px solid var(--ps-rule)' }}>
      {searchField}
      {controls('row')}
    </Box>
  );

  const empty = (
    <Box component="p" sx={{ m: 0, padding: '20px', fontSize: '16px', fontWeight: 600, textAlign: cardLayout ? 'center' : undefined }}>
      {emptyCopy}
    </Box>
  );

  // The skeleton rows a loading list holds (#3056): Skel blocks, hidden from assistive tech.
  const skeleton = (
    <Box data-testid="player-pool-loading" sx={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 20px' }}>
      {[100, 88, 94, 80, 90, 84].map((pct) => <Skel key={pct} width={`${pct}%`} height={20} />)}
    </Box>
  );

  // The phone pager fits one row: no sibling pages beside the current one (#3058), and a 4px gap so 63 pages fit 360 px (#3088).
  const pager = (
    <Pagination
      count={totalPages}
      page={pageNumber}
      siblingCount={cardLayout ? 0 : 1}
      onChange={(event, value) => onPage(value)}
      renderItem={(item) => <PsPageItem item={item} />}
      sx={{ '& ul': { gap: cardLayout ? '4px' : '6px' } }}
    />
  );
  // The count's status is mounted from the first render and reads its text only while the pager shows (#3067).
  // Past one page it names the page, so a page change is announced; the count alone is the same on every page (#3072).
  // Hidden, the box is out of flow, so it takes no room and no flex gap. The phone footer has no side padding: the
  // page gutter alone leaves the 63-page pager room at 360 px; 16px more wraps it (#3088).
  const footer = (
    <Box sx={showPager ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: cardLayout ? '16px 0' : '16px' } : SR_ONLY_SX}>
      {showPager && pager}
      <Box component="span" role="status" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>
        {showPager ? `${totalPages > 1 ? `Page ${pageNumber} of ${totalPages}, ` : ''}${totalPlayers} player${totalPlayers === 1 ? '' : 's'}${search ? ` matching “${search}”` : ''}` : ''}
      </Box>
    </Box>
  );

  const phoneBar = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start', mb: '16px' }}>
      {searchField}
      <PsButton variant="ghost" onClick={() => setFiltersOpen(true)}>Filters</PsButton>
    </Box>
  );

  const drawer = (
    <Drawer
      anchor="bottom"
      open={filtersOpen}
      onClose={() => setFiltersOpen(false)}
      className="ps-root"
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'player-filters-heading',
        sx: {
          border: '6px double var(--ps-frame)', borderRadius: 0, fontFamily: BODY_FONT, backgroundColor: 'var(--ps-panel)', color: 'var(--ps-ink)', backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{ padding: '12px 14px', borderBottom: '2px solid var(--ps-rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <PixelHeading id="player-filters-heading" size={16}>Player filters</PixelHeading>
        <PsButton variant="ghost" onClick={() => setFiltersOpen(false)}>Done</PsButton>
      </Box>
      <Box sx={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>{controls('column')}</Box>
    </Drawer>
  );

  // The list's top (#3057): a pager press focuses the list element itself, since an extra element would take a
  // flex gap (24px in PlayerManagement). scrollMarginTop keeps the rounded scroll from landing just above the edge.
  if (cardLayout) {
    return (
      <>
        {phoneBar}
        {drawer}
        <Box ref={topRef} role="region" aria-label="Players" data-testid="player-pool-top" tabIndex={-1} aria-busy={loading} sx={{ display: 'flex', flexDirection: 'column', gap: '10px', scrollMarginTop: '8px' }}>
          {placeholder && skeleton}
          {showEmpty && empty}
          {visiblePlayers.map((player) => (
            <React.Fragment key={player.id}>{renderRow(player, 'card')}</React.Fragment>
          ))}
        </Box>
        {footer}
      </>
    );
  }

  return (
    <>
      {isMobile && phoneBar}
      {drawer}
      <Frame labelledBy="player-pool-heading" head={<FrameHead><PixelHeading id="player-pool-heading">Players</PixelHeading></FrameHead>}>
        {!isMobile && filterRow}
        <Box
          role="region"
          aria-label="Players, scrollable"
          // A tab stop only where it scrolls: not where stickyHead clips it from lg (#3058).
          tabIndex={regionClipped ? undefined : 0}
          // The table's focus ring is drawn here: the region's overflow clips the table's own outline (#3072).
          sx={{
            overflowX: stickyHead ? { xs: 'auto', lg: 'clip' } : 'auto', position: 'relative', containerType: 'inline-size',
            '&:has(> table:focus-visible)': { outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)' },
          }}
        >
          <Box
            component="table"
            ref={topRef}
            data-testid="player-pool-top"
            tabIndex={-1}
            aria-label="Players"
            aria-busy={loading}
            sx={{
              width: '100%',
              scrollMarginTop: '8px',
              // Off here, so the region's ring stands alone; && outranks .ps-root :focus-visible (#3072).
              '&&:focus-visible': { outline: 'none', boxShadow: 'none' },
              borderCollapse: 'separate',
              borderSpacing: 0,
              minWidth: '950px',
              tableLayout: 'fixed',
              // stickyHead: from lg the region stops scrolling (clip, above) and the head sticks to the viewport
              // top. The player-row head takes no sx, so the rule is here; zIndex 2 stacks the head's first cell (already
              // sticky left, zIndex 1) above the body's sticky Player column.
              ...(stickyHead && { '@media (min-width:1200px)': { '& thead th': { position: 'sticky', top: 0, zIndex: 2 } } }),
            }}
          >
            <thead>{renderTableHead({ bestBall, currentWeek })}</thead>
            <tbody>
              {placeholder && (
                <tr><Box component="td" colSpan={columnCount} sx={{ padding: 0 }}>{skeleton}</Box></tr>
              )}
              {showEmpty && (
                <tr><Box component="td" colSpan={columnCount} sx={{ padding: 0 }}>{empty}</Box></tr>
              )}
              {visiblePlayers.map((player) => (
                <React.Fragment key={player.id}>{renderRow(player, 'row')}</React.Fragment>
              ))}
            </tbody>
          </Box>
        </Box>
        {footer}
      </Frame>
    </>
  );
}
