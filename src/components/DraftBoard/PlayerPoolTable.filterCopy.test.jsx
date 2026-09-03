import React from 'react';
import { render, screen } from '@testing-library/react';
import PlayerPoolTable from './PlayerPoolTable';

// Issue #123 acceptance criterion 6: the pool's own text box is named
// Filter available, so it is not mistaken for the Nav bar's global player
// search. Two controls named "Search" on one page is the ambiguity this
// resolves - the browser suite had already been forced to work around it
// with an exact-match name lookup.
// The pool's filter/sort/search/paging controls ride inside one `controls`
// object now (issue #792 ruling 1); `searchInput` is the only field these copy
// tests vary, so the helper takes a `controls` override and defaults the rest.
function makeProps({ controls, ...rest } = {}) {
  return {
    players: [],
    controls: {
      searchInput: '',
      setSearchInput: jest.fn(),
      search: '',
      positionFilter: 'ALL',
      onPositionFilterChange: jest.fn(),
      hideDrafted: true,
      setHideDrafted: jest.fn(),
      byeWeeksFilter: [],
      onByeWeeksFilterChange: jest.fn(),
      sort: 'adp',
      dir: 'asc',
      onSort: jest.fn(),
      hasMore: false,
      loadingMore: false,
      loadMore: jest.fn(),
      ...controls,
    },
    draftedIds: new Set(),
    pickState: { canManualPick: true, pickUnavailable: false, explanation: '' },
    queue: [],
    onDraft: jest.fn(),
    onQueue: jest.fn(),
    onOpenQuickView: jest.fn(),
    byeOverlapByWeek: new Map(),
    isMobile: false,
    headerAction: null,
    ...rest,
  };
}

test('the pool filter is labelled Filter available, not Search', () => {
  render(<PlayerPoolTable {...makeProps()} />);

  expect(screen.getByRole('textbox', { name: 'Filter available' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument();
});

test('its clear button names the same act the field does', () => {
  render(<PlayerPoolTable {...makeProps({ controls: { searchInput: 'kelce' } })} />);

  expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
});

test('the mobile card layout is labelled the same way', () => {
  render(<PlayerPoolTable {...makeProps({ isMobile: true })} />);

  expect(screen.getByRole('textbox', { name: 'Filter available' })).toBeInTheDocument();
});
