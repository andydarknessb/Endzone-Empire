import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { formatRelative } from '../../utils/formatRelative';
import { SnackbarProvider } from '../Snackbar/SnackbarProvider';
import WaiverWire from './WaiverWire';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const renderScreen = (leagueId = 1) =>
  renderWithProviders(<WaiverWire />, {
    path: '/league/:leagueId/waivers',
    route: `/league/${leagueId}/waivers`,
  });

// Toast text (via notify) only renders when a SnackbarProvider is mounted.
const renderScreenWithToasts = (leagueId = 1) =>
  renderWithProviders(
    <SnackbarProvider>
      <WaiverWire />
    </SnackbarProvider>,
    {
      path: '/league/:leagueId/waivers',
      route: `/league/${leagueId}/waivers`,
    }
  );

const waiversResponse = (overrides = {}) => ({
  league: {
    waiver_type: 'priority',
    waiver_period_hours: 24,
    faab_budget: 100,
    waivers_clear_at: null,
  },
  myTeam: { id: 10, waiver_priority: 3, faab_remaining: 85 },
  onWaivers: [
    {
      id: 7,
      name: 'Breece Hall',
      position: 'RB',
      nfl_team: 'New York Jets',
      available_at: '2026-07-12T15:00:00.000Z',
    },
  ],
  myClaims: [],
  ...overrides,
});

const rosterResponse = () => [
  { id: 20, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills' },
  { id: 21, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins' },
];

const rosterWithProjectionsResponse = () => [
  { id: 20, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills', projected_weekly_points: 22.4 },
  { id: 21, name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins', projected_weekly_points: 15.1 },
  { id: 22, name: 'Bench Warmer', position: 'WR', nfl_team: 'Free Agent', projected_weekly_points: 3.2 },
];

const suggestionsResponse = (overrides = {}) => ({
  suggestions: [
    {
      playerId: 7,
      name: 'Breece Hall',
      position: 'RB',
      nflTeam: 'New York Jets',
      projection: 14.2,
      weakestStarterProjection: 8.9,
      upgradeDelta: 5.3,
    },
  ],
  ...overrides,
});

const setupGet = ({ waivers, roster, suggestions = { suggestions: [] } }) => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers/suggestions')) return Promise.resolve({ data: suggestions });
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waivers });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: roster });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
};

afterEach(() => {
  jest.clearAllMocks();
});

test('shows skeleton placeholders before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders the on-waivers table and the priority chip', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('RB')).toBeInTheDocument();
  expect(screen.getByText('New York Jets')).toBeInTheDocument();
  expect(screen.getByText('Waiver priority: #3')).toBeInTheDocument();
  expect(screen.getByText(formatRelative('2026-07-12T15:00:00.000Z'))).toBeInTheDocument();
});

test('the Clears cell shows the absolute time in a tooltip', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  const relativeText = screen.getByText(formatRelative('2026-07-12T15:00:00.000Z'));
  await userEvent.hover(relativeText);

  expect(
    await screen.findByText(new Date('2026-07-12T15:00:00.000Z').toLocaleString())
  ).toBeInTheDocument();
});

