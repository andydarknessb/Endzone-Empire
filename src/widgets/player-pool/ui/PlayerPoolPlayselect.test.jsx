/* eslint-disable testing-library/no-node-access -- the Play-select look is asserted by its class and markup (.cursor, MUI roots), which have no role */
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

test('an empty list says its copy, and the pager still counts', async () => {
  apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1, total: 0, context: null } });
  renderPool({ emptyCopy: 'No players are on waivers' });
  expect(await screen.findByText('No players are on waivers')).toBeInTheDocument();
  expect(screen.getByText('0 players')).toBeInTheDocument();
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

// #3067: the count's status is mounted from the first render; its text is the count only while the pager shows.
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

  test('the count status is mounted from the first render, and reads its count only while the pager shows', async () => {
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
