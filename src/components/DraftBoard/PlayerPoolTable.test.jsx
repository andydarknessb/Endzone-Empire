import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerPoolTable from './PlayerPoolTable';
import { SORT_KEYS } from './sortFields';

// PlayerPoolTable is provider-free (MUI only, same as DraftRail - see its own
// doc comment), so a bare render is enough here.
const players = [
  { id: 1, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', adp: 1.2, position_rank: 1, projected_points: 310.5, bye_week: 12 },
  { id: 2, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', adp: 3.4, position_rank: 2, projected_points: 400.2, bye_week: 7 },
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

test('desktop renders the sortable table with a focusable, named scroll region', () => {
  render(<PlayerPoolTable {...baseProps} />);

  const region = screen.getByRole('region', { name: 'Available Players' });
  expect(region).toHaveAttribute('tabIndex', '0');
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
  // No player cards on desktop.
  expect(screen.queryByText('Bye: 12')).not.toBeInTheDocument();
});

test('mobile renders player cards (not a table) with the same approved columns', () => {
  render(<PlayerPoolTable {...baseProps} isMobile />);

  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  // Every stat is labeled, including NFL Team - a card has no column header
  // to supply that context implicitly the way the desktop table row does.
  expect(within(card).getByText('NFL Team: ATL')).toBeInTheDocument();
  expect(within(card).getByText('Bye: 12')).toBeInTheDocument();
  expect(within(card).getByText('ADP: 1.2')).toBeInTheDocument();
  expect(within(card).getByText('Pos rank: #1')).toBeInTheDocument();
  expect(within(card).getByText('17-game pace: 310.5')).toBeInTheDocument();
});

test('mobile: a null 17-game pace shows the same explanation as the desktop table, as plain always-visible text', () => {
  const noProj = [{ ...players[0], projected_points: null }];
  render(<PlayerPoolTable {...baseProps} isMobile displayPlayers={noProj} />);

  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  // Consistent with every other missing stat on the card (Bye/ADP/Pos rank
  // all render '-'), not a special-cased word.
  expect(within(card).getByText('17-game pace: -')).toBeInTheDocument();
  // The explanation is plain text, not a hover-only Tooltip on a tabIndex=0
  // span - reachable without hovering, and without an extra tab stop.
  expect(within(card).getByText(
    '17-game pace unavailable: not enough games in the prior completed season to extrapolate a pace.'
  )).toBeInTheDocument();
});

test('mobile cards expose the same state-gated Draft/Queue actions as the table', async () => {
  const user = userEvent.setup();
  render(<PlayerPoolTable {...baseProps} isMobile />);

  const card = screen.getByText('Josh Allen').closest('.MuiPaper-root');
  await user.click(within(card).getByRole('button', { name: 'Draft', exact: true }));
  expect(baseProps.onDraft).toHaveBeenCalledWith(2);

  await user.click(within(card).getByRole('button', { name: 'Queue' }));
  expect(baseProps.onQueue).toHaveBeenCalledWith(players[1]);
});

test('a drafted player is shown without Draft/Queue actions on a mobile card, same as the table', () => {
  render(<PlayerPoolTable {...baseProps} isMobile draftedIds={new Set([1])} />);

  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  expect(within(card).getByText('Drafted')).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Draft', exact: true })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
});

test('mobile: no manual Draft control renders anywhere when the draft has no manual Pick action', () => {
  render(<PlayerPoolTable {...baseProps} isMobile draftType="autopick" />);

  expect(screen.queryByRole('button', { name: 'Draft', exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Queue' })).toHaveLength(players.length);
});

test('mobile: off-turn Draft stays focusable but aria-disabled, matching the table', () => {
  render(<PlayerPoolTable {...baseProps} isMobile isMyTurn={false} />);

  const card = screen.getByText('Bijan Robinson').closest('.MuiPaper-root');
  const draftButton = within(card).getByRole('button', { name: 'Draft', exact: true });
  expect(draftButton).toHaveAttribute('aria-disabled', 'true');
  expect(draftButton).not.toHaveAttribute('disabled');
});

// Cards have no column headers to sort by - mobile keeps the same sort
// capability the desktop table's TableSortLabel headers give via a "Sort by"
// Select plus a direction toggle instead (issue #122 code-review finding:
// the first cut of the mobile layout silently dropped all sort control).

test('desktop renders no "Sort by" control - the table headers already sort', () => {
  render(<PlayerPoolTable {...baseProps} />);

  expect(screen.queryByRole('combobox', { name: 'Sort by' })).not.toBeInTheDocument();
});

test('mobile exposes a "Sort by" control naming every field the desktop headers sort by', async () => {
  const user = userEvent.setup();
  render(<PlayerPoolTable {...baseProps} isMobile />);

  await user.click(screen.getByRole('combobox', { name: 'Sort by' }));

  const optionNames = screen.getAllByRole('option').map((o) => o.textContent);
  expect(optionNames).toEqual(['Name', 'NFL Team', 'Bye', 'ADP', 'Pos rank', '17-game pace']);
});

test('mobile: picking a new sort field calls onSort with that field\'s key', async () => {
  const user = userEvent.setup();
  render(<PlayerPoolTable {...baseProps} isMobile sort="adp" />);

  await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
  await user.click(screen.getByRole('option', { name: 'NFL Team' }));

  expect(baseProps.onSort).toHaveBeenCalledWith('nfl_team');
});

test('mobile: the direction toggle re-invokes onSort with the CURRENT field, matching the toggle-on-repeat rule', async () => {
  const user = userEvent.setup();
  render(<PlayerPoolTable {...baseProps} isMobile sort="adp" dir="asc" />);

  await user.click(screen.getByRole('button', { name: 'Sort direction: ascending. Activate to sort descending.' }));

  expect(baseProps.onSort).toHaveBeenCalledWith('adp');
});

test('mobile: the direction toggle\'s accessible name and visible tooltip always agree, in both directions', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<PlayerPoolTable {...baseProps} isMobile sort="adp" dir="asc" />);

  const ascButton = screen.getByRole('button', { name: 'Sort direction: ascending. Activate to sort descending.' });
  await user.hover(ascButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Sort direction: ascending. Activate to sort descending.');
  await user.unhover(ascButton);

  rerender(<PlayerPoolTable {...baseProps} isMobile sort="adp" dir="desc" />);
  const descButton = screen.getByRole('button', { name: 'Sort direction: descending. Activate to sort ascending.' });
  await user.hover(descButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Sort direction: descending. Activate to sort ascending.');
});

// Issue #211: RIGHT_ALIGNED_SORT_KEYS (in PlayerPoolTable.jsx) decides which
// desktop headers get wrapped in AbbreviationTooltip, and that wrapper is
// what supplies the header's accessible name. A numeric field missing from
// that Set doesn't just render left-aligned - it renders with no definition
// at all for a screen-reader user. A test asserting only that the header
// renders (getByText) can't tell a wrapped header from an unwrapped one,
// since both render the same visible label; asserting the accessible name
// itself is the only check a dropped key actually fails.
test('desktop: every numeric header carries its AbbreviationTooltip accessible name', () => {
  render(<PlayerPoolTable {...baseProps} />);

  const table = screen.getByRole('table');
  expect(within(table).getByRole('button', { name: /^Bye: Bye week:/ })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: /^ADP: Average draft position:/ })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: /^Pos rank: Position rank:/ })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: /^17-game pace: Historical pace:/ })).toBeInTheDocument();
});

// The opposite direction: a key in RIGHT_ALIGNED_SORT_KEYS that ISN'T a
// SORT_FIELDS key. Nothing renders differently for a stray entry - the Set is
// only ever queried with `.has(field.key)` for keys SORT_FIELDS actually
// produces - so no amount of rendering the table can catch it; this reads
// the Set literal straight out of the source instead. (No export was added
// to PlayerPoolTable.jsx to make the Set reachable another way - #211's
// scope is tests and a comment only.)
test('every RIGHT_ALIGNED_SORT_KEYS entry is a real SORT_FIELDS key', () => {
  const source = fs.readFileSync(path.join(__dirname, 'PlayerPoolTable.jsx'), 'utf8');
  const match = source.match(/RIGHT_ALIGNED_SORT_KEYS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  expect(match).not.toBeNull();

  const keys = match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  expect(keys.length).toBeGreaterThan(0);
  keys.forEach((key) => expect(SORT_KEYS).toContain(key));
});
