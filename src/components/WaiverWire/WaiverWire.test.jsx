import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
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
  expect(
    screen.getByText(new Date('2026-07-12T15:00:00.000Z').toLocaleString())
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

test('submitting a claim with no drop player posts the correct body and refetches', async () => {
  setupGet({ waivers: waiversResponse(), roster: rosterResponse() });
  apiClient.post.mockResolvedValue({});
  renderScreen();

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
  expect(await screen.findByText('Claim submitted')).toBeInTheDocument();
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
  renderScreen();

  await screen.findByText('Jaylen Warren');
  expect(screen.getByText('Isiah Pacheco')).toBeInTheDocument();
  expect(screen.getByText('Won weekly waiver run')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/waivers/claim/1?leagueId=1')
  );
  expect(await screen.findByText('Claim cancelled')).toBeInTheDocument();
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

test('clicking the Upgrade column header sorts the on-waivers table by upgrade delta', async () => {
  setupGet({
    waivers: waiversResponse({
      onWaivers: [
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
      ],
    }),
    roster: rosterResponse(),
    suggestions: {
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
    },
  });
  renderScreen();

  await screen.findByText('Breece Hall');
  await userEvent.click(screen.getByText('Upgrade'));

  const rows = screen.getAllByRole('row').slice(1); // drop the header row
  expect(within(rows[0]).getByText('Jaylen Warren')).toBeInTheDocument();
});
