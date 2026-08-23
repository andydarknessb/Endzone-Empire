import React from 'react';
import { render, screen } from '@testing-library/react';
import PlayerPoolTable from './PlayerPoolTable';

// Issue #123 acceptance criterion 6: the pool's own text box is named
// Filter available, so it is not mistaken for the Nav bar's global player
// search. Two controls named "Search" on one page is the ambiguity this
// resolves - the browser suite had already been forced to work around it
// with an exact-match name lookup.
const baseProps = {
  searchInput: '',
  onSearchInputChange: jest.fn(),
  positionFilter: 'ALL',
  onPositionFilterChange: jest.fn(),
  hideDrafted: true,
  onHideDraftedChange: jest.fn(),
  byeWeeksFilter: [],
  onByeWeeksFilterChange: jest.fn(),
  sort: 'adp',
  dir: 'asc',
  onSort: jest.fn(),
  search: '',
  displayPlayers: [],
  draftedIds: new Set(),
  draftStatus: 'active',
  draftType: 'snake',
  isMyTurn: false,
  draftPaused: false,
  queue: [],
  onDraft: jest.fn(),
  onQueue: jest.fn(),
  onOpenQuickView: jest.fn(),
  hasMore: false,
  loadingMore: false,
  onLoadMore: jest.fn(),
  byeOverlapByWeek: new Map(),
};

test('the pool filter is labelled Filter available, not Search', () => {
  render(<PlayerPoolTable {...baseProps} />);

  expect(screen.getByRole('textbox', { name: 'Filter available' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument();
});

test('its clear button names the same act the field does', () => {
  render(<PlayerPoolTable {...baseProps} searchInput="kelce" />);

  expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
});

test('the mobile card layout is labelled the same way', () => {
  render(<PlayerPoolTable {...baseProps} isMobile />);

  expect(screen.getByRole('textbox', { name: 'Filter available' })).toBeInTheDocument();
});
