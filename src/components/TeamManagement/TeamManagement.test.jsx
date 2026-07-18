import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import TeamManagement from './TeamManagement';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), delete: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches leagues, auto-selects the first one, and loads its roster', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.resolve({
      data: [{ id: 10, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs', acquired_at: null }],
    });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/team/roster?leagueId=1'));
});

test('shows skeleton rows (not the empty state) while data is loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<TeamManagement />);

  expect(screen.getAllByTestId('roster-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByText(/No players rostered yet/)).not.toBeInTheDocument();
  expect(screen.queryByText(/not in a league yet/i)).not.toBeInTheDocument();
});

test('shows "No players rostered yet." when the roster is empty', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.resolve({ data: [] });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText(/No players rostered yet/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /browse players/i })).toHaveAttribute('href', '/player');
});

test('renders an acquired date when present, and an em dash when absent', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.resolve({
      data: [
        { id: 10, name: 'Has Date', position: 'RB', nfl_team: 'X', acquired_at: '2026-01-15T00:00:00.000Z' },
        { id: 11, name: 'No Date', position: 'WR', nfl_team: 'Y', acquired_at: null },
      ],
    });
  });

  renderWithProviders(<TeamManagement />);

  await screen.findByText('Has Date');
  expect(screen.getByText(new Date('2026-01-15T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
  const noDateRow = screen.getByText('No Date').closest('tr');
  expect(noDateRow).toHaveTextContent('—');
});

test('dropping a player calls the delete endpoint with the selected league and refetches', async () => {
  apiClient.get
    .mockImplementationOnce(() => Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] })) // leagues
    .mockImplementationOnce(() =>
      Promise.resolve({ data: [{ id: 10, name: 'Drop Me', position: 'TE', nfl_team: 'X', acquired_at: null }] })
    ) // initial roster
    .mockImplementationOnce(() => Promise.resolve({ data: [] })); // roster after drop
  apiClient.delete.mockResolvedValue({});

  renderWithProviders(<TeamManagement />);
  await screen.findByText('Drop Me');

  await userEvent.click(screen.getByRole('button', { name: 'Drop' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/team/roster/10?leagueId=1')
  );
  expect(await screen.findByText(/No players rostered yet/)).toBeInTheDocument();
});

test('shows an error alert when the roster fetch fails', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league') return Promise.resolve({ data: [{ id: 1, name: 'Sunday Ballers' }] });
    return Promise.reject({ response: { data: { error: 'roster unavailable' } } });
  });

  renderWithProviders(<TeamManagement />);

  expect(await screen.findByText('roster unavailable')).toBeInTheDocument();
});
