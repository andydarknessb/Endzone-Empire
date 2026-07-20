import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import App from './App';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';

// App's routes mount real page components (LeagueManagement, UserPage,
// DraftBoard, ...); every one of them fetches via apiClient (and DraftBoard
// opens a socket) as soon as it mounts. Mock both broadly here so routing
// tests don't trigger real network/socket activity — each page's own
// fetch/render behavior already has dedicated coverage in its own test file.
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), put: jest.fn() },
}));
jest.mock('../../api/socket', () => ({
  createDraftSocket: jest.fn(),
  onReconnect: jest.fn((socket, handler) => socket.io.on('reconnect', handler)),
}));

const mockStore = configureMockStore([]);

function renderApp(hash, state = {}, configureApi) {
  window.location.hash = hash;
  apiClient.get.mockResolvedValue({ data: [] });
  createDraftSocket.mockReturnValue({
    on: jest.fn(),
    io: { on: jest.fn() },
    emit: jest.fn(),
    disconnect: jest.fn(),
  });
  if (configureApi) configureApi(); // runs after the defaults, before mount
  const store = mockStore({
    user: {},
    errors: { loginMessage: '', registrationMessage: '' },
    ...state,
  });
  return { ...render(<Provider store={store}><App /></Provider>), store };
}

afterEach(() => {
  window.location.hash = '';
  jest.clearAllMocks();
});

const loggedOut = {};
const loggedIn = { id: 1, username: 'alice' };

test('"/" redirects to "/home", showing the Landing page when logged out', async () => {
  renderApp('#/', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Welcome to Endzone Empire' })).toBeInTheDocument();
});

test('"/home" redirects to "/user" when already logged in', async () => {
  renderApp('#/home', { user: loggedIn });
  expect(await screen.findByText('Welcome, alice!')).toBeInTheDocument();
});

test('"/login" shows the login form when logged out', async () => {
  renderApp('#/login', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
});

test('"/login" redirects to "/user" when already logged in', async () => {
  renderApp('#/login', { user: loggedIn });
  expect(await screen.findByText('Welcome, alice!')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Login' })).not.toBeInTheDocument();
});

test('"/registration" shows the registration form when logged out', async () => {
  renderApp('#/registration', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: /build your dream team today/i })).toBeInTheDocument();
});

test('"/registration" redirects to "/user" when already logged in', async () => {
  renderApp('#/registration', { user: loggedIn });
  expect(await screen.findByText('Welcome, alice!')).toBeInTheDocument();
});

test('"/about" is visible whether logged out or in', async () => {
  renderApp('#/about', { user: loggedOut });
  expect(await screen.findByText('This about page is for anyone to read!')).toBeInTheDocument();
});

test('"/user" shows LoginPage (via ProtectedRoute) when logged out', async () => {
  renderApp('#/user', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
});

test('"/user" shows UserPage when logged in', async () => {
  renderApp('#/user', { user: loggedIn });
  expect(await screen.findByText('Welcome, alice!')).toBeInTheDocument();
});

test('"/info" is protected: LoginPage when logged out, InfoPage when logged in', async () => {
  const { unmount } = renderApp('#/info', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/info', { user: loggedIn });
  expect(await screen.findByText('Info Page')).toBeInTheDocument();
});

test('"/league" is protected: LoginPage when logged out, LeagueManagement when logged in', async () => {
  const { unmount } = renderApp('#/league', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league', { user: loggedIn });
  expect(await screen.findByRole('heading', { name: 'My Leagues' })).toBeInTheDocument();
});

test('"/discover" is protected: LoginPage when logged out, LeagueDiscovery when logged in', async () => {
  const { unmount } = renderApp('#/discover', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/discover', { user: loggedIn }, () => {
    apiClient.get.mockResolvedValue({ data: [] });
  });
  expect(await screen.findByRole('heading', { name: 'Discover Leagues' })).toBeInTheDocument();
});

test('"/team" is protected: LoginPage when logged out, TeamManagement when logged in', async () => {
  const { unmount } = renderApp('#/team', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/team', { user: loggedIn });
  expect(await screen.findByRole('heading', { name: 'Team Management' })).toBeInTheDocument();
});

test('"/player" is protected: LoginPage when logged out, PlayerManagement when logged in', async () => {
  const { unmount } = renderApp('#/player', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/player', { user: loggedIn }, () => {
    apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1 } });
  });
  expect(await screen.findByRole('heading', { name: 'My Roster' })).toBeInTheDocument();
});

