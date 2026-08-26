import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import publicApiClient from '../../../api/publicApiClient';
import RankingsPage from './RankingsPage';

jest.mock('../../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  publicApiClient.get.mockResolvedValue({
    data: {
      season: 2026,
      week: 3,
      rankings: [
        { rank: 1, playerId: 1, name: 'Alpha Runner', position: 'RB', nflTeam: 'KC', projectedPoints: 20, seasonPoints: 55, trend: 'up', byeWeek: 10 },
        { rank: 2, playerId: 2, name: 'Bravo Receiver', position: 'WR', nflTeam: 'BUF', projectedPoints: 18, seasonPoints: 48, trend: 'flat', byeWeek: null },
      ],
    },
  });
});

afterEach(() => jest.clearAllMocks());

const renderPage = () => render(
  <AppThemeProvider>
    <HelmetProvider>
      <MemoryRouter>
        <RankingsPage />
      </MemoryRouter>
    </HelmetProvider>
  </AppThemeProvider>
);

test('renders the NFL Pick\'em promo, the observable form of the promo band on this public route', async () => {
  renderPage();

  await screen.findByText('Alpha Runner');
  expect(screen.getByRole('heading', { name: "NFL Pick'em" })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: "League Pick'em" })).not.toBeInTheDocument();
});

test('rankings search filters by player name and team without refetching', async () => {
  renderPage();

  await screen.findByText('Alpha Runner');
  fireEvent.change(screen.getByLabelText('Search players or teams'), { target: { value: 'buf' } });
  expect(screen.queryByText('Alpha Runner')).not.toBeInTheDocument();
  expect(screen.getByText('Bravo Receiver')).toBeInTheDocument();
  expect(screen.getByText('1 result')).toBeInTheDocument();
  expect(publicApiClient.get).toHaveBeenCalledTimes(1);
});

test('shows each player\'s bye week, with an em dash when the schedule is unknown', async () => {
  renderPage();

  await screen.findByText('Alpha Runner');
  expect(screen.getByText('Bye')).toBeInTheDocument();
  expect(within(screen.getByRole('row', { name: /Alpha Runner/ })).getByText('10')).toBeInTheDocument();
  expect(within(screen.getByRole('row', { name: /Bravo Receiver/ })).getByText('-')).toBeInTheDocument();
});

test('position selection filters API-shaped mixed rows before tier computation', async () => {
  publicApiClient.get.mockResolvedValue({
    data: {
      season: 2026,
      week: 3,
      rankings: [
        { rank: 1, playerId: 1, name: 'QB Leader', position: 'QB', nflTeam: 'BUF', projectedPoints: 30, seasonPoints: 70, trend: 'up' },
        { rank: 2, playerId: 2, name: 'WR Alpha', position: 'WR', nflTeam: 'MIN', projectedPoints: 24.6, seasonPoints: 60, trend: 'up' },
        { rank: 3, playerId: 3, name: 'RB Leader', position: 'RB', nflTeam: 'ATL', projectedPoints: 23.8, seasonPoints: 58, trend: 'flat' },
        { rank: 4, playerId: 4, name: 'WR Bravo', position: 'WR', nflTeam: 'TB', projectedPoints: 21.6, seasonPoints: 51, trend: 'down' },
        { rank: 5, playerId: 5, name: 'WR Charlie', position: 'WR', nflTeam: 'NYJ', projectedPoints: 18.1, seasonPoints: 45, trend: 'flat' },
        { rank: 6, playerId: 6, name: 'WR Delta', position: 'WR', nflTeam: 'LAR', projectedPoints: 15, seasonPoints: 42, trend: 'down' },
      ],
    },
  });
  renderPage();

  await screen.findByText('QB Leader');
  fireEvent.click(screen.getByRole('button', { name: 'WR' }));
  await screen.findByText('WR Alpha');

  expect(screen.queryByText('QB Leader')).not.toBeInTheDocument();
  expect(screen.queryByText('RB Leader')).not.toBeInTheDocument();
  const tierLabels = screen.getAllByText(/^WR.*Tier \d+$/).map((node) => node.textContent);
  expect(tierLabels.length).toBeGreaterThan(1);
  expect(publicApiClient.get).toHaveBeenLastCalledWith(
    '/api/public/rankings',
    expect.objectContaining({ params: expect.objectContaining({ position: 'WR' }) })
  );
});

test('searching does not re-tier the surviving rows', async () => {
  publicApiClient.get.mockResolvedValue({
    data: {
      season: 2026,
      week: 3,
      rankings: [
        // WR Alpha anchors Tier 1; WR Bravo sits a full tier below. If tiers
        // were recomputed on the search-filtered subset, Bravo alone would
        // anchor his own list and jump to Tier 1.
        { rank: 1, playerId: 1, name: 'WR Alpha', position: 'WR', nflTeam: 'MIN', projectedPoints: 24.6, seasonPoints: 60, trend: 'up' },
        { rank: 2, playerId: 2, name: 'WR Bravo', position: 'WR', nflTeam: 'TB', projectedPoints: 21.6, seasonPoints: 45, trend: 'down' },
      ],
    },
  });
  renderPage();

  await screen.findByText('WR Bravo');
  fireEvent.change(screen.getByLabelText('Search players or teams'), { target: { value: 'bravo' } });
  expect(screen.queryByText('WR Alpha')).not.toBeInTheDocument();
  expect(screen.getByText('WR · Tier 2')).toBeInTheDocument();
});
