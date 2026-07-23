import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEventLibrary from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import CommissionerTools from './CommissionerTools';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const userEvent = Object.fromEntries(
  ['click', 'clear', 'type'].map((method) => [
    method,
    (...args) => act(async () => { await userEventLibrary[method](...args); }),
  ])
);

const league = (overrides = {}) => ({
  id: 1,
  name: 'Sunday Ballers',
  owner_id: 1,
  draft_status: 'pending',
  min_teams: 8,
  max_teams: 10,
  roster_slots: [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ],
  bench_slots: 5,
  ir_slots: 1,
  dp_enabled: false,
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

test('renders all six tabs, defaulting to General Settings', () => {
  renderTools();
  expect(screen.getByRole('tab', { name: 'General Settings' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Roster Settings' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Scoring Settings' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Playoffs & Schedule' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Waivers & Trades' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'System Overrides' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Lock Transactions' })).toBeInTheDocument();
});

test('calls out immediate general-setting effects and destructive team removal', () => {
  renderTools({ league: league({ is_public: true, join_approval: true }) });

  expect(screen.getByText(/Applies immediately\. Freezes adds/)).toBeInTheDocument();
  expect(screen.getByText('Destructive actions')).toBeInTheDocument();
  expect(screen.getByText('Remove a team')).toBeInTheDocument();
  expect(screen.getByText('Approve and deny decisions apply immediately.')).toBeInTheDocument();
});

// --- Roster Settings ---

test('Roster Settings renders configured slots and computes the total roster size', async () => {
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  expect(screen.getAllByLabelText('Slot Name')).toHaveLength(2);
  // 1 QB + 1 FLEX starters + 5 bench + 1 IR = 8
  expect(screen.getByText(/Total roster size:/)).toHaveTextContent('Total roster size: 8 (2 starters + 5 bench + 1 IR)');
});

test('Roster Settings is frozen once the draft has started', async () => {
  renderTools({ league: league({ draft_status: 'active' }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  expect(screen.getByText(/locks once the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Roster Settings' })).toBeDisabled();
  expect(screen.getAllByLabelText('Slot Name')[0]).toBeDisabled();
});

test('Save Roster Settings sends the slot array plus bench/IR/DP payload', async () => {
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  await userEvent.click(screen.getByRole('button', { name: 'Save Roster Settings' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      rosterSlots: [
        { key: 'QB', count: 1, eligiblePositions: ['QB'] },
        { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
      ],
      benchSlots: 5,
      irSlots: 1,
      dpEnabled: false,
    })
  );
  expect(await screen.findByText('Roster settings saved')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('Add Slot appends an empty slot row for the commissioner to configure', async () => {
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Roster Settings' }));

  await userEvent.click(screen.getByRole('button', { name: '+ Add Slot' }));
  expect(screen.getAllByLabelText('Slot Name')).toHaveLength(3);
});

// --- Scoring Settings ---

const SCORING_DEFAULTS_FIXTURE = {
  passing: { yards: 0.04, touchdowns: 4, interceptions: -2, twoPointConversions: 2 },
  kicking: {
    extraPoint: 1,
    fieldGoal: [
      { min: 0, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: null, points: 5 },
    ],
  },
  idp: { soloTackle: 1, sack: 2 },
};

const mockScoringRules = () => mockGetByUrl({
  '/api/scoring/rules': { data: { defaults: SCORING_DEFAULTS_FIXTURE, presets: {} } },
});

test('Scoring Settings renders category fields and tier rows from the defaults, hiding IDP when dpEnabled is false', async () => {
  mockScoringRules();
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByText('Passing')).toBeInTheDocument();
  expect(screen.getByLabelText('Per Yard')).toHaveValue(0.04);
  expect(screen.getByLabelText('Touchdown')).toHaveValue(4);
  expect(screen.getByText('Field Goal (by distance)')).toBeInTheDocument();
  expect(screen.getAllByLabelText('Min')).toHaveLength(3); // 3 FG tiers
  expect(screen.queryByText('Individual Defense (IDP)')).not.toBeInTheDocument();
});

test('Scoring Settings shows the IDP section when the league has DP enabled', async () => {
  mockScoringRules();
  renderTools({ league: league({ dp_enabled: true }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByText('Individual Defense (IDP)')).toBeInTheDocument();
  expect(screen.getByLabelText('Solo Tackle')).toHaveValue(1);
});

test('Scoring Settings is frozen once the draft has started', async () => {
  mockScoringRules();
  renderTools({ league: league({ draft_status: 'active' }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByText(/lock once the draft starts/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Scoring Settings' })).toBeDisabled();
  expect(screen.getByLabelText('Per Yard')).toBeDisabled();
});

test('editing a leaf value and a tier field, then saving, sends the full nested payload', async () => {
  mockScoringRules();
  apiClient.put.mockResolvedValue({});
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  const touchdownField = await screen.findByLabelText('Touchdown');
  await userEvent.clear(touchdownField);
  await userEvent.type(touchdownField, '6');

  const pointsFields = screen.getAllByLabelText('Points');
  await userEvent.clear(pointsFields[0]);
  await userEvent.type(pointsFields[0], '4');

  await userEvent.click(screen.getByRole('button', { name: 'Save Scoring Settings' }));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/league/1', {
      scoringRules: {
        passing: { yards: 0.04, touchdowns: 6, interceptions: -2, twoPointConversions: 2 },
        kicking: {
          extraPoint: 1,
          fieldGoal: [
            { min: 0, max: 39, points: 4 },
            { min: 40, max: 49, points: 4 },
            { min: 50, max: null, points: 5 },
          ],
        },
        idp: { soloTackle: 1, sack: 2 },
      },
    })
  );
  expect(await screen.findByText('Scoring settings saved')).toBeInTheDocument();
  expect(onRefresh).toHaveBeenCalled();
});

test('Reset Scoring Settings reverts an edited field back to its default value', async () => {
  mockScoringRules();
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  const touchdownField = await screen.findByLabelText('Touchdown');
  await userEvent.clear(touchdownField);
  await userEvent.type(touchdownField, '99');
  expect(touchdownField).toHaveValue(99);

  await userEvent.click(screen.getByRole('button', { name: 'Reset Scoring Settings' }));
  expect(touchdownField).toHaveValue(4);
});

test('a league\'s existing custom scoring_rules seed the editor over the defaults', async () => {
  mockScoringRules();
  renderTools({ league: league({ scoring_rules: { passing: { touchdowns: 8 } } }) });
  await userEvent.click(screen.getByRole('tab', { name: 'Scoring Settings' }));

  expect(await screen.findByLabelText('Touchdown')).toHaveValue(8);
  expect(screen.getByLabelText('Per Yard')).toHaveValue(0.04); // untouched default
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
        { id: 9, season: 2026, week: 3, home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90, home_team_name: "Alice's Team", away_team_name: "Bob's Team" },
      ],
    },
  });
  apiClient.post.mockResolvedValue({
    data: { id: 9, season: 2026, week: 3, home_team_id: 1, away_team_id: 2, home_score: 105, away_score: 90 },
  });
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
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/correct-week', {
      season: 2026,
      week: 3,
      matchupId: 9,
      homeScore: 105,
      awayScore: 90,
    })
  );
});

test('Matchup Scheduling & Scoring can generate matchups and score a week', async () => {
  apiClient.post.mockResolvedValue({ data: {} });
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  // Defaults (season 2025, week 1) are used as-is.
  await userEvent.click(screen.getByRole('button', { name: 'Generate Matchups' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/matchups', { season: 2025, week: 1 })
  );

  await userEvent.click(screen.getByRole('button', { name: 'Score Week' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/score', { season: 2025, week: 1 })
  );
  expect(onRefresh).toHaveBeenCalled();
});

test('Matchup Scheduling & Scoring surfaces a toast and skips refresh when an op fails', async () => {
  apiClient.post.mockRejectedValue({ response: { data: { error: 'No teams to schedule' } } });
  const onRefresh = jest.fn();
  renderTools({ onRefresh });
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  await userEvent.click(screen.getByRole('button', { name: 'Generate Matchups' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/matchups', { season: 2025, week: 1 })
  );
  expect(await screen.findByText('No teams to schedule')).toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();

  // Score Week fails independently and likewise reports rather than refreshing.
  await userEvent.click(screen.getByRole('button', { name: 'Score Week' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/score', { season: 2025, week: 1 })
  );
  expect(onRefresh).not.toHaveBeenCalled();
});

test('Manual Score Correction preserves input and locks submission after the correction window expires', async () => {
  mockGetByUrl({
    '/matchups': {
      data: [
        { id: 9, season: 2026, week: 3, home_team_id: 1, away_team_id: 2, home_score: 100, away_score: 90, home_team_name: "Alice's Team", away_team_name: "Bob's Team" },
      ],
    },
  });
  apiClient.post.mockRejectedValue({
    response: {
      status: 403,
      data: {
        error: 'CORRECTION_WINDOW_EXPIRED',
        message: 'Manual score modifications for this week are locked.',
      },
    },
  });
  renderTools();
  await userEvent.click(screen.getByRole('tab', { name: 'System Overrides' }));

  const teamSelects = screen.getAllByLabelText('Team');
  await userEvent.click(teamSelects[2]);
  await userEvent.click(await screen.findByRole('option', { name: "Alice's Team" }));
  await userEvent.click(screen.getByLabelText('Week'));
  await userEvent.click(await screen.findByRole('option', { name: 'Week 3' }));

  expect(await screen.findByText(/Current score:/)).toBeInTheDocument();
  const adjustmentInput = screen.getByLabelText('Adjustment (+/-)');
  await userEvent.type(adjustmentInput, '5');
  const submitButton = screen.getByRole('button', { name: 'Apply Correction' });
  await userEvent.click(submitButton);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Manual score modifications for this week are locked.'
  );
  expect(submitButton).toBeDisabled();
  expect(adjustmentInput).toHaveValue(5);
  expect(screen.getByText(/Current score:/)).toHaveTextContent('Current score: 100');
  expect(screen.getByText('Manual Score Correction')).toBeInTheDocument();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.put).not.toHaveBeenCalled();
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