test('a FAAB league shows the FAAB chip and a bid field in the claim dialog', async () => {
  setupGet({
    waivers: waiversResponse({
      league: {
        waiver_type: 'faab',
        waiver_period_hours: 24,
        faab_budget: 100,
        waivers_clear_at: null,
      },
    }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('FAAB remaining: $85')).toBeInTheDocument();
  expect(screen.queryByLabelText('Bid')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  expect(screen.getByLabelText('Bid')).toBeInTheDocument();
});

const faabLeagueOverride = {
  waiver_type: 'faab',
  waiver_period_hours: 24,
  faab_budget: 100,
  waivers_clear_at: null,
};

test('an empty or negative FAAB bid disables Submit and shows an error state', async () => {
  setupGet({
    waivers: waiversResponse({ league: faabLeagueOverride }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  const submitButton = screen.getByRole('button', { name: 'Submit Claim' });
  const bidInput = screen.getByLabelText('Bid');

  // Empty bid: disabled and already in an error state (nothing valid to submit).
  expect(submitButton).toBeDisabled();
  expect(screen.getByText('Enter a bid between $0 and $85')).toBeInTheDocument();

  // Negative bid: error state + still disabled.
  await userEvent.type(bidInput, '-5');
  expect(submitButton).toBeDisabled();
  expect(screen.getByText('Enter a bid between $0 and $85')).toBeInTheDocument();
});

test('a FAAB bid over budget shows an error state and disables Submit', async () => {
  setupGet({
    waivers: waiversResponse({ league: faabLeagueOverride }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  const bidInput = screen.getByLabelText('Bid');
  await userEvent.type(bidInput, '90');

  expect(screen.getByRole('button', { name: 'Submit Claim' })).toBeDisabled();
  expect(screen.getByText('Enter a bid between $0 and $85')).toBeInTheDocument();
});

test('a valid FAAB bid within budget enables Submit and posts the bid amount', async () => {
  setupGet({
    waivers: waiversResponse({ league: faabLeagueOverride }),
    roster: rosterResponse(),
  });
  apiClient.post.mockResolvedValue({});
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  const bidInput = screen.getByLabelText('Bid');
  await userEvent.type(bidInput, '40');

  const submitButton = screen.getByRole('button', { name: 'Submit Claim' });
  expect(submitButton).not.toBeDisabled();
  expect(screen.getByText('$85 remaining')).toBeInTheDocument();
  await userEvent.click(submitButton);

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: null,
      bid: 40,
    })
  );
});

test('submitting a claim with no drop player posts the correct body and refetches', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockResolvedValue({});
  renderScreenWithToasts();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: null,
      bid: 0,
    })
  );
  expect(await screen.findByText('Waiver claim submitted')).toBeInTheDocument();
  // Waiver list refetches after the claim (suggestions calls don't count):
  // one on mount, one after.
  await waitFor(() => {
    const waiverGets = apiClient.get.mock.calls.filter(([url]) =>
      url.startsWith('/api/waivers?')
    );
    expect(waiverGets).toHaveLength(2);
  });
});

test('selecting a drop player includes its id in the claim request', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockResolvedValue({});
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  await userEvent.click(screen.getByLabelText('Drop a player (optional)'));
  await userEvent.click(await screen.findByRole('option', { name: 'Josh Allen (QB)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
      leagueId: 1,
      playerId: 7,
      dropPlayerId: 20,
      bid: 0,
    })
  );
});

test('drop-select options are sorted worst-weekly-projection-first with a weekly proj caption', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterWithProjectionsResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByLabelText('Drop a player (optional)'));

  const options = await screen.findAllByRole('option');
  // "No drop" first, then worst projected_weekly_points -> best.
  expect(within(options[1]).getByText(/Bench Warmer \(WR\)/)).toBeInTheDocument();
  expect(within(options[1]).getByText('weekly proj 3.2')).toBeInTheDocument();
  expect(within(options[2]).getByText(/Tyreek Hill \(WR\)/)).toBeInTheDocument();
  expect(within(options[3]).getByText(/Josh Allen \(QB\)/)).toBeInTheDocument();
});

test('preselects the roster player a waiver suggestion pairs with the claimed pickup', async () => {
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    suggestions: suggestionsResponse({
      suggestions: [
        {
          playerId: 7,
          name: 'Breece Hall',
          position: 'RB',
          nflTeam: 'New York Jets',
          projection: 14.2,
          weakestStarterProjection: 8.9,
          upgradeDelta: 5.3,
          dropPlayerId: 21,
        },
      ],
    }),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  expect(await screen.findByText('Tyreek Hill (WR)')).toBeInTheDocument();
});

test('does not preselect a drop when the suggestion has no valid roster pairing', async () => {
  setupGet({
    waivers: waiversResponse(),
    roster: rosterResponse(),
    suggestions: suggestionsResponse({
      suggestions: [
        {
          playerId: 7,
          name: 'Breece Hall',
          position: 'RB',
          nflTeam: 'New York Jets',
          projection: 14.2,
          weakestStarterProjection: 8.9,
          upgradeDelta: 5.3,
          dropPlayerId: 999, // not on this roster
        },
      ],
    }),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

  // MUI renders an empty-string Select value as blank rather than the "No
  // drop" label itself, so assert the absence of either roster option instead.
  expect(screen.queryByText('Josh Allen (QB)')).not.toBeInTheDocument();
  expect(screen.queryByText('Tyreek Hill (WR)')).not.toBeInTheDocument();
});

test('shows a Cancel button only for pending claims and cancels correctly', async () => {
  setupGet({
    waivers: waiversResponse({
      myClaims: [
        {
          id: 1,
          player_id: 8,
          player_name: 'Jaylen Warren',
          player_position: 'RB',
          drop_player_name: null,
          bid: 0,
          status: 'pending',
          note: null,
          created_at: '2026-07-10T12:00:00.000Z',
        },
        {
          id: 2,
          player_id: 9,
          player_name: 'Isiah Pacheco',
          player_position: 'RB',
          drop_player_name: null,
          bid: 0,
          status: 'won',
          note: 'Won weekly waiver run',
          created_at: '2026-07-09T12:00:00.000Z',
        },
      ],
    }),
    roster: rosterResponse(),
  });
  apiClient.delete.mockResolvedValue({});
  renderScreenWithToasts();

  await screen.findByText('Jaylen Warren');
  expect(screen.getByText('Isiah Pacheco')).toBeInTheDocument();
  expect(screen.getByText('Won weekly waiver run')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/waivers/claim/1?leagueId=1')
  );
  expect(await screen.findByText('Waiver claim cancelled')).toBeInTheDocument();
});

test('a server error when submitting a claim is surfaced', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockRejectedValue({
    response: { data: { error: 'You have reached the claim limit' } },
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByRole('button', { name: 'Claim' }));
  await userEvent.click(screen.getByRole('button', { name: 'Submit Claim' }));

  expect(await screen.findByText('You have reached the claim limit')).toBeInTheDocument();
});

test('shows empty states when there are no waiver players or claims', async () => {
  setupGet({
    waivers: waiversResponse({ onWaivers: [], myClaims: [] }),
    roster: rosterResponse(),
  });
  renderScreen();

  expect(await screen.findByText('No players on waivers')).toBeInTheDocument();
  expect(screen.getByText('No claims yet')).toBeInTheDocument();
});

test('empty waivers Browse Players opens the player pool filtered to available players', async () => {
  setupGet({
    waivers: waiversResponse({ onWaivers: [], myClaims: [] }),
    roster: rosterResponse(),
  });
  renderScreen();

  await screen.findByText('No players on waivers');
  // hide=1 is the Players page's "Hide rostered" filter, so the CTA lands on
  // the pool already scoped to unrostered/available players.
  expect(screen.getByRole('link', { name: /browse players/i })).toHaveAttribute(
    'href',
    '/player?hide=1'
  );
});

test('shows an error alert when the initial fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'waivers unavailable' } } });

  renderScreen();

  expect(await screen.findByText('waivers unavailable')).toBeInTheDocument();
});

test('renders an Upgrade badge for a player with a suggested pickup', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse(), suggestions: suggestionsResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('+5.3')).toBeInTheDocument();
});

