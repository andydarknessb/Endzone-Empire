import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueDashboard from './LeagueDashboard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const renderDashboard = (leagueId = 1) =>
  renderWithProviders(<LeagueDashboard />, {
    path: '/league/:leagueId',
    route: `/league/${leagueId}`,
  });

const leagueResponse = (overrides = {}) => ({
  data: {
    league: {
      id: 1,
      name: 'Sunday Ballers',
      draft_status: 'pending',
      owner_id: 1,
      roster_limit: 15,
      max_teams: 10,
      invite_code: 'abc123',
      ...overrides,
    },
    teams: [
      { id: 1, name: "Alice's Team", owner: 'alice', roster_count: 3, total_points: 42.5 },
    ],
  },
});

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderDashboard();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('renders league name, status chips, and the standings table', async () => {
  apiClient.get
    .mockResolvedValueOnce(leagueResponse())
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });

  renderDashboard();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText('pending')).toBeInTheDocument();
  expect(screen.getByText('Roster Limit: 15')).toBeInTheDocument();
  expect(screen.getByText('Teams: 1/10')).toBeInTheDocument();
  expect(screen.getByText("Alice's Team")).toBeInTheDocument();
  expect(screen.getByText('alice')).toBeInTheDocument();
  expect(screen.getByText('42.5')).toBeInTheDocument();
});

test('shows the specific server error message when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'league not found' } } });

  renderDashboard();

  expect(await screen.findByText('league not found')).toBeInTheDocument();
});

test('falls back to a generic message if the initial fetch fails with no error detail', async () => {
  apiClient.get.mockRejectedValue({ message: undefined, response: undefined });

  renderDashboard();

  expect(await screen.findByText('League or user data not available')).toBeInTheDocument();
});

test('shows the invite code and copies it to the clipboard', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  apiClient.get
    .mockResolvedValueOnce(leagueResponse())
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText(/abc123/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123');
  expect(await screen.findByText('Invite code copied to clipboard!')).toBeInTheDocument();
});

test('does not render an invite code section when none is present', async () => {
  apiClient.get
    .mockResolvedValueOnce(leagueResponse({ invite_code: undefined }))
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
});

test('shows "Start Draft" only for the owner while the draft is pending, and starting it refetches', async () => {
  apiClient.get
    .mockResolvedValueOnce(leagueResponse())
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } }) // owner
    .mockResolvedValueOnce(leagueResponse({ draft_status: 'active' }))
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });
  apiClient.post.mockResolvedValue({});

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  const startButton = screen.getByRole('button', { name: 'Start Draft' });
  await userEvent.click(startButton);

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/start-draft'));
  expect(await screen.findByText('Draft started successfully!')).toBeInTheDocument();
});

test('does not show "Start Draft" for a non-owner', async () => {
  apiClient.get
    .mockResolvedValueOnce(leagueResponse({ owner_id: 99 }))
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('does not show "Start Draft" once the draft is no longer pending', async () => {
  apiClient.get
    .mockResolvedValueOnce(leagueResponse({ draft_status: 'active', owner_id: 1 }))
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('links to the Draft Room, Matchups, and Set Lineup pages for this league', async () => {
  apiClient.get
    .mockResolvedValueOnce(leagueResponse())
    .mockResolvedValueOnce({ data: { id: 1, username: 'alice' } });

  renderDashboard(7);
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/7/draft');
  expect(screen.getByRole('link', { name: 'Matchups' })).toHaveAttribute('href', '/league/7/matchups');
  expect(screen.getByRole('link', { name: 'Set Lineup' })).toHaveAttribute('href', '/league/7/lineup');
});
