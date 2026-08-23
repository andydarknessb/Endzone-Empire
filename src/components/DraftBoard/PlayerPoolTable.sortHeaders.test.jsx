import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerPoolTable from './PlayerPoolTable';
import { SORT_FIELDS } from './sortFields';

// Parity guard for issue #163: the desktop table's TableSortLabel headers
// used to hardcode the same six key/label pairs SORT_FIELDS already owns
// (usePlayerPool's `?sort=` validation and the mobile "Sort by" Select both
// read SORT_FIELDS directly). Once the header row is data-driven off
// SORT_FIELDS this test is trivially true; it exists to keep it that way -
// see the two directions asserted below, both driven off the header's
// actual runtime behaviour (which key it invokes onSort with) rather than
// its rendered label text, so a header that LOOKS right but is wired to the
// wrong key still fails it.
const players = [
  { id: 1, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', adp: 1.2, position_rank: 1, projected_points: 310.5, bye_week: 12 },
];

const baseProps = {
  searchInput: '',
  onSearchInputChange: jest.fn(),
  positionFilter: 'All',
  onPositionFilterChange: jest.fn(),
  hideDrafted: false,
  onHideDraftedChange: jest.fn(),
  byeWeeksFilter: [],
  onByeWeeksFilterChange: jest.fn(),
  sort: 'adp',
  dir: 'asc',
  onSort: jest.fn(),
  search: '',
  displayPlayers: players,
  draftedIds: new Set(),
  draftStatus: 'active',
  draftType: 'snake',
  isMyTurn: true,
  draftPaused: false,
  queue: [],
  onDraft: jest.fn(),
  onQueue: jest.fn(),
  onOpenQuickView: jest.fn(),
  hasMore: false,
  loadingMore: false,
  onLoadMore: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

test('every SORT_FIELDS key has exactly one desktop sortable header, and every desktop sortable header is a SORT_FIELDS key', async () => {
  const user = userEvent.setup();
  const onSort = jest.fn();
  render(<PlayerPoolTable {...baseProps} onSort={onSort} />);

  const headerRow = screen.getAllByRole('row')[0];
  const sortButtons = within(headerRow).getAllByRole('button');

  // Activate each rendered sortable header and record the key it actually
  // invokes onSort with - the runtime source of truth, not the visible
  // label text (which can't tell a hand-written duplicate key apart from
  // the SORT_FIELDS-driven one).
  const renderedKeys = [];
  for (const button of sortButtons) {
    onSort.mockClear();
    // eslint-disable-next-line no-await-in-loop
    await user.click(button);
    expect(onSort).toHaveBeenCalledTimes(1);
    renderedKeys.push(onSort.mock.calls[0][0]);
  }

  const expectedKeys = SORT_FIELDS.map((field) => field.key);
  // Exact set comparison, not a "contains" check, in both directions: a key
  // added to SORT_FIELDS with no header shrinks renderedKeys below
  // expectedKeys, and a hardcoded header for a key not in SORT_FIELDS grows
  // renderedKeys past it - either way this fails.
  expect(new Set(renderedKeys)).toEqual(new Set(expectedKeys));
  // Guards against a duplicate header for the same key masking a missing one.
  expect(renderedKeys).toHaveLength(expectedKeys.length);
});

test('every desktop sortable header shows the label SORT_FIELDS assigns its key', () => {
  render(<PlayerPoolTable {...baseProps} />);

  const headerRow = screen.getAllByRole('row')[0];
  const sortButtons = within(headerRow).getAllByRole('button');
  const renderedLabels = sortButtons.map((button) => button.textContent);

  expect(new Set(renderedLabels)).toEqual(new Set(SORT_FIELDS.map((field) => field.label)));
  expect(renderedLabels).toHaveLength(SORT_FIELDS.length);
});
