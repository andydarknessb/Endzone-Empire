import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import publicApiClient from '../../../api/publicApiClient';
import PlayerProfilePage from './PlayerProfilePage';

jest.mock('../../../api/publicApiClient', () => ({
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
    { season: 2025, week: 1, opponent: 'BAL', statLine: '4 rec, 67 rec yds', fantasyPoints: 21.6, points: { standard: 19.6, halfPpr: 21.6, ppr: 23.6 } },
    { season: 2025, week: 3, opponent: 'MIA', statLine: '6 rec, 85 rec yds', fantasyPoints: 11.5, points: { standard: 8.5, halfPpr: 11.5, ppr: 14.5 } },
  ],
};

const PENDING_PROFILE = {
  ...COMPLETE_PROFILE,
  season: 2026,
  seasonSummary: null,
  weeklyLogPartial: false,
  recentGames: [],
};

// A past season the player has no data for (echoed, not swapped for the default).
const NOT_AVAILABLE_PROFILE = {
  ...COMPLETE_PROFILE,
  season: 2024,
  seasonSummary: null,
  weeklyLogPartial: false,
  recentGames: [],
  seasons: [
    { season: 2026, status: 'pending' },
    { season: 2025, status: 'complete' },
    { season: 2024, status: 'unavailable' },
  ],
};

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }));
  publicApiClient.get.mockImplementation((url, config) => {
    if (String(url).includes('/rankings')) return Promise.resolve({ data: { rankings: [] } });
    const requested = config && config.params && config.params.season;
    if (requested === 2026) return Promise.resolve({ data: PENDING_PROFILE });
    if (requested === 2024) return Promise.resolve({ data: NOT_AVAILABLE_PROFILE });
    return Promise.resolve({ data: COMPLETE_PROFILE });
  });
});

afterEach(() => jest.clearAllMocks());

const renderPage = (entry = '/players/42') => render(
  <AppThemeProvider>
    <HelmetProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/players/:id" element={<PlayerProfilePage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  </AppThemeProvider>
);

test('defaults to half-PPR and updates every points readout when the format changes', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  // Half-PPR default: headline labelled, season total 340, wk1 game 21.6.
  expect(screen.getByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(screen.getAllByText('340').length).toBeGreaterThan(0);
  expect(screen.getByText('21.6')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Full PPR' }));
  expect(screen.getByText(/2025 fantasy points · Full PPR/)).toBeInTheDocument();
  expect(screen.getAllByText('380').length).toBeGreaterThan(0);
  expect(screen.getByText('23.6')).toBeInTheDocument(); // wk1 PPR

  fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.getAllByText('300').length).toBeGreaterThan(0);
  expect(screen.getByText('19.6')).toBeInTheDocument(); // wk1 standard
});

test('stat labels expose the shared FPTS/G definition and preserve the ADP definition', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  const perGameDefinition = screen.getByLabelText('FPTS/G definition');
  fireEvent.mouseOver(perGameDefinition);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Fantasy points per game: total fantasy points divided by games played.'
  );
  fireEvent.mouseLeave(perGameDefinition);
  await waitFor(() => expect(screen.queryByText(
    'Fantasy points per game: total fantasy points divided by games played.'
  )).not.toBeInTheDocument());

  const adpDefinition = screen.getByLabelText('ADP definition');
  fireEvent.mouseOver(adpDefinition);
  expect(await screen.findByText(
    'Average draft position: the typical pick where this player is selected.'
  )).toBeInTheDocument();
});

test('shows the partial-weekly affordance when weekly rows lag games played', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });
  expect(screen.getByText(/Weekly breakdown is partial/)).toBeInTheDocument();
  expect(screen.getByText(/reflects all 17 games/)).toBeInTheDocument();
});

test('honors a shared ?season= URL for a season the player lacks with a not-available state, not an error', async () => {
  renderPage('/players/42?season=2024');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await waitFor(() => expect(screen.getByText(/No 2024 data for Alpha Back/)).toBeInTheDocument());
  // Not a mismatched-season view: no game table, and the unavailable season
  // is never offered as a toggle button.
  expect(screen.queryByRole('table', { name: 'Game log' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /2024/ })).not.toBeInTheDocument();
});

test('offers the sole valid season when an unavailable shared season is active', async () => {
  publicApiClient.get.mockImplementation((url) => {
    if (String(url).includes('/rankings')) return Promise.resolve({ data: { rankings: [] } });
    return Promise.resolve({
      data: {
        ...NOT_AVAILABLE_PROFILE,
        seasons: [
          { season: 2025, status: 'complete' },
          { season: 2024, status: 'unavailable' },
        ],
      },
    });
  });

  renderPage('/players/42?season=2024');
  await screen.findByText(/No 2024 data for Alpha Back/);

  expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '2024' })).not.toBeInTheDocument();
});

test('switching to the pending upcoming season renders a not-started state, not an error', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  fireEvent.click(screen.getByRole('button', { name: /2026/ }));

  await waitFor(() => expect(screen.getByText(/season hasn.t started yet/i)).toBeInTheDocument());
  // No stat cards / game table in the pending state.
  expect(screen.queryByText(/Weekly breakdown is partial/)).not.toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Game log' })).not.toBeInTheDocument();
});
