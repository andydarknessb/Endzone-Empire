import React from 'react';
import { screen, within, waitFor } from '@testing-library/react';
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

// The hero's Create/Join League buttons are always on screen; the rich empty
// state repeats the same two CTAs when there are no leagues yet. Scope to the
// hero so these tests keep working regardless of which state is showing.
const heroButton = (name) => within(screen.getByTestId('dashboard-hero')).getByRole('button', { name });

// UserPage also fetches the news/activity widgets on mount via apiClient.get,
// so raw call counts aren't meaningful for the leagues fetch anymore — filter
// to the URL under test instead.
const getCallsTo = (url) => apiClient.get.mock.calls.filter(([calledUrl]) => calledUrl === url).length;

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton cards (not the empty state) while leagues are loading', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<UserPage />, { state: baseState });

  expect(screen.getAllByTestId('league-skeleton').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
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

test('renders a rich empty state with an icon and CTAs once loading finishes with no leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });

  const emptyState = await screen.findByTestId('leagues-empty-state');
  expect(within(emptyState).getByText("You aren't managing any teams yet.")).toBeInTheDocument();
  expect(within(emptyState).getByTestId('SportsFootballIcon')).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Create League' })).toBeInTheDocument();
  expect(within(emptyState).getByRole('button', { name: 'Join League' })).toBeInTheDocument();
});

test('does not render the empty state once leagues are present', async () => {
  apiClient.get.mockResolvedValue({ data: [league()] });
  renderWithProviders(<UserPage />, { state: baseState });

  await screen.findByText('Sunday Ballers');
  expect(screen.queryByTestId('leagues-empty-state')).not.toBeInTheDocument();
});

test('renders NFL news headlines and cross-league activity from their own endpoints', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news') {
      return Promise.resolve({
        data: [{ title: 'Star RB questionable for Sunday', link: 'https://example.com/news/1' }],
      });
    }
    if (url === '/api/notifications') {
      return Promise.resolve({
        data: {
          notifications: [
            { id: 5, message: 'Sunday Ballers completed a trade', league_name: 'Sunday Ballers', created_at: '2026-01-01T00:00:00.000Z' },
          ],
          unread: 0,
        },
      });
    }
    return Promise.resolve({ data: [] }); // /api/league
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByRole('link', { name: 'Star RB questionable for Sunday' })).toHaveAttribute(
    'href',
    'https://example.com/news/1'
  );
  expect(screen.getByText('Sunday Ballers completed a trade')).toBeInTheDocument();
});

test('shows a friendly message when the news or activity widgets fail to load', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/news' || url === '/api/notifications') {
      return Promise.reject(new Error('network error'));
    }
    return Promise.resolve({ data: [] }); // /api/league
  });
  renderWithProviders(<UserPage />, { state: baseState });

  expect(await screen.findByText("Couldn't load the latest news right now.")).toBeInTheDocument();
  expect(screen.getByText("Couldn't load recent activity right now.")).toBeInTheDocument();
});

test('creating a league posts the form data, shows a notice, and refetches leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
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
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(2));
});

test('the approval toggle only appears once Public league is on, and only the fields the user sets are sent', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  expect(screen.queryByLabelText('Require commissioner approval to join')).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('League Name'), 'Plain League');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Plain League',
      teamName: undefined,
      maxTeams: 2,
    })
  );
});

test('creating a public, approval-required, best-ball, half-PPR league with a draft date sends all the fields', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({ data: { id: 2 } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Full League');
  await userEvent.click(screen.getByLabelText('Public league'));
  await userEvent.click(screen.getByLabelText('Require commissioner approval to join'));
  await userEvent.click(screen.getByLabelText('Best ball mode'));
  expect(screen.getByText(/optimal lineup is set automatically/i)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Scoring'));
  await userEvent.click(await screen.findByRole('option', { name: 'Half PPR' }));
  await userEvent.type(screen.getByLabelText('Draft date'), '2026-09-04T13:00');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league', {
      name: 'Full League',
      teamName: undefined,
      maxTeams: 2,
      isPublic: true,
      joinApproval: true,
      bestBall: true,
      scoringPreset: 'half_ppr',
      draftDate: new Date('2026-09-04T13:00').toISOString(),
    })
  );
});

test('the Create button is disabled until a league name is entered', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Create League'));
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('League Name'), 'X');
  expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
});

test('creating a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'name already taken' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Create League'));
  await userEvent.type(screen.getByLabelText('League Name'), 'Dup League');
  await userEvent.click(screen.getByRole('button', { name: 'Create' }));

  expect(await screen.findByText('name already taken')).toBeInTheDocument();
});

test('joining a league posts the trimmed invite code, shows a notice, and refetches leagues', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockResolvedValue({});

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(1));

  await userEvent.click(heroButton('Join League'));
  expect(getCallsTo('/api/league')).toBe(1); // opening the dialog fetches nothing — no browse list
  await userEvent.type(screen.getByLabelText('Invite Code'), '  abc123  ');
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/league/join', { inviteCode: 'abc123' })
  );
  expect(await screen.findByText('Joined league!')).toBeInTheDocument();
  await waitFor(() => expect(getCallsTo('/api/league')).toBe(2));
});

test('the Join button is disabled until an invite code is entered', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Join League'));
  expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Invite Code'), 'x');
  expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled();
});

test('joining a league surfaces the server error on failure', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  apiClient.post.mockRejectedValue({ response: { data: { error: 'no league with that invite code' } } });

  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Join League'));
  await userEvent.type(screen.getByLabelText('Invite Code'), 'bogus');
  await userEvent.click(screen.getByRole('button', { name: 'Join' }));

  expect(await screen.findByText('no league with that invite code')).toBeInTheDocument();
});

test('Cancel closes the Create League dialog without making a write request', async () => {
  apiClient.get.mockResolvedValue({ data: [] });
  renderWithProviders(<UserPage />, { state: baseState });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());

  await userEvent.click(heroButton('Create League'));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByText('Create a New League')).not.toBeInTheDocument());
  expect(apiClient.post).not.toHaveBeenCalled();
});
