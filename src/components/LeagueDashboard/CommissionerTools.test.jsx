import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import CommissionerTools from './CommissionerTools';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  owner_id: 1,
  draft_status: 'pending',
  min_teams: 8,
  max_teams: 10,
  transactions_locked: false,
  is_public: false,
  join_approval: false,
  playoff_teams: 4,
  regular_season_weeks: 14,
  playoff_consolation: false,
  trade_deadline_week: null,
  waiver_type: 'priority',
  waiver_period_hours: 24,
  trade_review_hours: 24,
  trade_veto_votes: 4,
  ...overrides,
});

const teams = [
  { id: 1, name: "Alice's Team", owner: 'alice', faab_remaining: 100, locked: false },
  { id: 2, name: "Bob's Team", owner: 'bob', faab_remaining: 60, locked: false },
];

const user = { id: 1, username: 'alice' };

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        return value && value.reject ? Promise.reject(value.reject) : Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
};

const renderTools = (props = {}) =>
  renderWithProviders(
    <SnackbarProvider>
      <CommissionerTools
        leagueId={1}
        league={league()}
        teams={teams}
        user={user}
        standingsLeague={{ season_status: 'regular', current_week: 3 }}
        onRefresh={jest.fn()}
        {...props}
      />
    </SnackbarProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByUrl();
});

test('renders all four tabs, defaulting to General Settings', () => {
  renderTools();
  expect(screen.getByRole('tab', { name: 'General Settings' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Playoffs & Schedule' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Waivers & Trades' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'System Overrides' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Lock Transactions' })).toBeInTheDocument();
});

// --- Playoffs & Schedule ---

test('Playoff structure fields are disabled once the draft has started, but the trade deadline stays editable', async () => {
  renderTools({ league: league({ draft_status: 'active' }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  expect(screen.getByText(/locks once the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Playoff Settings' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save Trade Deadline' })).toBeEnabled();
});

test('Save Playoff Settings sends the playoff-teams/start-week/consolation payload', async () => {
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  await userEvent.click(screen.getByRole('button', { name: 'Save Playoff Settings' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      playoffTeams: 4,
      regularSeasonWeeks: 14,
      playoffConsolation: false,
    })
  );
  expect(await screen.findByText('Playoff settings saved')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('Save Trade Deadline sends the selected week', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Playoffs & Schedule' }));

  await userEvent.click(screen.getByLabelText('Trade Deadline'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save Trade Deadline' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', { tradeDeadlineWeek: 11 })
  );
  expect(await screen.findByText('Trade deadline saved')).toBeInTheDocument();
});

// --- Waivers & Trades ---

test('Save Waiver Rules maps the Trade Review radio choice to review-hours/veto-votes', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' }));

  await userEvent.click(screen.getByRole('radio', { name: 'FAAB (Bidding)' }));
  await userEvent.click(screen.getByRole('radio', { name: 'Instant Process' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save Waiver Rules' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      waiverType: 'faab',
      waiverPeriodHours: 24,
      tradeReviewHours: 0,
      tradeVetoVotes: 0,
    })
  );
});

test('League Vote review mode reveals a votes-needed field and includes it in the save', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' }));

  await userEvent.click(screen.getByRole('radio', { name: 'League Vote' }));
  const votesField = screen.getByLabelText('Votes needed to veto');
  await userEvent.clear(votesField);
  await userEvent.type(votesField, '5');
  await userEvent.click(screen.getByRole('button', { name: 'Save Waiver Rules' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', expect.objectContaining({
      tradeReviewHours: 24,
      tradeVetoVotes: 5,
    }))
  );
});

test('toggling Continuous Waivers hides the clear-period select and saves 0 hours', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Waivers & Trades' }));

  expect(screen.getByLabelText('Waiver Clear Period')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /Continuous waivers/ }));
  expect(screen.queryByLabelText('Waiver Clear Period')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Save Waiver Rules' }));
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', expect.objectContaining({
      waiverPeriodHours: 0,
    }))
  );
});

// --- System Overrides ---

test('Force Roster Move requires confirmation before calling force-transaction', async () => {
  apiClient.post.mockResolvedValue({});
  mockGetByUrl({
    '/api/players': { data: { players: [{ id: 55, name: 'Puka Nacua', position: 'WR', nfl_team: 'LAR' }] } },
  });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  await userEvent.click(screen.getAllByLabelText('Team')[0]); // Force Roster Move's Team select
  await userEvent.click(await screen.findByRole('option', { name: "Bob's Team" }));
  await userEvent.type(screen.getByLabelText('Player Search'), 'Puka');
  await userEvent.click(await screen.findByText('Puka Nacua'));

  const forceButton = screen.getByRole('button', { name: 'Force Transaction' });
  await userEvent.click(forceButton);
  expect(await screen.findByText(/Force add Puka Nacua\?/)).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();

  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Force Transaction' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/commissioner/league/1/force-transaction', {
      teamId: 2, action: 'add', playerId: 55,
    })
  );
});

test('FAAB Budget Editor pre-fills the selected team\'s remaining FAAB and saves an edit', async () => {
  apiClient.put.mockResolvedValue({});
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  const teamSelects = screen.getAllByLabelText('Team');
  await userEvent.click(teamSelects[1]); // FAAB editor's Team select
  await userEvent.click(await screen.findByRole('option', { name: "Bob's Team" }));

  const faabInput = screen.getByLabelText('Remaining FAAB');
  expect(faabInput).toHaveValue(60);
  await userEvent.clear(faabInput);
  await userEvent.type(faabInput, '35');
  await userEvent.click(screen.getByRole('button', { name: 'Save FAAB Budget' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/teams/2/faab', {
      faabRemaining: 35,
    })
  );
});

test('Manual Score Correction fetches the matchup and applies a point adjustment', async () => {
  mockGetByUrl({
    '/matchups': {
      data: [
        { id: 9, week: 3, home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90, home_team_name: "Alice's Team", away_team_name: "Bob's Team" },
      ],
    },
  });
  apiClient.put.mockResolvedValue({ data: {} });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  const teamSelects = screen.getAllByLabelText('Team');
  await userEvent.click(teamSelects[2]); // Score correction's Team select
  await userEvent.click(await screen.findByRole('option', { name: "Alice's Team" }));
  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 3' }));

  expect(await screen.findByText(/Current score:/)).toBeInTheDocument();
  const adjustmentInput = screen.getByLabelText('Adjustment (+/-)');
  await userEvent.type(adjustmentInput, '5');
  await userEvent.click(screen.getByRole('button', { name: 'Apply Correction' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/matchups/9', {
      homeScore: 105,
      awayScore: 90,
    })
  );
});

test('Lock Specific Team toggles a single team without touching the league-wide lock', async () => {
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  await userEvent.click(screen.getByRole('checkbox', { name: "Lock Bob's Team" }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/commissioner/league/1/teams/2/lock', {
      locked: true,
    })
  );
  expect(onRefresh).toHaveBeenCalled();
});