test('"/league/:leagueId" is protected: LoginPage when logged out, LeagueDashboard when logged in', async () => {
  const { unmount } = renderApp('#/league/1', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1', { user: loggedIn }, () => {
    // URL-keyed (not ordered) because the Nav's NotificationBell also fetches
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/league/1') {
        return Promise.resolve({ data: { league: { id: 1, name: 'Sunday Ballers', draft_status: 'pending', owner_id: 1, roster_limit: 15, max_teams: 10 }, teams: [] } });
      }
      if (url === '/api/user') return Promise.resolve({ data: { id: 1, username: 'alice' } });
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByText('Sunday Ballers')).toBeInTheDocument();
});

test('"/league/:leagueId/matchups" is protected and renders MatchupScreen when logged in', async () => {
  const { unmount } = renderApp('#/league/1/matchups', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/matchups', { user: loggedIn }, () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/league/1') {
        return Promise.resolve({ data: { league: { id: 1, name: 'Sunday Ballers', owner_id: 99 } } });
      }
      if (url === '/api/user') return Promise.resolve({ data: { id: 1, username: 'alice' } });
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByText(/Matchups/)).toBeInTheDocument();
});

test('"/league/:leagueId/lineup" is protected and renders LineupScreen when logged in', async () => {
  const { unmount } = renderApp('#/league/1/lineup', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/lineup', { user: loggedIn }, () => {
    apiClient.get.mockResolvedValue({
      data: {
        leagueId: 1, teamId: 10, season: 2026, week: 1, currentWeek: 1,
        lineupSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
        irSlots: 1,
        entries: [],
      },
    });
  });
  expect(await screen.findByText('Set Lineup')).toBeInTheDocument();
});

