import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueManagement from './LeagueManagement';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  draft_status: 'pending',
  owner_id: 1,
  my_team_name: "alice's Team",
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('fetches and renders the user\'s leagues on mount', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league');
});

test('pre-fills the invite code from a ?code= deep link and focuses Join', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<LeagueManagement />, {
    state: { user: { id: 1 } },
    path: '/league/join',
    route: '/league/join?code=ABC123',
  });

  await waitFor(() =>
    expect(screen.getByLabelText(/invite code/i)).toHaveValue('ABC123')
  );
  expect(screen.getByRole('button', { name: 'Join League' })).toHaveFocus();
});

test('shows a friendly message when the user has no leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  expect(await screen.findByText(/you aren't in any leagues yet/i)).toBeInTheDocument();
});

test('shows an error alert when fetching leagues fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'server exploded' } } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
});

test('the Delete action only appears for leagues the user owns', async () => {
  apiClient.get.mockResolvedValue({
    data: [league({ id: 1, name: 'Mine', owner_id: 1 }), league({ id: 2, name: 'Not Mine', owner_id: 99 })],
  });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });

  await screen.findByText('Mine');
  // Only the owned league's card renders the "..." actions menu at all.
  const menuTriggers = screen.getAllByRole('button', { name: 'League actions' });
  expect(menuTriggers).toHaveLength(1);

  await userEvent.click(menuTriggers[0]);
  expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
});

test('creating a league posts the form data and shows the returned invite code', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);

  await userEvent.type(screen.getByLabelText(/League name/), 'Monday Mayhem');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Monday Mayhem',
      maxTeams: 10,
      minTeams: 8,
    })
  );
  expect(await screen.findByText(/Invite code: abc123/)).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledTimes(3); // Draft Central + initial fetch + refetch after create
});

test('creating a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'name already taken' } } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);

  await userEvent.type(screen.getByLabelText(/League name/), 'Dup League');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  expect(await screen.findByText('name already taken')).toBeInTheDocument();
});

test('the "Require commissioner approval" toggle only appears once "Public league" is on', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));

  expect(screen.queryByLabelText('Require commissioner approval to join')).not.toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Public league'));
  expect(screen.getByLabelText('Require commissioner approval to join')).toBeInTheDocument();
});

test('the best-ball helper text only appears once "Best ball mode" is on', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));

  expect(screen.queryByText(/optimal lineup is set automatically/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByLabelText('Best ball mode'));
  expect(screen.getByText(/optimal lineup is set automatically/i)).toBeInTheDocument();
});

test('creating a league only sends the new optional fields the user actually set', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);

  await userEvent.type(screen.getByLabelText(/League name/), 'Plain League');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Plain League',
      maxTeams: 10,
      minTeams: 8,
    })
  );
});

test('creating a public, approval-required, best-ball, PPR league with a draft date sends all the fields', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { invite_code: 'abc123' } });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);

  await userEvent.type(screen.getByLabelText(/League name/), 'Full Featured League');
  await userEvent.click(screen.getByRole('button', { name: /advanced settings/i }));
  await userEvent.click(screen.getByLabelText('Public league'));
  await userEvent.click(screen.getByLabelText('Require commissioner approval to join'));
  await userEvent.click(screen.getByLabelText('Best ball mode'));
  await userEvent.click(screen.getByLabelText('Scoring'));
  await userEvent.click(await screen.findByRole('option', { name: 'PPR' }));
  await userEvent.type(screen.getByLabelText('Draft date'), '2026-09-04T13:00');
  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Full Featured League',
      maxTeams: 10,
      minTeams: 8,
      isPublic: true,
      joinApproval: true,
      bestBall: true,
      scoringPreset: 'ppr',
      draftDate: new Date('2026-09-04T13:00').toISOString(),
    })
  );
});

test('joining a league posts the trimmed invite code', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText(/you aren't in any leagues yet/i);

  await userEvent.click(screen.getByRole('tab', { name: 'Join League' }));
  await userEvent.type(screen.getByLabelText(/Invite code/), '  xyz789  ');
  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'xyz789' })
  );
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
});

test('deleting a league calls the delete endpoint and refetches', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ id: 7, owner_id: 1 })] });
  apiClient.delete.mockResolvedValue({});

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'League actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete League' }));

  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/api/league/7'));
  expect(apiClient.get).toHaveBeenCalledTimes(3);
});

test('canceling the delete confirmation dialog leaves the league intact', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ id: 7, owner_id: 1 })] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'League actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  expect(await screen.findByRole('heading', { name: /delete sunday ballers\?/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: /delete sunday ballers\?/i })).not.toBeInTheDocument()
  );
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(screen.getByText('Sunday Ballers')).toBeInTheDocument();
});

test('renders Dashboard/Draft Room/Matchups links pointing at the correct league id', async () => {
  apiClient.get.mockResolvedValue({ data: [league({ id: 42 })] });

  renderWithProviders(<LeagueManagement />, { state: { user: { id: 1 } } });
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/league/42');
  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/42/draft');
  expect(screen.getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/42/game-center');
});
