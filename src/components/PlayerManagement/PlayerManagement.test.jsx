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

function mockDefaultApi({ players = [player()], roster = [], totalPages = 1, league = { id: 1, name: 'Sunday Ballers' } } = {}) {
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/league') return Promise.resolve({ data: [league] });
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

test('jump-to-page clamps entries to the available page range', async () => {
  mockDefaultApi({ totalPages: 5 });
  renderWithProviders(<PlayerManagement />);
  await screen.findByText('Patrick Mahomes');

  const jumpInput = screen.getByLabelText('Jump to page');
  await userEvent.type(jumpInput, '99{enter}');
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 5, position: 'All', sort: 'adp' },
    })
  );

  apiClient.get.mockClear();
  await userEvent.type(jumpInput, '0{enter}');
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
      params: { page: 1, position: 'All', sort: 'adp' },
    })
  );
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

  await userEvent.click(screen.getByRole('button', { name: 'Add free agent' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/8', { leagueId: 1 })
  );
});

test.each([
  [{ draft_status: 'pending' }, 'Draft not started'],
  [{ draft_status: 'active' }, 'Open Draft Room'],
  [{ draft_status: 'complete', season_status: 'complete' }, 'Season complete'],
])('disables ambiguous roster adds for the current league phase', async (phase, label) => {
  mockDefaultApi({ league: { id: 1, name: 'Sunday Ballers', ...phase } });
  renderWithProviders(<PlayerManagement />);

  expect(await screen.findByRole('button', { name: label })).toBeDisabled();
});

test('renders bye and injury badges and supports additional sortable columns', async () => {
  mockDefaultApi({ players: [player({ bye_week: 6, injury_status: 'Q', position_rank: 2, projected_points: 211.4 })] });
  renderWithProviders(<PlayerManagement />);

  expect(await screen.findByText('Bye 6')).toBeInTheDocument();
  expect(screen.getByText('Q')).toBeInTheDocument();
  expect(screen.getByLabelText(/Pos rank: Position rank:/)).toBeInTheDocument();
  expect(screen.getByLabelText(/ADP: Average draft position:/)).toBeInTheDocument();
  const projectedSort = screen.getByRole('button', { name: /Projected fantasy points:/ });
  expect(screen.getByLabelText(/Projected: Projected fantasy points:/)).toBeInTheDocument();
  await userEvent.click(projectedSort);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/players', {
    params: { page: 1, position: 'All', sort: 'projected_points' },
  }));
});

test('has no Row column and renders every fetched player, whatever the page', async () => {
  const players = Array.from({ length: 10 }, (_, i) => player({ id: i + 1, name: `Player ${i + 1}` }));
  mockDefaultApi({ players, totalPages: 11 });
  const page = 11;

  renderWithProviders(<PlayerManagement />, { route: `/player?page=${page}`, path: '/player' });

  await screen.findByText('Player 10');

  expect(screen.queryByText('Row')).not.toBeInTheDocument();
  players.forEach((p) => {
    expect(screen.getByText(p.name)).toBeInTheDocument();
  });
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

test('the position filter offers individual defender positions (DE/DT/LB/CB/S/DB) and filters by them', async () => {
  mockDefaultApi();
  renderWithProviders(<PlayerManagement />);
  await screen.findByText('Patrick Mahomes');
  apiClient.get.mockClear();

  await userEvent.click(screen.getByLabelText('Position'));
  for (const pos of ['DE', 'DT', 'LB', 'CB', 'S', 'DB']) {
    expect(await screen.findByRole('option', { name: pos })).toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole('option', { name: 'DT' }));

  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith('/api/players', { params: { page: 1, position: 'DT', sort: 'adp' } })
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

test("pick'em-only leagues are left out of the league selector because they have no roster to add to", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({
        data: [
          { id: 5, name: 'Office Pool', pickem_only: true, draft_status: 'pending' },
          { id: 1, name: 'Sunday Ballers', draft_status: 'complete', season_status: 'regular' },
        ],
      });
    }
    if (url === '/api/players') return Promise.resolve({ data: { players: [player()], totalPages: 1 } });
    if (String(url).startsWith('/api/team/roster')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });

  renderWithProviders(<PlayerManagement />);

  await screen.findByText('Patrick Mahomes');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/team/roster?leagueId=1'));
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/team/roster?leagueId=5');
  await userEvent.click(screen.getByRole('combobox', { name: 'League' }));
  expect(await screen.findByRole('option', { name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Office Pool' })).not.toBeInTheDocument();
});

test("a manager with no fantasy league can still browse players but is told why nothing can be added", async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') {
      return Promise.resolve({ data: [{ id: 5, name: 'Office Pool', pickem_only: true, draft_status: 'pending' }] });
    }
    if (url === '/api/players') return Promise.resolve({ data: { players: [player()], totalPages: 1 } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });

  renderWithProviders(<PlayerManagement />);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  expect(await screen.findByText(/not in a fantasy league yet/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to Leagues' })).toHaveAttribute('href', '/league');
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/team/roster'));
});