test('"/league/:leagueId/matchups/:matchupId" is protected and renders MatchupDetail when logged in', async () => {
  const { unmount } = renderApp('#/league/1/matchups/9', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/matchups/9', { user: loggedIn }, () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/league/1/matchups/9') {
        return Promise.resolve({
          data: {
            matchup: {
              id: 9, week: 3, season: 2026, home_score: '10', away_score: '8',
              final: false, is_playoff: false,
              home_team_name: 'Team A', away_team_name: 'Team B',
            },
            home: { teamId: 1, name: 'Team A', starters: [] },
            away: { teamId: 2, name: 'Team B', starters: [] },
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByText(/Week 3 Matchup/)).toBeInTheDocument();
});

test('"/league/:leagueId/draft" is protected and renders DraftBoard when logged in', async () => {
  const { unmount } = renderApp('#/league/1/draft', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/draft', { user: loggedIn }, () => {
    apiClient.get.mockResolvedValue({ data: { players: [], totalPages: 1 } });
  });
  expect(await screen.findByText('Draft Board')).toBeInTheDocument();
});

test('"/league/:leagueId/waivers" is protected and renders WaiverWire when logged in', async () => {
  const { unmount } = renderApp('#/league/1/waivers', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/waivers', { user: loggedIn }, () => {
    apiClient.get.mockImplementation((url) => {
      if (String(url).startsWith('/api/waivers')) {
        return Promise.resolve({
          data: {
            league: { waiver_type: 'priority', waiver_period_hours: 24, faab_budget: 100 },
            myTeam: { id: 10, waiver_priority: 1, faab_remaining: 100 },
            onWaivers: [],
            myClaims: [],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByText('Waiver Wire')).toBeInTheDocument();
});

test('"/league/:leagueId/trades" is protected and renders TradeCenter when logged in', async () => {
  const { unmount } = renderApp('#/league/1/trades', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/trades', { user: loggedIn }, () => {
    apiClient.get.mockImplementation((url) => {
      if (String(url).startsWith('/api/trades')) {
        return Promise.resolve({ data: { myTeamId: 10, trades: [] } });
      }
      if (url === '/api/league/1') {
        return Promise.resolve({ data: { league: { id: 1, name: 'Sunday Ballers', owner_id: 99 }, teams: [] } });
      }
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByText('Trade Center')).toBeInTheDocument();
});

test('"/league/:leagueId/activity" is protected and renders TransactionLog when logged in', async () => {
  const { unmount } = renderApp('#/league/1/activity', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/activity', { user: loggedIn });
  expect(await screen.findByText('League Activity')).toBeInTheDocument();
});

test('"/players/:playerId" is protected and renders PlayerDetail when logged in', async () => {
  const { unmount } = renderApp('#/players/5', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/players/5', { user: loggedIn }, () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/players/5/summary') {
        return Promise.resolve({
          data: {
            player: { id: 5, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC' },
            fantasy: {},
            currentSeason: null,
            previousSeasons: [],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByText('Patrick Mahomes')).toBeInTheDocument();
});

test('"/league/:leagueId/history" is protected and renders LeagueHistory when logged in', async () => {
  const { unmount } = renderApp('#/league/1/history', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/league/1/history', { user: loggedIn }, () => {
    apiClient.get.mockResolvedValue({ data: { seasons: [] } });
  });
  expect(await screen.findByText('League History')).toBeInTheDocument();
});

test('"/settings/notifications" is protected and renders NotificationPrefs when logged in', async () => {
  const { unmount } = renderApp('#/settings/notifications', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/settings/notifications', { user: loggedIn }, () => {
    apiClient.get.mockResolvedValue({
      data: { lineupReminder: true, waiverResults: false, weeklyRecap: true, tradeOffers: false },
    });
  });
  expect(await screen.findByRole('heading', { name: 'Notification Settings' })).toBeInTheDocument();
});

test('"/admin" is protected: LoginPage when logged out, AdminDashboard when logged in', async () => {
  const { unmount } = renderApp('#/admin', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: 'Login' })).toBeInTheDocument();
  unmount();

  renderApp('#/admin', { user: loggedIn }, () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/admin/overview') {
        return Promise.resolve({
          data: {
            users: { total: 5, signupsLast7Days: 1, signupsLast30Days: 2 },
            leagues: [],
            recentSignups: [],
            sync: {
              scheduler: { lastTickAt: null, lastTickError: null, lastSyncAt: null },
              statsCoverage: { season: null, week: null, rows: 0 },
              rapidApiConfigured: true,
            },
            errors: { sentryConfigured: true, errorsSinceBoot: 0, lastErrorAt: null, lastErrorMessage: null },
            uptimeSec: 100,
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
  });
  expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
});

test('an unmatched route shows the 404 page', async () => {
  renderApp('#/this-route-does-not-exist', { user: loggedOut });
  expect(await screen.findByRole('heading', { name: '404' })).toBeInTheDocument();
});

test('always renders the Nav and Footer around the routed page', async () => {
  renderApp('#/about', { user: loggedOut });
  expect(await screen.findByRole('link', { name: 'Endzone Empire' })).toBeInTheDocument();
  expect(screen.getByText('© Endzone Empire')).toBeInTheDocument();
});

test('dispatches FETCH_USER on mount', () => {
  const { store } = renderApp('#/about', { user: loggedOut });
  expect(store.getActions()).toContainEqual({ type: 'FETCH_USER' });
});
