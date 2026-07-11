import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueDashboard from './LeagueDashboard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
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

const userResponse = (overrides = {}) => ({
  data: { id: 1, username: 'alice', ...overrides },
});

const standingsResponse = (overrides = {}) => ({
  data: {
    league: {
      playoff_teams: 4,
      regular_season_weeks: 14,
      season_status: 'regular',
      current_week: 3,
      ...(overrides.league || {}),
    },
    standings: overrides.standings || [
      {
        teamId: 1,
        name: "Alice's Team",
        owner: 'alice',
        wins: 2,
        losses: 1,
        ties: 0,
        pf: 312.5,
        pa: 280.1,
        streak: 'W2',
        winPct: 0.667,
        rank: 1,
        playoffSeed: 1,
      },
    ],
  },
});

/**
 * Build a URL-keyed apiClient.get mock. `overrides` maps URL substrings to
 * either a resolved value or a { reject: <error> } marker. Falls back to a
 * generic empty response for unmatched URLs.
 */
const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url.includes(key)) {
        if (value && value.reject) {
          return Promise.reject(value.reject);
        }
        return Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
};

afterEach(() => {
  jest.clearAllMocks();
});

test('shows a loading spinner before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves
  renderDashboard();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

test('renders league name, status chips, and the standings table', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(screen.getByText('pending')).toBeInTheDocument();
  expect(screen.getByText('Roster Limit: 15')).toBeInTheDocument();
  expect(screen.getByText('Teams: 1/10')).toBeInTheDocument();
  expect(screen.getByText("Alice's Team")).toBeInTheDocument();
  expect(screen.getByText('alice')).toBeInTheDocument();
});

test('standings table renders W-L-T, PF, PA, streak and the playoff seed chip', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete' }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('2-1-0')).toBeInTheDocument();
  expect(screen.getByText('312.5')).toBeInTheDocument();
  expect(screen.getByText('280.1')).toBeInTheDocument();
  expect(screen.getByText('W2')).toBeInTheDocument();
  expect(screen.getByText('#1')).toBeInTheDocument();
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

test('keeps the page alive and shows an error alert when the standings fetch fails', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': { reject: { response: { data: { error: 'standings unavailable' } } } },
  });

  renderDashboard();

  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
  expect(await screen.findByText('standings unavailable')).toBeInTheDocument();
});

test('shows the invite code and copies it to the clipboard', async () => {
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText(/abc123/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123');
  expect(await screen.findByText('Invite code copied to clipboard!')).toBeInTheDocument();
});

test('does not render an invite code section when none is present', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ invite_code: undefined }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
});

test('shows "Start Draft" only for the owner while the draft is pending, and starting it refetches', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  apiClient.post.mockResolvedValue({});

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  const startButton = screen.getByRole('button', { name: 'Start Draft' });
  await userEvent.click(startButton);

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/league/1/start-draft'));
  expect(await screen.findByText('Draft started successfully!')).toBeInTheDocument();
});

test('does not show "Start Draft" for a non-owner', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ owner_id: 99 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('does not show "Start Draft" once the draft is no longer pending', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'active', owner_id: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Start Draft' })).not.toBeInTheDocument();
});

test('links to the Draft Room, Matchups, and Set Lineup pages for this league', async () => {
  mockGetByUrl({
    '/api/league/7': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard(7);
  await screen.findByText('Sunday Ballers');

  expect(screen.getByRole('link', { name: 'Draft Room' })).toHaveAttribute('href', '/league/7/draft');
  expect(screen.getByRole('link', { name: 'Matchups' })).toHaveAttribute('href', '/league/7/matchups');
  expect(screen.getByRole('link', { name: 'Set Lineup' })).toHaveAttribute('href', '/league/7/lineup');
  expect(screen.getByRole('link', { name: 'Waivers' })).toHaveAttribute('href', '/league/7/waivers');
  expect(screen.getByRole('link', { name: 'Trades' })).toHaveAttribute('href', '/league/7/trades');
  expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('href', '/league/7/activity');
});

test('week and season-status chips render when draft is complete', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete' }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'playoffs', current_week: 12 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.getByText('Week 12')).toBeInTheDocument();
  expect(screen.getByText('Playoffs')).toBeInTheDocument();
});

test('Advance Week is visible for the owner when draft is complete and season is not complete, posts, and refetches on click', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', owner_id: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });
  apiClient.post.mockResolvedValue({});

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  const advanceButton = screen.getByRole('button', { name: 'Advance Week' });
  await userEvent.click(advanceButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/advance-week')
  );
  expect(await screen.findByText('Week advanced!')).toBeInTheDocument();
  // refetch: league + user + standings called at least twice each (initial + refetch)
  expect(apiClient.get.mock.calls.filter((c) => c[0].includes('/standings')).length).toBeGreaterThanOrEqual(2);
});

test('Advance Week is absent for non-owners', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', owner_id: 99 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'regular', current_week: 3 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
});

test('Advance Week is absent when draft_status is pending', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'pending', owner_id: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
});

test('Advance Week is absent once the season is complete', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete', owner_id: 1 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'complete', current_week: 14 } }),
  });

  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByRole('button', { name: 'Advance Week' })).not.toBeInTheDocument();
});

// --- Commissioner tools ---

test('Commissioner Tools panel shows only for the owner', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ owner_id: 99 }),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  expect(screen.queryByText('Commissioner Tools')).not.toBeInTheDocument();
});

test('Lock Transactions toggles via the commissioner endpoint', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  apiClient.put.mockResolvedValue({});
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Lock Transactions' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/transactions-lock', {
      locked: true,
    })
  );
  expect(await screen.findByText('Transactions locked')).toBeInTheDocument();
});

test('removing another owner\'s team calls the commissioner endpoint', async () => {
  const withOtherTeam = leagueResponse();
  withOtherTeam.data.teams.push({ id: 2, name: "Bob's Team", owner: 'bob', roster_count: 0, total_points: 0 });
  mockGetByUrl({
    '/api/league/1': withOtherTeam,
    '/api/user': userResponse(),
    '/standings': standingsResponse(),
  });
  apiClient.delete.mockResolvedValue({});
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  // Own team has no remove button; Bob's does
  expect(screen.queryByRole('button', { name: "Remove Alice's Team" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: "Remove Bob's Team" }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/commissioner/league/1/teams/2')
  );
  expect(await screen.findByText('Team removed')).toBeInTheDocument();
});

test('Start New Season appears only when the season is complete and POSTs the rollover', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse({ draft_status: 'complete' }),
    '/api/user': userResponse(),
    '/standings': standingsResponse({ league: { season_status: 'complete' } }),
  });
  apiClient.post.mockResolvedValue({});
  renderDashboard();
  await screen.findByText('Sunday Ballers');

  await userEvent.click(screen.getByRole('button', { name: 'Start New Season' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/commissioner/league/1/rollover', {})
  );
  expect(await screen.findByText('New season started!')).toBeInTheDocument();
});
