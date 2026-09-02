import React from 'react';
import { screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { createDraftSocket, onReconnect } from '../../api/socket';
import { clearLeagueCache } from '../../hooks/useLeague';
import GameCenter from './GameCenter';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn(),
}));

const renderScreen = (leagueId = 1, state = {}) =>
  renderWithProviders(<GameCenter />, {
    path: '/league/:leagueId/game-center',
    route: `/league/${leagueId}/game-center`,
    state,
  });

const matchup = (overrides = {}) => ({
  id: 1,
  season: 2025,
  week: 1,
  home_team_id: 10,
  away_team_id: 20,
  home_team_name: 'Home Team',
  away_team_name: 'Away Team',
  home_score: 0,
  away_score: 0,
  final: false,
  ...overrides,
});

function mockApi({
  matchups = [],
  league = { id: 1, name: 'Sunday Ballers', owner_id: 1 },
  rosters = [],
  detail = null,
  viewerTeamId = null,
} = {}) {
  apiClient.get.mockImplementation((url) => {
    if (/\/matchups\/\d+$/.test(url)) {
      return detail ? Promise.resolve({ data: detail }) : Promise.reject(new Error('no detail mocked'));
    }
    if (url.endsWith('/matchups')) return Promise.resolve({ data: matchups });
    if (url.endsWith('/rosters')) return Promise.resolve({ data: rosters });
    return Promise.resolve({ data: { league, viewerTeamId } });
  });
}

let mockSocket;
let socketHandlers;
let reconnectHandlers;

beforeEach(() => {
  socketHandlers = {};
  reconnectHandlers = [];
  mockSocket = {
    on: jest.fn((event, cb) => {
      socketHandlers[event] = cb;
    }),
    io: {
      on: jest.fn((event, cb) => {
        reconnectHandlers.push(cb);
      }),
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  createDraftSocket.mockReturnValue(mockSocket);
  onReconnect.mockImplementation((socket, handler) => socket.io.on('reconnect', handler));

  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterEach(() => {
  jest.clearAllMocks();
  clearLeagueCache();
});

test('shows a loading skeleton before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderScreen();
  expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
});

test('renders the league name and each matchup as a card', async () => {
  mockApi({ matchups: [matchup({ home_score: 20, away_score: 10 })] });

  renderScreen();

  expect(await screen.findByText(/Sunday Ballers/)).toBeInTheDocument();
  expect(screen.getByText('League Matchups')).toBeInTheDocument();
  expect(screen.getByText('Home Team (20)')).toBeInTheDocument();
  expect(screen.getByText('Away Team (10)')).toBeInTheDocument();
  // Team-initials avatars on the compact league cards.
  expect(screen.getByText('HT')).toBeInTheDocument();
  expect(screen.getByText('AT')).toBeInTheDocument();
});

test('renders the viewer matchup as a hero card, out of the grid', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_id: 10, away_team_id: 20, home_team_name: 'My Team', away_team_name: 'Rival', home_score: 30, away_score: 20, final: true }),
      matchup({ id: 2, week: 1, home_team_id: 30, away_team_id: 40, home_team_name: 'Other A', away_team_name: 'Other B' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99, current_week: 1 },
    rosters: [{ teamId: 10, teamName: 'My Team' }, { teamId: 20, teamName: 'Rival' }],
    viewerTeamId: 10,
  });

  renderScreen(1, { user: { id: 1 } });

  expect(await screen.findByText('Your Matchup · Week 1')).toBeInTheDocument();
  expect(screen.getByText('My Team')).toBeInTheDocument();
  expect(screen.queryByText('Rival (20)')).not.toBeInTheDocument();
  expect(screen.getByText('Other A (0)')).toBeInTheDocument();
  // A completed matchup shows win probability; fabricated projections are gone.
  expect(screen.getByText('Win Probability')).toBeInTheDocument();
  expect(screen.queryByText(/Projected:/)).not.toBeInTheDocument();
  expect(screen.getAllByLabelText(/PMR: Players remaining/i)).toHaveLength(2);
  expect(screen.getByRole('region', { name: 'Live scoring feed' })).toHaveTextContent('No scoring plays yet');
});

