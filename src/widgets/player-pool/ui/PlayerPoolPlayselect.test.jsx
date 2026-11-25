/* eslint-disable testing-library/no-node-access -- the Play-select look is asserted by its class and markup (.cursor, MUI roots), which have no role */
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';
import PlayerPool from './PlayerPool';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
jest.mock('../../../hooks/useLeague', () => ({ useLeague: jest.fn() }));

// ADR 0067 wave 3: the Play-select pool.
const player = {
  id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs', availability: { state: 'waivers' }, projWeek: { week: 3, points: 22.4 }, ros: { points: 210.5 }, weeks: [], ownership: null, upgrade: null, watching: false,
};
const head = () => <tr><th>Player</th></tr>;
const row = (p) => <tr data-testid="ps-row"><td>{p.name}</td></tr>;
const renderPool = (props = {}) => renderWithProviders(
  <PlayerPool leagueId="1" columnCount={1} renderTableHead={head} renderRow={row} {...props} />,
);
// Spec #3094: a probe beside the list shows the URL the page wrote.
const Where = () => <span data-testid="where">{useLocation().search}</span>;
const renderAt = (route, props = {}) => renderWithProviders(
  <><PlayerPool leagueId="1" columnCount={1} renderTableHead={head} renderRow={row} {...props} /><Where /></>,
  { route },
);
const urlParams = () => new URLSearchParams(screen.getByTestId('where').textContent);
const reads = () => apiClient.get.mock.calls.filter(([url]) => url === '/api/players');

beforeEach(() => {
  useLeague.mockReturnValue({ league: { id: 1 }, loading: false, error: null });
  apiClient.get.mockResolvedValue({ data: { players: [player], totalPages: 1, total: 1, context: null } });
});
afterEach(() => jest.clearAllMocks());

test('a Players frame, native labelled controls, a Play-select pager and the same reads', async () => {
  renderPool({ availabilityLock: 'waivers', byeWeekFilter: true });
  await screen.findByText('Patrick Mahomes');
  expect(screen.getByRole('heading', { name: 'Players' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Search this list' })).toBeInTheDocument();
  ['Position', 'Bye week', 'Sort'].forEach((name) => expect(screen.getByRole('combobox', { name })).toBeInTheDocument());
  expect(screen.getByRole('checkbox', { name: 'Watching' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'page 1' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('1 player')).toBeInTheDocument();
  expect(document.querySelector('.MuiTextField-root')).toBeNull();
  expect(reads()[0][1].params).toMatchObject({ availability: 'waivers', leagueId: 1 });
});

test('a control writes the URL params the dash controls do', async () => {
  renderPool();
  await screen.findByText('Patrick Mahomes');
  fireEvent.change(screen.getByRole('combobox', { name: 'Position' }), { target: { value: 'QB' } });
  await waitFor(() => expect(reads().at(-1)[1].params).toMatchObject({ position: 'QB', page: 1 }));
});

// Spec #3094: an empty read under a position filter names it, offers Reset, and draws no pager; the count stays for assistive tech.
test('an empty read with a position filter names it, offers Reset, and draws no pager', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1, total: 0, context: null } });
  renderAt('/?pos=WR');
  expect(await screen.findByText('No players found in WR')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 players');
});

// Spec #3094: a caller's empty copy holds only with no filter and no search; otherwise the copy names the filters.
test('a caller\'s empty copy holds until a filter or search is applied', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1, total: 0, context: null } });
  const { unmount } = renderAt('/', { emptyCopy: 'No players are on waivers' });
  expect(await screen.findByText('No players are on waivers')).toBeInTheDocument();
  unmount();

  renderAt('/?pos=WR', { emptyCopy: 'No players are on waivers' });
  expect(await screen.findByText('No players found in WR')).toBeInTheDocument();
  expect(screen.queryByText('No players are on waivers')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 players');
});

test('a search with a filter names both in the empty copy and the count', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1, total: 0, context: null } });
  renderAt('/?pos=WR&q=jo');
  expect(await screen.findByText('No players matching “jo” in WR')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('0 players matching “jo”');
});

// Spec #3094: a page empty only because of Watching keeps its pager.
test('a page empty only because of Watching keeps its pager', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [player], totalPages: 3, total: 60, context: null } });
  renderAt('/?watching=true&page=2');
  expect(await screen.findByText('No watched players on this page')).toBeInTheDocument();
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});

// Spec #2453: the Players page opts into the dash pool's `stickyHead`; Waivers does not.
test('stickyHead changes the scroll region and the table markup, and without it they are as before', async () => {
  const { unmount } = renderPool();
  await screen.findByText('Patrick Mahomes');
  const plain = { region: screen.getByRole('region', { name: 'Players, scrollable' }).className, table: screen.getByRole('table', { name: 'Players' }).className };
  unmount();

  renderPool({ stickyHead: true });
  await screen.findByText('Patrick Mahomes');
  expect(screen.getByRole('region', { name: 'Players, scrollable' }).className).not.toBe(plain.region);
  expect(screen.getByRole('table', { name: 'Players' }).className).not.toBe(plain.table);
});

// #3072: with more than one page the count names the page, so a page change reads out (the status text is the same otherwise).
test('the count names the page once there is more than one', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [player], totalPages: 3, total: 25, context: null } });
  renderPool();
  await screen.findByText('Patrick Mahomes');
  expect(screen.getByRole('status').textContent).toBe('Page 1 of 3, 25 players');
  fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Page 2 of 3, 25 players'));
});

