import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import UserPage from './UserPage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const baseState = {
  user: { id: 1, username: 'alice' },
  errors: { loginMessage: '', registrationMessage: '' },
};

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  my_team_id: 10,
  my_team_name: "alice's Team",
  draft_status: 'pending',
  owner_id: 1,
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the title and a welcome message with the username', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(screen.getByText('Endzone Empire')).toBeInTheDocument();
  expect(screen.getByText('Welcome, alice!')).toBeInTheDocument();
});

test("fetches and renders the user's leagues on mount", async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText("Team: alice's Team")).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league');
});

test('shows an error alert when fetching leagues fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'server exploded' } } });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText('server exploded')).toBeInTheDocument();
});

test('Rename Team is disabled until the user has at least one league', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Rename Team' })).toBeDisabled();
});

test('Rename Team is enabled once the user has a league', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByText('Sunday Ballers');
  expect(screen.getByRole('button', { name: 'Rename Team' })).toBeEnabled();
});

test('creating a league posts the form data, shows a notice, and refetches leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));
  await userEvent.type(screen.getByLabelText('League Name'), 'Monday Mayhem');
  await userEvent.type(screen.getByLabelText('Team Name'), "Alice's Squad");
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Monday Mayhem',
      teamName: "Alice's Squad",
      maxTeams: 2,
    })
  );
  expect(await screen.findByText('League created!')).toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
});

test('the Create button is disabled until a league name is entered', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('League Name'), 'X');
  expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
});

test('creating a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'name already taken' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));
  await userEvent.type(screen.getByLabelText('League Name'), 'Dup League');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('name already taken')).toBeInTheDocument();
});

test('joining a league posts the trimmed invite code, shows a notice, and refetches leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));
  expect(apiClient.get).toHaveBeenCalledTimes(1); // opening the dialog fetches nothing — no browse list
  await userEvent.type(screen.getByLabelText('Invite Code'), '  abc123  ');
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'abc123' })
  );
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
});

test('the Join button is disabled until an invite code is entered', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));
  expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Invite Code'), 'x');
  expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled();
});

test('joining a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'no league with that invite code' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: 'Join League' }));
  await userEvent.type(screen.getByLabelText('Invite Code'), 'bogus');
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  expect(await screen.findByText('no league with that invite code')).toBeInTheDocument();
});

test("renaming a team PUTs the new name to the selected league's team id", async () => {
  apiClient.get.mockResolvedValue({
    data: [league({ id: 3, my_team_id: 30, name: 'Dynasty League', my_team_name: 'Old Name' })],
  });
  apiClient.put.mockResolvedValue({ data: {} });

  renderWithProviders(<UserPage />, { state: baseState });
  await screen.findByText('Dynasty League');

  await userEvent.click(screen.getByRole('button', { name: 'Rename Team' }));
  await userEvent.click(screen.getByLabelText('League'));
  await userEvent.click(await screen.findByRole('option', { name: 'Dynasty League (Old Name)' }));
  await userEvent.type(screen.getByLabelText('New Team Name'), 'New Name');
  await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/30', { name: 'New Name' })
  );
  expect(await screen.findByText('Team renamed!')).toBeInTheDocument();
});

test('the Rename button is disabled until a league is selected and a new name is entered', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Rename Team' }));
  expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
});

test('renaming a team surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  apiClient.put.mockRejectedValue({ response: { data: { error: 'team not found or not yours' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Rename Team' }));
  await userEvent.click(screen.getByLabelText('League'));
  await userEvent.click(await screen.findByRole('option', { name: "Sunday Ballers (alice's Team)" }));
  await userEvent.type(screen.getByLabelText('New Team Name'), 'New Name');
  await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

  expect(await screen.findByText('team not found or not yours')).toBeInTheDocument();
});

test('Cancel closes the Create League dialog without making a write request', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: 'Create League' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByText('Create a New League')).not.toBeInTheDocument());
  expect(apiClient.post).not.toHaveBeenCalled();
});