// #188: the hero card asks "which of these is me" through the per-viewer
// viewerTeamId from league detail, never by matching an account id against an
// `ownerId` on the league-shared rosters payload. The fixture below is the
// post-#115 shape - rosters carry Team identity and no account field at all -
// and a viewer whose team is in a matchup must still get their hero card.
test('finds the viewer matchup with no account field on the rosters payload', async () => {
  mockApi({
    matchups: [
      matchup({ id: 1, week: 1, home_team_id: 10, away_team_id: 20, home_team_name: 'My Team', away_team_name: 'Rival', home_score: 30, away_score: 20, final: true }),
      matchup({ id: 2, week: 1, home_team_id: 30, away_team_id: 40, home_team_name: 'Other A', away_team_name: 'Other B' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
    rosters: [{ teamId: 10, teamName: 'My Team' }, { teamId: 20, teamName: 'Rival' }],
    viewerTeamId: 10,
  });

  renderScreen(1, { user: { id: 1 } });

  expect(await screen.findByText('Your Matchup · Week 1')).toBeInTheDocument();
  expect(screen.getByText('Other A (0)')).toBeInTheDocument();
});

// The mirror of the test above: a viewer holding no Team on this league gets
// no hero card. Without the null guard the two nulls would match and every
// such reader would be handed someone else's matchup.
test('gives a viewer with no team on this league no hero card', async () => {
  mockApi({
    matchups: [matchup({ id: 1, week: 1, home_team_id: 10, away_team_id: 20 })],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
    rosters: [{ teamId: 10, teamName: 'Home Team' }, { teamId: 20, teamName: 'Away Team' }],
    viewerTeamId: null,
  });

  renderScreen(1, { user: { id: 1 } });

  expect(await screen.findByText('Home Team (0)')).toBeInTheDocument();
  expect(screen.queryByText(/Your Matchup/)).not.toBeInTheDocument();
});

test('shows not started instead of a 50/50 probability before kickoff', async () => {
  mockApi({
    matchups: [matchup()],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
    rosters: [{ teamId: 10, teamName: 'Home Team' }],
    viewerTeamId: 10,
  });
  renderScreen(1, { user: { id: 1 } });

  expect(await screen.findByText('Not started · Week 1')).toBeInTheDocument();
  expect(screen.queryByText('Win Probability')).not.toBeInTheDocument();
});

test('shows an idle message in the live-action ticker before any plays arrive', async () => {
  mockApi({ matchups: [matchup({ home_score: 20, away_score: 10 })] });

  renderScreen();

  const ticker = await screen.findByTestId('live-action-ticker');
  expect(ticker).toHaveTextContent('Live scoring plays will appear here once games kick off.');
});

test('attributes a live scoring play to the scoring player\'s real fantasy team', async () => {
  mockApi({
    matchups: [matchup({ id: 5, week: 1, home_score: 0, away_score: 0 })],
    rosters: [
      { teamId: 10, teamName: 'Home Team', players: [{ id: 99, name: 'Speedy Runner' }] },
      { teamId: 20, teamName: 'Away Team', players: [] },
    ],
  });

  renderScreen();
  await screen.findByText('Home Team (0)');

  act(() => {
    socketHandlers['scores:updated']({
      leagueId: 1,
      season: 2025,
      week: 1,
      scored: [{ matchupId: 5, homeScore: 6, awayScore: 0 }],
      plays: [{ playerId: 99, name: 'Speedy Runner', type: 'rushing', pointsDelta: 6 }],
    });
  });

  const ticker = await screen.findByTestId('live-action-ticker');
  expect(ticker).toHaveTextContent('Speedy Runner');
  expect(ticker).toHaveTextContent('rushing TD');
  expect(ticker).toHaveTextContent('Home Team');
  const feed = screen.getByRole('region', { name: 'Live scoring feed' });
  expect(within(feed).getByText('🏈 TD: Speedy Runner · rushing TD (+6 pts to Home Team)')).toBeInTheDocument();
});

test('ignores a scoring play from a week other than the one on screen', async () => {
  mockApi({
    matchups: [matchup({ id: 5, week: 1, home_score: 0, away_score: 0 })],
    rosters: [{ teamId: 10, teamName: 'Home Team', players: [{ id: 99, name: 'Speedy Runner' }] }],
  });

  renderScreen();
  await screen.findByText('Home Team (0)');

  act(() => {
    socketHandlers['scores:updated']({
      leagueId: 1,
      season: 2025,
      week: 2,
      scored: [],
      plays: [{ playerId: 99, name: 'Speedy Runner', type: 'rushing', pointsDelta: 6 }],
    });
  });

  const ticker = screen.getByTestId('live-action-ticker');
  expect(ticker).toHaveTextContent('Live scoring plays will appear here once games kick off.');
});

test('receiving scores:updated updates a card score and shows a LIVE chip', async () => {
  mockApi({ matchups: [matchup({ id: 5, home_score: 0, away_score: 0 })] });

  renderScreen();
  await screen.findByText('Home Team (0)');

  act(() => {
    socketHandlers['scores:updated']({
      leagueId: 1,
      season: 2025,
      week: 1,
      scored: [{ matchupId: 5, homeScore: 21, awayScore: 14 }],
      plays: [],
    });
  });

  expect(await screen.findByText('Home Team (21)')).toBeInTheDocument();
  expect(screen.getByText('Away Team (14)')).toBeInTheDocument();
  expect(screen.getByText('LIVE')).toBeInTheDocument();
});

test('every card — hero and list — links directly to its box score, no intermediate modal', async () => {
  mockApi({
    matchups: [
      // The viewer owns team 10, so matchup 4 becomes the hero card.
      matchup({ id: 4, week: 1, home_team_id: 10, away_team_id: 20, home_team_name: 'My Team', away_team_name: 'Rival' }),
      matchup({ id: 5 }),
      matchup({ id: 6, home_team_name: 'Second Home' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', owner_id: 99, current_week: 1 },
    rosters: [{ teamId: 10, teamName: 'My Team' }, { teamId: 20, teamName: 'Rival' }],
    viewerTeamId: 10,
  });

  renderScreen(3, { user: { id: 1 } });
  await screen.findByText('Home Team (0)');

  // The hero card's CardActionArea is itself a plain link to the box score.
  expect(screen.getByRole('link', { name: /My Team/ })).toHaveAttribute(
    'href',
    '/league/3/matchups/4'
  );
  // The list cards are plain links too — no dialog, no detail fetch.
  expect(screen.getByRole('link', { name: /Home Team \(0\)/ })).toHaveAttribute(
    'href',
    '/league/3/matchups/5'
  );
  expect(screen.getByRole('link', { name: /Second Home \(0\)/ })).toHaveAttribute(
    'href',
    '/league/3/matchups/6'
  );

  await userEvent.click(screen.getByText('Home Team (0)'));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/league/3/matchups/5');
});

// The league matchups list carries each side's expected final
// (home_expected_final / away_expected_final, null when the team has no
// lineup for the week or the matchup is final). Both the hero card and the
// League Matchups cards show it, and the hero's win probability is shaped by
// the real totals rather than a pair of zeros.
test('shows expected finals from the matchups payload on the hero card and league matchup cards', async () => {
  mockApi({
    matchups: [
      matchup({
        id: 1, week: 1, home_team_id: 10, away_team_id: 20, home_team_name: 'My Team', away_team_name: 'Rival',
        home_score: 30, away_score: 20, home_expected_final: 100, away_expected_final: 140,
      }),
      matchup({
        id: 2, week: 1, home_team_id: 30, away_team_id: 40, home_team_name: 'Other A', away_team_name: 'Other B',
        home_expected_final: 112.36, away_expected_final: null,
      }),
      matchup({
        id: 3, week: 1, home_team_id: 50, away_team_id: 60, home_team_name: 'Done A', away_team_name: 'Done B',
        home_score: 90, away_score: 80, final: true, home_expected_final: null, away_expected_final: null,
      }),
    ],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
    rosters: [],
    viewerTeamId: 10,
  });

  renderScreen(1, { user: { id: 1 } });

  expect(await screen.findByText('Your Matchup · Week 1')).toBeInTheDocument();
  // Hero: both totals, and a win probability driven by them. Expected finals
  // are 30 + 70 remaining vs 20 + 120 remaining, so the home side trails.
  expect(screen.getByText('Proj: 100.0')).toBeInTheDocument();
  expect(screen.getByText('Proj: 140.0')).toBeInTheDocument();
  expect(screen.getByLabelText('Win probability: My Team 16%, Rival 84%')).toBeInTheDocument();
  // League card: a real total rounds to one decimal; a missing one on an open
  // matchup keeps the dash; a final matchup shows no projection line at all.
  expect(screen.getByText('Proj: 112.4')).toBeInTheDocument();
  expect(screen.getAllByText('Proj: -')).toHaveLength(1);
});

// Expected final (CONTEXT.md) moves with the games: the score sync's
// scores:updated event carries each side's expected final and players
// remaining alongside the scores, and the hero card, its PMR line and the
// league cards all follow it without a refetch. An event from an older
// server that lacks those fields leaves the loaded values in place.
test('scores:updated moves the expected finals and players remaining on the hero and league cards', async () => {
  mockApi({
    matchups: [
      matchup({
        id: 1, week: 1, home_team_id: 10, away_team_id: 20, home_team_name: 'My Team', away_team_name: 'Rival',
        home_score: 0, away_score: 0, home_expected_final: 100, away_expected_final: 140,
        home_players_remaining: 9, away_players_remaining: 9,
      }),
      matchup({
        id: 2, week: 1, home_team_id: 30, away_team_id: 40, home_team_name: 'Other A', away_team_name: 'Other B',
        home_expected_final: 80, away_expected_final: 70, home_players_remaining: 9, away_players_remaining: 9,
      }),
    ],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
    rosters: [],
    viewerTeamId: 10,
  });

  renderScreen(1, { user: { id: 1 } });
  expect(await screen.findByText('Your Matchup · Week 1')).toBeInTheDocument();
  expect(screen.getByText('Proj: 100.0')).toBeInTheDocument();
  expect(screen.getAllByText(/PMR/)).toHaveLength(2);
  expect(screen.getAllByText(/: 9$/)).toHaveLength(2);

  act(() => {
    socketHandlers['scores:updated']({
      leagueId: 1,
      week: 1,
      scored: [
        {
          matchupId: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 41.2, awayScore: 55.9,
          homeExpectedFinal: 104.6, awayExpectedFinal: 131.3, homePlayersRemaining: 5, awayPlayersRemaining: 4,
        },
        // Older-server shape: scores only. Other A / Other B keep their loaded forecast.
        { matchupId: 2, homeTeamId: 30, awayTeamId: 40, homeScore: 12, awayScore: 3 },
      ],
      plays: [],
    });
  });

  expect(screen.getByText('Proj: 104.6')).toBeInTheDocument();
  expect(screen.getByText('Proj: 131.3')).toBeInTheDocument();
  expect(screen.getByText(/: 5$/)).toBeInTheDocument();
  expect(screen.getByText(/: 4$/)).toBeInTheDocument();
  expect(screen.getByText('Proj: 80.0')).toBeInTheDocument();
  expect(screen.getByText('Proj: 70.0')).toBeInTheDocument();
  expect(screen.getByText('Other A (12)')).toBeInTheDocument();
  // Win probability follows the new expected finals: 41.2 + 63.4 vs 55.9 + 75.4 -> margin -26.7.
  expect(screen.getByLabelText('Win probability: My Team 25%, Rival 75%')).toBeInTheDocument();
});