// #3057: the pager moves focus to the list top once the page param is written; the filters do not.
test('pressing Go to page 2 focuses the list top, and changing Position leaves focus on the select', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [player], totalPages: 3, total: 25, context: null } });
  renderPool();
  await screen.findByText('Patrick Mahomes');
  fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
  await waitFor(() => expect(reads().at(-1)[1].params).toMatchObject({ page: 2 }));
  expect(screen.getByTestId('player-pool-top')).toHaveFocus();

  const position = screen.getByRole('combobox', { name: 'Position' });
  position.focus();
  fireEvent.change(position, { target: { value: 'QB' } });
  await waitFor(() => expect(reads().at(-1)[1].params).toMatchObject({ position: 'QB' }));
  expect(position).toHaveFocus();
});

// #3057: pressing the page already shown changes no page, so it moves no focus.
test('pressing the page already shown moves no focus', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [player], totalPages: 3, total: 25, context: null } });
  renderPool();
  await screen.findByText('Patrick Mahomes');
  fireEvent.click(screen.getByRole('button', { name: 'page 1' }));
  expect(screen.getByTestId('player-pool-top')).not.toHaveFocus();
});

// #3058: a phone width (every media query matches) draws the Filters button, and its drawer is a named dialog.
test('at a phone width, Filters opens a dialog named Player filters', async () => {
  window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  try {
    renderPool();
    await screen.findByText('Patrick Mahomes');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Player filters' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  } finally {
    delete window.matchMedia;
  }
});

// #3067: the count's status is mounted from the first render; its text is the count once a read has settled (#3094).
const page = (players) => ({ data: { players, totalPages: 1, total: players.length, context: null } });
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
const phoneQuery = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });

describe.each([
  ['table', false],
  ['card', true],
])('the %s layout (#3067)', (layout, phone) => {
  beforeEach(() => {
    if (phone) window.matchMedia = phoneQuery;
  });
  afterEach(() => {
    delete window.matchMedia;
  });

  test('the count status is mounted from the first render, and reads its count only once a read has settled', async () => {
    const first = deferred();
    const second = deferred();
    apiClient.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPool();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');

    await act(async () => first.resolve(page([])));
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('0 players');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search this list' }), { target: { value: 'jo' } });
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('');

    await act(async () => second.resolve(page([player])));
    expect(status).toHaveTextContent('1 player');
  });
});

describe('at a phone width (#3067)', () => {
  beforeEach(() => {
    window.matchMedia = phoneQuery;
  });
  afterEach(() => {
    delete window.matchMedia;
  });

  test('the card list is a region named Players, aria-busy while a read is in flight', async () => {
    const held = deferred();
    apiClient.get.mockReturnValueOnce(held.promise);
    renderPool();
    const region = screen.getByRole('region', { name: 'Players' });
    expect(region).toHaveAttribute('aria-busy', 'true');

    await act(async () => held.resolve(page([player])));
    expect(screen.getByRole('region', { name: 'Players' })).toBe(region);
    expect(region).toHaveAttribute('aria-busy', 'false');
  });

  test('a held first read draws the skeleton in the card list', () => {
    apiClient.get.mockReturnValueOnce(deferred().promise);
    renderPool();
    expect(screen.getByTestId('player-pool-loading')).toBeInTheDocument();
  });

  test('a settled empty read draws the empty copy in the card list', async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPool();
    expect(await screen.findByText('No players found')).toBeInTheDocument();
    expect(screen.queryByTestId('player-pool-loading')).not.toBeInTheDocument();
  });

  test('a settled read with rows draws the pager and the count in the card list', async () => {
    renderPool();
    expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 player');
  });
});

// Spec #3094: the phone Filters button counts the applied filters and names them under it. Reset clears
// position, availability, bye and Watching, returns to page 1, and keeps search and sort.
describe('the phone filter summary (#3094)', () => {
  beforeEach(() => {
    window.matchMedia = phoneQuery;
  });
  afterEach(() => {
    delete window.matchMedia;
  });

  test('Filters counts the applied filters, names them, and Reset clears them but keeps search and sort', async () => {
    renderAt('/?pos=WR&availability=waivers&q=jo&sort=name&page=2');
    await screen.findByText('Patrick Mahomes');
    expect(screen.getByRole('button', { name: 'Filters (2)' })).toBeInTheDocument();
    expect(screen.getByTestId('player-pool-filter-summary')).toHaveTextContent('WR, On waivers');

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await screen.findByRole('button', { name: 'Filters' });
    const params = urlParams();
    expect(params.get('q')).toBe('jo');
    expect(params.get('sort')).toBe('name');
    expect(params.has('pos')).toBe(false);
    expect(params.has('availability')).toBe(false);
    expect(params.has('page')).toBe(false);
    expect(screen.queryByTestId('player-pool-filter-summary')).not.toBeInTheDocument();
  });

  test('with no filter applied, Filters has no count and no summary line is drawn', async () => {
    renderAt('/?q=jo&sort=name');
    await screen.findByText('Patrick Mahomes');
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.queryByTestId('player-pool-filter-summary')).not.toBeInTheDocument();
  });

  test('an availability lock is not a filter, so Filters is not counted', async () => {
    renderPool({ availabilityLock: 'waivers' });
    await screen.findByText('Patrick Mahomes');
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  test('the drawer Done is its last control in tab order', async () => {
    renderPool();
    await screen.findByText('Patrick Mahomes');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Player filters' });
    const focusable = Array.from(dialog.querySelectorAll('button, input, select, textarea, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.disabled);
    expect(focusable.at(-1).textContent).toBe('Done');
  });
});
