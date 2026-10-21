import React from 'react';
import { Box, Drawer, Pagination } from '@mui/material';
import { SegmentedControl } from '../../../shared/ui';
import {
  BODY_FONT, Frame, FrameHead, PixelHeading, PsButton,
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
  totalPages, pageNumber, onPage, totalPlayers, search, stickyHead = false,
}) {
  const searchField = (
    <PsField
      label="Search players"
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

  const pager = (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px' }}>
      <Pagination
        count={totalPages}
        page={pageNumber}
        onChange={(event, value) => onPage(value)}
        renderItem={(item) => <PsPageItem item={item} />}
        sx={{ '& ul': { gap: '6px' } }}
      />
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>
        {`${totalPlayers} player${totalPlayers === 1 ? '' : 's'}${search ? ` matching “${search}”` : ''}`}
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

  if (cardLayout) {
    return (
      <>
        {phoneBar}
        {drawer}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {visiblePlayers.length === 0 && empty}
          {visiblePlayers.map((player) => (
            <React.Fragment key={player.id}>{renderRow(player, 'card')}</React.Fragment>
          ))}
        </Box>
        {pager}
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
          tabIndex={0}
          sx={{ overflowX: stickyHead ? { xs: 'auto', lg: 'clip' } : 'auto', position: 'relative', containerType: 'inline-size' }}
        >
          <Box
            component="table"
            aria-label="Players"
            sx={{
              width: '100%',
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
              {visiblePlayers.length === 0 && (
                <tr><Box component="td" colSpan={columnCount} sx={{ padding: 0 }}>{empty}</Box></tr>
              )}
              {visiblePlayers.map((player) => (
                <React.Fragment key={player.id}>{renderRow(player, 'row')}</React.Fragment>
              ))}
            </tbody>
          </Box>
        </Box>
        {pager}
      </Frame>
    </>
  );
}
