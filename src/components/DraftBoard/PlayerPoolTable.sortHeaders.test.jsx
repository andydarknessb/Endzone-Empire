import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerPoolTable from './PlayerPoolTable';
import { SORT_FIELDS, SORT_KEYS } from './sortFields';
import { STAT_DEFINITIONS } from '../common/AbbreviationTooltip';

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

// Mirrors the TableBody's own fixed column sequence in PlayerPoolTable.jsx
// (Name, [Position], NFL Team, Bye, ADP, Pos rank, 17-game pace, [Actions]) -
// deliberately a LITERAL here, not derived from SORT_FIELDS. SORT_FIELDS'
// own array order only needs to stay meaningful for the mobile "Sort by"
// Select (its order is presented there) and must be free to change for that
// reason without moving desktop columns - PlayerPoolTable.jsx looks each
// desktop header up by key for exactly this reason (issue #163 code-review
// finding). Comparing against SORT_FIELDS' order here instead of this
// literal would silently re-impose the coupling that fix removed: someone
// reordering SORT_FIELDS for the mobile Select would see this test go red,
// "fix" it by reordering the header call sites to match, and desync the
// headers from the TableBody's own separate, untouched literal - green
// suite, scrambled table.
const EXPECTED_COLUMN_ORDER = ['name', 'nfl_team', 'bye_week', 'adp', 'position_rank', 'proj'];

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
  // Set comparison for MEMBERSHIP, not order: SORT_FIELDS' own array order
  // only needs to stay meaningful for the mobile "Sort by" Select and must
  // be free to change without this assertion caring. Both directions: a key
  // added to SORT_FIELDS with no header shrinks renderedKeys below
  // expectedKeys, and a hardcoded header for a key not in SORT_FIELDS grows
  // renderedKeys past it - either way this fails.
  expect(new Set(renderedKeys)).toEqual(new Set(expectedKeys));
  // Guards against a duplicate header for the same key masking a missing one
  // (same Set size, different multiset).
  expect(renderedKeys).toHaveLength(expectedKeys.length);

  // Column ORDER is a separate concern from membership above, asserted
  // against the fixed EXPECTED_COLUMN_ORDER literal rather than SORT_FIELDS'
  // order - see that constant's comment for why. This is what actually
  // catches a transposition (e.g. two SortableHeaderCell call sites swapped)
  // that a Set comparison can't.
  expect(renderedKeys).toEqual(EXPECTED_COLUMN_ORDER);
});

test('every desktop sortable header shows the label SORT_FIELDS assigns its key, in the fixed column order', () => {
  render(<PlayerPoolTable {...baseProps} />);

  const headerRow = screen.getAllByRole('row')[0];
  const sortButtons = within(headerRow).getAllByRole('button');
  const renderedLabels = sortButtons.map((button) => button.textContent);

  // Labels the fixed column order implies, looked up from SORT_FIELDS BY KEY
  // rather than by SORT_FIELDS' own array position - same reasoning as
  // EXPECTED_COLUMN_ORDER above: this must stay green if SORT_FIELDS is
  // reordered for the mobile Select alone, and red only if a header's actual
  // key or label is wrong for its fixed column position.
  const sortFieldsByKey = Object.fromEntries(SORT_FIELDS.map((field) => [field.key, field]));
  const expectedLabels = EXPECTED_COLUMN_ORDER.map((key) => sortFieldsByKey[key].label);
  expect(renderedLabels).toEqual(expectedLabels);
});

// Code-review finding (issue #211): AbbreviationTooltip isn't decoration on
// these four numeric headers - its aria-label IS the header's accessible
// name (the plain-text `label` prop the header shows visually is the same
// string either way, so a header silently missing its tooltip wrapper would
// look correct here and still lose its definition for a screen-reader user).
// RIGHT_ALIGNED_SORT_KEYS in PlayerPoolTable.jsx isn't derived from
// SORT_FIELDS, so this asserts the four current entries directly rather than
// trying to derive the set.
test('every numeric desktop sort header keeps its AbbreviationTooltip accessible name', () => {
  render(<PlayerPoolTable {...baseProps} />);

  const headerRow = screen.getAllByRole('row')[0];
  ['Bye', 'ADP', 'Pos rank', '17-game pace'].forEach((term) => {
    const expectedName = `${term}: ${STAT_DEFINITIONS[term]}`;
    expect(within(headerRow).getByRole('button', { name: expectedName })).toBeInTheDocument();
  });
});

// The other direction of the same #211 drift: a key added to
// RIGHT_ALIGNED_SORT_KEYS that ISN'T a SORT_FIELDS key. Nothing renders
// differently for a stray entry - the Set is only ever read via
// `.has(field.key)` for keys SORT_FIELDS actually produces, so no amount of
// rendering the table (including the test above) can catch it. This reads
// the Set literal straight out of the source instead of exporting it -
// #211's scope is tests and a comment only, no production change beyond the
// comment. The extraction pulls every quoted string token out of the
// captured region rather than splitting on commas, so it isn't thrown by
// reordering, multiline formatting, or a trailing per-entry comment in this
// file's own dense-comment style (e.g. `'bye_week', // Bye`) - a comma-split
// approach would mangle a comment into the next entry and fail for reasons
// that have nothing to do with the actual invariant.
test('every RIGHT_ALIGNED_SORT_KEYS entry is a real SORT_FIELDS key', () => {
  const source = fs.readFileSync(path.join(__dirname, 'PlayerPoolTable.jsx'), 'utf8');
  const setLiteral = source.match(/RIGHT_ALIGNED_SORT_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  expect(setLiteral).not.toBeNull();

  const stringLiteral = /'([^']*)'|"([^"]*)"/g;
  const keys = [];
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = stringLiteral.exec(setLiteral[1])) !== null) {
    keys.push(match[1] !== undefined ? match[1] : match[2]);
  }

  expect(keys.length).toBeGreaterThan(0);
  keys.forEach((key) => expect(SORT_KEYS).toContain(key));
});
