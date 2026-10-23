/* eslint-disable testing-library/no-node-access -- the Play-select look is asserted by its class and markup (.cursor, MUI roots), which have no role */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
  expect(screen.getByRole('textbox', { name: 'Search players' })).toBeInTheDocument();
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