test('does not show an upgrade badge for a player without a suggestion', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse(), suggestions: { suggestions: [] } });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
});

test('a failed suggestions fetch is silently ignored (no badges, no error)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers/suggestions')) return Promise.reject(new Error('boom'));
    if (url.startsWith('/api/waivers')) return Promise.resolve({ data: waiversResponse() });
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: rosterResponse() });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a best-ball league hides the Upgrade column and skips the suggestions fetch', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/waivers/suggestions')) {
      throw new Error('suggestions should not be fetched for a best-ball league');
    }
    if (url.startsWith('/api/waivers')) {
      return Promise.resolve({
        data: waiversResponse({
          league: {
            waiver_type: 'priority',
            waiver_period_hours: 24,
            faab_budget: 100,
            waivers_clear_at: null,
            best_ball: true,
          },
        }),
      });
    }
    if (url.startsWith('/api/team/roster')) return Promise.resolve({ data: rosterResponse() });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
  expect(
    apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/waivers/suggestions'))
  ).toBe(false);
});

test('a non-best-ball league still shows the Upgrade column', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  renderScreen();

  await screen.findByText('Breece Hall');
  expect(screen.getByText('Upgrade')).toBeInTheDocument();
});

const twoWaiverPlayers = () => [
  {
    id: 7,
    name: 'Breece Hall',
    position: 'RB',
    nfl_team: 'New York Jets',
    available_at: '2026-07-12T15:00:00.000Z',
  },
  {
    id: 8,
    name: 'Jaylen Warren',
    position: 'RB',
    nfl_team: 'Pittsburgh Steelers',
    available_at: '2026-07-12T15:00:00.000Z',
  },
];

const twoPlayerSuggestions = () => ({
  suggestions: [
    {
      playerId: 7,
      name: 'Breece Hall',
      position: 'RB',
      nflTeam: 'New York Jets',
      projection: 14.2,
      weakestStarterProjection: 8.9,
      upgradeDelta: 2.1,
    },
    {
      playerId: 8,
      name: 'Jaylen Warren',
      position: 'RB',
      nflTeam: 'Pittsburgh Steelers',
      projection: 15.0,
      weakestStarterProjection: 8.9,
      upgradeDelta: 6.1,
    },
  ],
});

test('defaults the on-waivers sort to upgrade-desc once suggestions arrive', async () => {
  setupGet({
    waivers: waiversResponse({ onWaivers: twoWaiverPlayers() }),
    roster: rosterResponse(),
    suggestions: twoPlayerSuggestions(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await waitFor(() => {
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(within(rows[0]).getByText('Jaylen Warren')).toBeInTheDocument();
  });
});

test('clicking the Upgrade column header toggles the default sort direction', async () => {
  setupGet({
    waivers: waiversResponse({ onWaivers: twoWaiverPlayers() }),
    roster: rosterResponse(),
    suggestions: twoPlayerSuggestions(),
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  // Auto-sorted desc already (Jaylen Warren's +6.1 first); one click on an
  // already-active sort flips the direction, not re-applies the same one.
  await waitFor(() => {
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Jaylen Warren')).toBeInTheDocument();
  });

  await userEvent.click(screen.getByText('Upgrade'));

  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('Breece Hall')).toBeInTheDocument();
});

test('the sort toggle can still be engaged manually when there are no suggestions', async () => {
  setupGet({
    waivers: waiversResponse({ onWaivers: twoWaiverPlayers() }),
    roster: rosterResponse(),
    suggestions: { suggestions: [] },
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  // No suggestions, so nothing auto-sorted; a manual click still works and
  // doesn't crash with no upgrade data to rank against.
  await userEvent.click(screen.getByText('Upgrade'));
  const rows = screen.getAllByRole('row').slice(1);
  expect(within(rows[0]).getByText('Breece Hall')).toBeInTheDocument();
});
