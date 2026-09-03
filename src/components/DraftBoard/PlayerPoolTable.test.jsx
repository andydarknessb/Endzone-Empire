import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerPoolTable from './PlayerPoolTable';
import { PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';

// PlayerPoolTable is provider-free (MUI only, same as DraftRail - see its own
// doc comment), so a bare render is enough here.
const players = [
  { id: 1, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', adp: 1.2, position_rank: 1, projected_points: 310.5, bye_week: 12 },
  { id: 2, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', adp: 3.4, position_rank: 2, projected_points: 400.2, bye_week: 7 },
];

// The pool's own filter/sort/search/paging controls all arrive inside one
// `controls` object now (issue #792 ruling 1), and the three draft facts the
// table used to key on arrive folded into `pickState` (ruling 3). These
// factories build fresh mocks per render so a test can assert exactly which
// callback the control it drove invoked; `renderTable` returns the props it
// rendered with so the assertions read off the same object.
function makeControls(over = {}) {
  return {
    searchInput: '',
    setSearchInput: jest.fn(),
    search: '',
    positionFilter: 'All',
    onPositionFilterChange: jest.fn(),
    hideDrafted: false,
    setHideDrafted: jest.fn(),
    byeWeeksFilter: [],
    onByeWeeksFilterChange: jest.fn(),
    sort: 'adp',
    dir: 'asc',
    onSort: jest.fn(),
    hasMore: false,
    loadingMore: false,
    loadMore: jest.fn(),
    ...over,
  };
}

function makePickState(over = {}) {
  // Default: a live snake draft, the viewer's turn - a manual Pick both exists
  // and is usable. pickUnavailable true is "off-turn or paused"; canManualPick
  // false is "no manual Pick action in this draft at all".
  return {
    canManualPick: true,
    pickUnavailable: false,
    explanation: PICK_UNAVAILABLE_EXPLANATION,
    ...over,
  };
}

function makeProps({ controls, pickState, ...rest } = {}) {
  return {
    players,
    controls: makeControls(controls),
    draftedIds: new Set(),
    pickState: makePickState(pickState),
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

function renderTable(overrides) {
  const props = makeProps(overrides);
  const utils = render(<PlayerPoolTable {...props} />);
  return { ...utils, props };
}

// The mobile layout renders each player as a `listitem` inside the
// "Available players" list, so the card is reachable by role. A listitem takes
// no name from its contents, so the one holding a given player is picked out
// by querying inside each item rather than by traversing the DOM.
function playerCard(name) {
  const list = screen.getByRole('list', { name: 'Available players' });
  const card = within(list)
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name));
  if (!card) throw new Error(`No player card found for ${name}`);
  return card;
}

afterEach(() => {
  jest.clearAllMocks();
});

// The whole point of #792: the panel owns its controls, and its DECLARED
// contract is exactly eleven props. This reads Object.keys(propTypes), so adding
// a key to the propTypes declaration (or dropping/renaming one) turns it red; it
// keeps the declaration honest. It does NOT tie the declaration to the
// signature - a twelfth prop added only to the destructure and left undeclared
// stays green (eslint-config-react-app does not enable react/prop-types).
test('the table declares exactly its eleven-prop interface via propTypes (#792 ruling 2)', () => {
  // Reading the component's own propTypes is the whole point of the assertion
  // (issue #792 AC3): it is the single declared place the eleven-prop contract
  // lives, so adding/dropping a propTypes key turns this red.
  // forbid-foreign-prop-types guards against reading ANOTHER component's
  // propTypes at runtime; here it is this component's own contract, read in a
  // test that never ships to production.
  // eslint-disable-next-line react/forbid-foreign-prop-types
  expect(Object.keys(PlayerPoolTable.propTypes).sort()).toEqual([
    'byeOverlapByWeek',
    'controls',
    'draftedIds',
    'headerAction',
    'isMobile',
    'onDraft',
    'onOpenQuickView',
    'onQueue',
    'pickState',
    'players',
    'queue',
  ]);
});

test('desktop keeps draft metrics visible in a compact seven-column table', () => {
  renderTable();

  const region = screen.getByRole('region', { name: 'Available Players' });
  expect(region).toHaveAttribute('tabIndex', '0');
  const scrollRegion = screen.getByTestId('players-scroll-region');
  expect(scrollRegion).toHaveAttribute('tabIndex', '0');

  const table = screen.getByRole('table', { name: 'Available Players' });
  expect(within(table).getAllByRole('columnheader')).toHaveLength(7);
  expect(within(table).queryByRole('columnheader', { name: 'NFL Team' })).not.toBeInTheDocument();
  for (const name of ['Name', 'Position', 'Bye', 'ADP', 'Pos rank', '17-game pace', 'Actions']) {
    expect(within(table).getByRole('columnheader', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
  }

  const bijanRow = within(table).getByRole('row', { name: /Bijan Robinson.*ATL/ });
  expect(within(bijanRow).getByText('· ATL')).toBeInTheDocument();
  expect(bijanRow).toHaveStyle({ height: '44px' });
  // No player cards on desktop.
  expect(screen.queryByText('Bye: 12')).not.toBeInTheDocument();
});

test('Hide drafted is a filter checkbox', () => {
  renderTable({ controls: { hideDrafted: true } });

  expect(screen.getByRole('checkbox', { name: 'Hide drafted' })).toBeChecked();
});

test('mobile renders player cards (not a table) with the same approved columns', () => {
  renderTable({ isMobile: true });

  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  const card = playerCard('Bijan Robinson');
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
  renderTable({ isMobile: true, players: noProj });

  const card = playerCard('Bijan Robinson');
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
  const { props } = renderTable({ isMobile: true });

  const card = playerCard('Josh Allen');
  await user.click(within(card).getByRole('button', { name: 'Draft', exact: true }));
  expect(props.onDraft).toHaveBeenCalledWith(2);

  await user.click(within(card).getByRole('button', { name: 'Queue' }));
  expect(props.onQueue).toHaveBeenCalledWith(players[1]);
});

test('a drafted player is shown without Draft/Queue actions on a mobile card, same as the table', () => {
  renderTable({ isMobile: true, draftedIds: new Set([1]) });

  const card = playerCard('Bijan Robinson');
  expect(within(card).getByText('Drafted')).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Draft', exact: true })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
});

test('mobile: no manual Draft control renders anywhere when the draft has no manual Pick action', () => {
  // canManualPick false is the "no manual Pick action in this draft at all"
  // reading the room derives once (an autopick/offline/pending/complete draft).
  renderTable({ isMobile: true, pickState: { canManualPick: false } });

  expect(screen.queryByRole('button', { name: 'Draft', exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Queue' })).toHaveLength(players.length);
});

test('mobile: off-turn Draft stays focusable but aria-disabled, matching the table', () => {
  // A manual Pick exists but is only temporarily unavailable (off-turn/paused).
  renderTable({ isMobile: true, pickState: { pickUnavailable: true } });

  const card = playerCard('Bijan Robinson');
  const draftButton = within(card).getByRole('button', { name: 'Draft', exact: true });
  expect(draftButton).toHaveAttribute('aria-disabled', 'true');
  expect(draftButton).not.toHaveAttribute('disabled');
});

test('off-turn, the Draft button surfaces the shared explanation as its tooltip text', async () => {
  // #792 folded the explanation from a module-constant import into a threaded
  // prop (pickState.explanation -> the `explanation` prop). Every existing
  // off-turn test asserts only aria-disabled, so a future edit that dropped the
  // thread would blank the tooltip title and lose the accessible explanation
  // while staying green. This asserts the TEXT actually reaches the tooltip, so
  // an empty title fails it (verified by mutation while writing this).
  const user = userEvent.setup();
  renderTable({ pickState: { pickUnavailable: true } });

  const draftButton = within(screen.getByRole('table', { name: 'Available Players' }))
    .getAllByRole('button', { name: 'Draft', exact: true })[0];
  expect(draftButton).toHaveAttribute('aria-disabled', 'true');
  await user.hover(draftButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(PICK_UNAVAILABLE_EXPLANATION);
});

// Cards have no column headers to sort by - mobile keeps the same sort
// capability the desktop table's TableSortLabel headers give via a "Sort by"
// Select plus a direction toggle instead (issue #122 code-review finding:
// the first cut of the mobile layout silently dropped all sort control).

test('desktop renders no "Sort by" control - the table headers already sort', () => {
  renderTable();

  expect(screen.queryByRole('combobox', { name: 'Sort by' })).not.toBeInTheDocument();
});

test('mobile exposes a "Sort by" control naming every field the desktop headers sort by', async () => {
  const user = userEvent.setup();
  renderTable({ isMobile: true });

  await user.click(screen.getByRole('combobox', { name: 'Sort by' }));

  const optionNames = screen.getAllByRole('option').map((o) => o.textContent);
  expect(optionNames).toEqual(['Name', 'NFL Team', 'Bye', 'ADP', 'Pos rank', '17-game pace']);
});

test('mobile: picking a new sort field calls onSort with that field\'s key', async () => {
  const user = userEvent.setup();
  const { props } = renderTable({ isMobile: true, controls: { sort: 'adp' } });

  await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
  await user.click(screen.getByRole('option', { name: 'NFL Team' }));

  expect(props.controls.onSort).toHaveBeenCalledWith('nfl_team');
});

test('mobile: the direction toggle re-invokes onSort with the CURRENT field, matching the toggle-on-repeat rule', async () => {
  const user = userEvent.setup();
  const { props } = renderTable({ isMobile: true, controls: { sort: 'adp', dir: 'asc' } });

  await user.click(screen.getByRole('button', { name: 'Sort direction: ascending. Activate to sort descending.' }));

  expect(props.controls.onSort).toHaveBeenCalledWith('adp');
});

test('mobile: the direction toggle\'s accessible name and visible tooltip always agree, in both directions', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<PlayerPoolTable {...makeProps({ isMobile: true, controls: { sort: 'adp', dir: 'asc' } })} />);

  const ascButton = screen.getByRole('button', { name: 'Sort direction: ascending. Activate to sort descending.' });
  await user.hover(ascButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Sort direction: ascending. Activate to sort descending.');
  await user.unhover(ascButton);

  rerender(<PlayerPoolTable {...makeProps({ isMobile: true, controls: { sort: 'adp', dir: 'desc' } })} />);
  const descButton = screen.getByRole('button', { name: 'Sort direction: descending. Activate to sort ascending.' });
  await user.hover(descButton);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Sort direction: descending. Activate to sort ascending.');
});

// ---------------------------------------------------------------------------
// Table-owned behaviour moved down from DraftBoard.test.jsx (issue #792 ruling
// 5): these assert the pool panel's own rendering and control contract, so they
// belong to the panel's own suite rather than the room's. Each drives the same
// input its full-room ancestor did - a rendered players array, a header click,
// a Bye-week selection, a draftedIds membership - and asserts the panel's real
// output (a column set, an onSort/onByeWeeksFilterChange call, a hidden action),
// not merely the visible consequence a room render happened to show.
// ---------------------------------------------------------------------------

test('the desktop columns are exactly Name/Position/Bye/ADP/Pos rank/17-game pace/Actions', () => {
  renderTable();

  const table = screen.getByRole('table', { name: 'Available Players' });
  // Render index, Draft value, and Tier are all absent from this table.
  expect(within(table).queryByText(/^#$/)).not.toBeInTheDocument();
  expect(within(table).queryByText('Draft value')).not.toBeInTheDocument();
  expect(within(table).queryByText('Tier')).not.toBeInTheDocument();
  expect(within(table).queryByText('Season Proj')).not.toBeInTheDocument();

  for (const label of ['Name', 'Position', 'ADP', '17-game pace', 'Actions']) {
    expect(within(table).getByText(label)).toBeInTheDocument();
  }
  expect(within(table).queryByRole('columnheader', { name: 'NFL Team' })).not.toBeInTheDocument();
  // NFL Team rides inline in the name cell rather than as a column of its own.
  expect(within(table).getByText(/· ATL/)).toBeInTheDocument();
  // Bye and Pos rank headers carry their AbbreviationTooltip aria-label
  // (asserted precisely in the sortHeaders suite) rather than a plain text node.
  expect(within(table).getByRole('button', { name: /^Bye:/ })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: /^Pos rank:/ })).toBeInTheDocument();
});

test('the Bye-weeks multi-select filters across the pool and renders removable chips', async () => {
  const user = userEvent.setup();
  // Filters across the pool: selecting a Bye week drives the real multi-select
  // onChange mapping and hands the chosen week(s) to the pool's filter callback
  // (the hook is what then sorts/dedupes and refetches - covered in
  // usePlayerPool.test.js, which is where that server call actually lives now).
  const { props, unmount } = renderTable();
  await user.click(screen.getByLabelText('Bye week'));
  await user.click(await screen.findByRole('option', { name: 'Week 9' }));
  expect(props.controls.onByeWeeksFilterChange).toHaveBeenCalledWith([9]);
  unmount();

  // Renders removable chips for the weeks already in effect.
  renderTable({ controls: { byeWeeksFilter: [6, 9] } });
  expect(screen.getByText('Bye 6')).toBeInTheDocument();
  expect(screen.getByText('Bye 9')).toBeInTheDocument();
});

test('shows a neutral Bye overlap hint for a candidate sharing a Bye with a rostered player', () => {
  const poolPlayers = [
    { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC', bye_week: 10 },
    { id: 2, name: 'No Overlap Guy', position: 'RB', nfl_team: 'DAL', bye_week: 6 },
  ];
  // The room builds this Map from the caller's own roster (a KC player, Travis
  // Kelce, on Bye 10); the table renders it against a candidate sharing that
  // week. That Map, keyed by week, is exactly the input the table consumes.
  const byeOverlapByWeek = new Map([[10, [{ id: 99, name: 'Travis Kelce' }]]]);
  renderTable({ players: poolPlayers, byeOverlapByWeek });

  const overlapHint = screen.getByLabelText(/Bye overlap: 1 rostered player.*Travis Kelce/);
  expect(overlapHint).toBeInTheDocument();
  // No overlap for the other row (different Bye week).
  expect(
    within(screen.getByRole('row', { name: /No Overlap Guy/ })).queryByLabelText(/Bye overlap/)
  ).not.toBeInTheDocument();
  // Neutral: no "conflict"/"risk"/"warning" language anywhere near the hint.
  expect(overlapHint.getAttribute('aria-label')).not.toMatch(/conflict|risk|warning/i);
});

test('shows a sortable Pos rank column so IDP players (no ADP) still order sensibly', async () => {
  const user = userEvent.setup();
  const idp = [
    // An IDP player: no ADP by design, ranked from last season's points.
    { id: 3, name: 'Jordyn Brooks', position: 'LB', nfl_team: 'DET', adp: null, position_rank: 1, projected_points: 160.2 },
    { id: 4, name: 'Rookie Backer', position: 'LB', nfl_team: 'DAL', adp: null, position_rank: null, projected_points: null },
  ];
  const { props } = renderTable({ players: idp });

  expect(screen.getByText('#1')).toBeInTheDocument();
  expect(screen.getByLabelText(/Pos rank: Position rank:/)).toBeInTheDocument();

  // Clicking the header hands the server's whitelisted sort key straight to the
  // pool's onSort (the hook maps it into the /api/players call - see
  // usePlayerPool.test.js).
  await user.click(screen.getByRole('button', { name: /^Pos rank:/ }));
  expect(props.controls.onSort).toHaveBeenCalledWith('position_rank');
});

test('shows each pool player\'s bye week, with an em dash when the schedule is unknown', () => {
  const poolPlayers = [
    { id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC', adp: 12.1, position_rank: 1, projected_points: 380.5, bye_week: 10 },
    { id: 2, name: 'Rookie Backer', position: 'LB', nfl_team: 'DAL', adp: null, position_rank: null, projected_points: null, bye_week: null },
  ];
  renderTable({ players: poolPlayers });

  expect(screen.getByText('Bye')).toBeInTheDocument();
  expect(within(screen.getByRole('row', { name: /Patrick Mahomes/ })).getByText('10')).toBeInTheDocument();
  const rookieCells = within(screen.getByRole('row', { name: /Rookie Backer/ })).getAllByText('-');
  expect(rookieCells.length).toBeGreaterThan(0);
});

test('an already-drafted pool row hides both Draft and Queue entirely, keeping only the Drafted chip', () => {
  // draftedIds membership is the trigger; a manual Pick otherwise exists and is
  // usable (default pickState), so the row hides its actions on being drafted,
  // not because the draft has no Pick action.
  renderTable({ draftedIds: new Set([1]) });

  const table = screen.getByRole('table', { name: 'Available Players' });
  const row = within(table).getByRole('row', { name: /Bijan Robinson/ });
  // The name stays a quick-view button even for a drafted row.
  expect(within(row).getByRole('button', { name: 'Bijan Robinson' })).toBeInTheDocument();
  expect(within(row).getByText('Drafted')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Queue' })).not.toBeInTheDocument();
});

test('the Column guide is a keyboard-reachable dialog explaining abbreviations and injury-status codes', async () => {
  const user = userEvent.setup();
  renderTable();

  await user.click(screen.getByRole('button', { name: 'Column guide' }));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Column guide')).toBeInTheDocument();
  expect(within(dialog).getByText('17-game pace')).toBeInTheDocument();
  expect(within(dialog).getByText('IR')).toBeInTheDocument();
  expect(within(dialog).getByText('Injured Reserve')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
