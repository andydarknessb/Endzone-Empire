import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import GlobalPlayerSearch from './GlobalPlayerSearch';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const JJ = { id: 7, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN' };

beforeEach(() => {
  apiClient.get.mockImplementation(() => Promise.resolve({ data: { players: [JJ] } }));
  mockNavigate.mockClear();
});

afterEach(() => jest.clearAllMocks());

// #1311, ADR 0040: GlobalPlayerSearch no longer opens a dialog - it has no
// leagueId to open a Decision card with (it lives in the always-mounted
// AppBar), so a search hit navigates straight to the player's profile page,
// the app's one league-free player detail.
test('searches players and navigates to the player profile page on select', async () => {
  renderWithProviders(<GlobalPlayerSearch />);

  await userEvent.type(screen.getByLabelText('Search players'), 'jeff');
  const option = await screen.findByText('Justin Jefferson');

  await userEvent.click(option);

  // The players search endpoint was queried with the typed term.
  expect(apiClient.get).toHaveBeenCalledWith(
    '/api/players',
    expect.objectContaining({ params: expect.objectContaining({ search: 'jeff' }) })
  );
  expect(mockNavigate).toHaveBeenCalledWith('/players/7');
});

// #1362: the host has no other way to hear that a hit navigated (the drawer
// instance in Nav needs this to close itself), so onSelect fires right after
// navigate with the selected option.
test('calls onSelect with the selected option after navigating (#1362)', async () => {
  const onSelect = jest.fn();
  renderWithProviders(<GlobalPlayerSearch onSelect={onSelect} />);

  await userEvent.type(screen.getByLabelText('Search players'), 'jeff');
  const option = await screen.findByText('Justin Jefferson');

  await userEvent.click(option);

  expect(mockNavigate).toHaveBeenCalledWith('/players/7');
  expect(onSelect).toHaveBeenCalledWith(JJ);
});

test('"/" focuses the search when the shortcut is enabled', async () => {
  renderWithProviders(<GlobalPlayerSearch enableShortcut />);

  await userEvent.keyboard('/');

  expect(screen.getByLabelText('Search players')).toHaveFocus();
});
