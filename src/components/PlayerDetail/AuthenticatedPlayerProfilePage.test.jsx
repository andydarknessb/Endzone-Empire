import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import publicApiClient from '../../api/publicApiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import AuthenticatedPlayerProfilePage from './AuthenticatedPlayerProfilePage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const COMPLETE_PROFILE = {
  playerId: 42,
  name: 'Alpha Back',
  position: 'RB',
  nflTeam: 'KC',
  adp: 12.5,
  season: 2025,
  seasons: [
    { season: 2026, status: 'pending' },
    { season: 2025, status: 'complete' },
  ],
  seasonSummary: {
    season: 2025,
    gamesPlayed: 17,
    points: { standard: 300, halfPpr: 340, ppr: 380 },
    pointsPerGame: { standard: 17.6, halfPpr: 20, ppr: 22.4 },
    fantasyPoints: 340,
  },
  weeklyLogPartial: true,
  recentGames: [
    {
      season: 2025,
      week: 1,
      opponent: 'BAL',
      statLine: '4 rec, 67 rec yds',
      fantasyPoints: 21.6,
      points: { standard: 19.6, halfPpr: 21.6, ppr: 23.6 },
    },
    {
      season: 2025,
      week: 3,
      opponent: 'MIA',
      statLine: '6 rec, 85 rec yds',
      fantasyPoints: 11.5,
      points: { standard: 8.5, halfPpr: 11.5, ppr: 14.5 },
    },
  ],
};

const PENDING_PROFILE = {
  ...COMPLETE_PROFILE,
  season: 2026,
  seasonSummary: null,
  weeklyLogPartial: false,
  recentGames: [],
};

const renderPage = (entry = '/players/42') => renderWithProviders(
  <AuthenticatedPlayerProfilePage />,
  { path: '/players/:playerId', route: entry }
);

beforeEach(() => {
  // The league store outlives a test in this file, so each test has to start
  // from an empty one instead of the previous test's row.
  clearLeagueCache();
  publicApiClient.get.mockResolvedValue({ data: { rankings: [] } });
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/public/players/42') {
      return Promise.resolve({ data: config?.params?.season === 2026 ? PENDING_PROFILE : COMPLETE_PROFILE });
    }
    if (url === '/api/league/10') {
      return Promise.resolve({ data: { league: { id: 10, scoring_preset: 'ppr' } } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
});

afterEach(() => {
  clearLeagueCache();
  jest.clearAllMocks();
});

test('renders the scoring switcher, points sparkline, game log, and partial-weekly note', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Alpha Back' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Standard' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Fantasy points over 2 recent games/i })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Game log' })).toBeInTheDocument();
  expect(screen.getByText(/Weekly breakdown is partial/)).toBeInTheDocument();
  expect(screen.getByText(/reflects all 17 games/)).toBeInTheDocument();
});

test('defaults to the active league scoring format without recalculating points', async () => {
  renderPage('/players/42?leagueId=10');

  expect(await screen.findByText(/2025 fantasy points · Full PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('380').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.getAllByText('300').length).toBeGreaterThan(0);
});

test('holds the profile back until the league format is known', async () => {
  let resolveProfile;
  let resolveLeague;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') {
      return new Promise((resolve) => { resolveProfile = () => resolve({ data: COMPLETE_PROFILE }); });
    }
    if (url === '/api/league/10') {
      return new Promise((resolve) => {
        resolveLeague = () => resolve({ data: { league: { id: 10, scoring_preset: 'ppr' } } });
      });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/10'));

  // The profile has landed and the league has not. The body must not mount
  // yet: initialFormat is an initial value, so a format arriving afterwards
  // would reset a switch the reader had already flipped.
  await act(async () => { resolveProfile(); });
  expect(screen.queryByRole('heading', { name: 'Alpha Back' })).not.toBeInTheDocument();

  await act(async () => { resolveLeague(); });

  expect(await screen.findByText(/2025 fantasy points · Full PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toHaveAttribute('aria-pressed', 'true');
});

test('a failed profile shows its error and Retry without waiting for the league', async () => {
  let rejectProfile;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') {
      return new Promise((resolve, reject) => { rejectProfile = () => reject(new Error('boom')); });
    }
    // A league endpoint that never answers: a stalled connection, no timeout.
    if (url === '/api/league/10') return new Promise(() => {});
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/10'));

  // Only the body needs the league's format, and no body is going to render.
  // Holding the failure behind the league would leave the reader on skeletons
  // with no way to retry, for as long as the league request hangs.
  await act(async () => { rejectProfile(); });

  expect(await screen.findByText(/We couldn.t load this player/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('an empty profile shows Player not found without waiting for the league', async () => {
  let resolveEmpty;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') {
      return new Promise((resolve) => { resolveEmpty = () => resolve({ data: null }); });
    }
    if (url === '/api/league/10') return new Promise(() => {});
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/10'));

  await act(async () => { resolveEmpty(); });

  expect(await screen.findByText('Player not found.')).toBeInTheDocument();
});

test('renders the profile in the default format when the league request fails', async () => {
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/public/players/42') {
      return Promise.resolve({ data: config?.params?.season === 2026 ? PENDING_PROFILE : COMPLETE_PROFILE });
    }
    if (url === '/api/league/10') return Promise.reject(new Error('League unavailable'));
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');

  expect(await screen.findByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/10');
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Alpha Back' })).toBeInTheDocument();
  expect(screen.queryByText(/We couldn.t load this player/)).not.toBeInTheDocument();
  expect(screen.queryByText(/League unavailable/)).not.toBeInTheDocument();
});

test('falls back to Half-PPR without league context', async () => {
  renderPage();

  expect(await screen.findByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the no-current-season state honest', async () => {
  renderPage('/players/42?season=2026');

  expect(await screen.findByText(/2026 season hasn.t started yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Game log' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Fantasy points over/i })).not.toBeInTheDocument();
});
