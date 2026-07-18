import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import PlayerManagement from './PlayerManagement';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const player = (overrides = {}) => ({ id: 1, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs', ...overrides });

function mockDefaultApi({ players = [player()], roster = [], totalPages = 1 } = {}) {
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    if (url === '/api/players') return Promise.resolve({ data: { players, totalPages } });
    if (String(url).startsWith('/api/team/roster')) return Promise.resolve({ data: roster });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the player pool and the roster section', async () => {
  mockDefaultApi({ roster: [player({ id: 2, name: 'Already Rostered' })] });

  renderWithProviders(<PlayerManagement />);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(screen.getByText('Already Rostered')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'My Roster' })).toBeInTheDocument();
});

test('fetches players filtered by page and position', async () => {
  mockDefaultApi();
  renderWithProviders(<PlayerManagement />);

  await screen.findByText('Patrick Mahomes');

  expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
    params: { page: 1, position: 'All', sort: 'adp' },
  });
});

test('sorting by Name refetches with sort=name and persists to the URL', async () => {
  mockDefaultApi();
  renderWithProviders(<PlayerManagement />);
  await screen.findByText('Patrick Mahomes');

  await userEvent.click(screen.getByRole('button', { name: /Name/ }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, position: 'All', sort: 'name' },
    })
  );
});

test('restores sort/position/search from the URL on load', async () => {
  mockDefaultApi();
  renderWithProviders(<PlayerManagement />, {
    route: '/player?pos=RB&sort=name&dir=desc&q=smith',
    path: '/player',
  });

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, position: 'RB', sort: 'name', dir: 'desc', search: 'smith' },
    })
  );
});

test('a player already on the roster shows "Added" and a disabled button', async () => {
  mockDefaultApi({ players: [player({ id: 5, name: 'Rostered Guy' })], roster: [player({ id: 5, name: 'Rostered Guy' })] });

  renderWithProviders(<PlayerManagement />);

  const button = await screen.findByRole('button', { name: 'Added' });
  expect(button).toBeDisabled();
});

test('clicking "Add to Roster" posts the player and league, then refetches the roster', async () => {
  mockDefaultApi({ players: [player({ id: 8, name: 'Free Agent' })] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<PlayerManagement />);
  await screen.findByText('Free Agent');

  await userEvent.click(screen.getByRole('button', { name: 'Add to Roster' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/8', { leagueId: 1 })
  );
});

test('clicking "Remove" in the roster section deletes the player for the selected league', async () => {
  mockDefaultApi({ roster: [player({ id: 3, name: 'Bench Him' })] });
  apiClient.delete.mockResolvedValue({});

  renderWithProviders(<PlayerManagement />);
  await screen.findByText('Bench Him');

  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/3?leagueId=1')
  );
});

test('clicking Undo on the drop snackbar calls the undo-drop endpoint, not a plain re-add', async () => {
  mockDefaultApi({ roster: [player({ id: 3, name: 'Bench Him' })] });
  apiClient.delete.mockResolvedValue({});
  apiClient.post.mockResolvedValue({});

  renderWithProviders(
    <SnackbarProvider>
      <PlayerManagement />
    </SnackbarProvider>
  );
  await screen.findByText('Bench Him');

  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/3/undo-drop', { leagueId: 1 })
  );
});

test('changing the position filter refetches players with the new position and resets to page 1', async () => {
  mockDefaultApi();
  renderWithProviders(<PlayerManagement />);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();

  await userEvent.click(screen.getByLabelText('Position'));
  await userEvent.click(await screen.findByRole('option', { name: 'QB' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', { params: { page: 1, position: 'QB', sort: 'adp' } })
  );
});

test('shows an error alert when the player fetch fails', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [] });
    if (url === '/api/players') return Promise.reject({ response: { data: { error: 'players down' } } });
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<PlayerManagement />);

  expect(await screen.findByText('players down')).toBeInTheDocument();
});
