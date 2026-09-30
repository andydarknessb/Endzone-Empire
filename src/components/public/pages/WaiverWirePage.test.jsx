import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import publicApiClient from '../../../api/publicApiClient';
import WaiverWirePage from './WaiverWirePage';

jest.mock('../../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const TARGET = {
  playerId: 11,
  name: 'Braelon Allen',
  position: 'RB',
  nflTeam: 'NYJ',
  photoUrl: null,
  opponent: 'CHI',
  ownership: 19,
  bidMin: 12,
  bidMax: 18,
  reason: 'Hall is week-to-week and Allen is the lead back.',
};

const PAYLOAD = {
  week: 4,
  source: 'editorial',
  ownershipAsOf: '2026-09-29',
  targets: [TARGET, { ...TARGET, playerId: 12, name: 'Kenyon Sadiq', position: 'TE', opponent: 'CHI', ownership: 18, bidMin: 8, bidMax: 12, reason: 'Tight end hole.' }],
};

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  publicApiClient.get.mockResolvedValue({ data: PAYLOAD });
});

afterEach(() => jest.clearAllMocks());

const renderPage = () => render(
  <AppThemeProvider>
    <HelmetProvider>
      <MemoryRouter>
        <WaiverWirePage />
      </MemoryRouter>
    </HelmetProvider>
  </AppThemeProvider>
);

test('renders the week title and an editorial card with position, team, opponent, Ownership, bid range and reason', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Week 4 Waiver Targets' })).toBeInTheDocument();
  expect(publicApiClient.get).toHaveBeenCalledWith('/api/public/waiver-targets');
  const card = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/players/11');
  expect(card).toBeDefined();
  expect(within(card).getByText('RB')).toBeInTheDocument();
  expect(within(card).getByText('NYJ')).toBeInTheDocument();
  expect(within(card).getByText('Opp CHI')).toBeInTheDocument();
  expect(within(card).getByText('19%')).toBeInTheDocument();
  expect(within(card).getByText('Bid 12 to 18% of budget')).toBeInTheDocument();
  expect(within(card).getByText('Hall is week-to-week and Allen is the lead back.')).toBeInTheDocument();
  expect(card).toHaveAttribute('href', '/players/11');
});

test('no season rank appears on the page', async () => {
  renderPage();

  await screen.findByText('Braelon Allen');
  expect(screen.queryByText(/Rank \d+/)).not.toBeInTheDocument();
  expect(publicApiClient.get).not.toHaveBeenCalledWith('/api/public/rankings', expect.anything());
});

test('shows the empty state when the week has no targets', async () => {
  publicApiClient.get.mockResolvedValue({ data: { week: 3, source: 'editorial', ownershipAsOf: null, targets: [] } });
  renderPage();

  expect(await screen.findByText("This week's waiver targets aren't posted yet.")).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Week 3 Waiver Targets' })).toBeInTheDocument();
});

test('shows the error state with retry, keeps the guides and key terms, and recovers on retry', async () => {
  publicApiClient.get.mockRejectedValueOnce(new Error('boom'));
  renderPage();

  expect(await screen.findByText("We couldn't load this week's waiver targets.")).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Key terms' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Waiver strategy guides' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('Braelon Allen')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Week 4 Waiver Targets' })).toBeInTheDocument();
});
