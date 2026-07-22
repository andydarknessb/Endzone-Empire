import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import publicApiClient from '../../api/publicApiClient';
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

afterEach(() => jest.clearAllMocks());

test('renders the scoring switcher, points sparkline, game log, and partial-weekly note', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Alpha Back' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Standard' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Fantasy points over 2 recent games/i })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Recent games' })).toBeInTheDocument();
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

test('falls back to Half-PPR without league context', async () => {
  renderPage();

  expect(await screen.findByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the no-current-season state honest', async () => {
  renderPage('/players/42?season=2026');

  expect(await screen.findByText(/2026 season hasn.t started yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Recent games' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Fantasy points over/i })).not.toBeInTheDocument();
});
