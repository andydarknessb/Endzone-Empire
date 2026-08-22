import React from 'react';
import { render, screen, within } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { listArticles } from '../../content/articles';
import PublicHighlights from './PublicHighlights';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// PublicHighlights uses no router or redux — plain render is enough. Its
// links are intentionally full-page hrefs into the public BrowserRouter tree.

const rankingsResponse = {
  data: {
    season: 2025,
    week: 18,
    rankings: [
      { rank: 1, playerId: 777, name: 'Christian McCaffrey', position: 'RB', nflTeam: 'SF', seasonPoints: 369.1 },
      { rank: 2, playerId: 1144, name: 'Josh Allen', position: 'QB', nflTeam: 'BUF', seasonPoints: 364.6 },
    ],
  },
};

const recapsResponse = {
  data: {
    recaps: [
      {
        gameId: '20260111_KC@BUF', season: 2025, week: 18,
        homeTeam: 'BUF', awayTeam: 'KC', homeScore: 27, awayScore: 20,
        hook: 'Buffalo closed the season with a statement win.',
      },
    ],
  },
};

const mockGets = ({ rankings = rankingsResponse, recaps = recapsResponse } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/rankings') {
      return rankings instanceof Error ? Promise.reject(rankings) : Promise.resolve(rankings);
    }
    if (url === '/api/public/recaps') {
      return recaps instanceof Error ? Promise.reject(recaps) : Promise.resolve(recaps);
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
};

afterEach(() => jest.clearAllMocks());

test('renders the rankings preview with public player-profile links', async () => {
  mockGets();
  render(<PublicHighlights />);

  const mccaffrey = await screen.findByRole('link', { name: '#1 Christian McCaffrey' });
  expect(mccaffrey).toHaveAttribute('href', '/players/777');
  expect(screen.getByText('RB SF · 369.1 pts')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Full rankings' })).toHaveAttribute('href', '/rankings');
  expect(apiClient.get).toHaveBeenCalledWith('/api/public/rankings', { params: { limit: 5 } });
});

test('renders the latest recaps with links to each recap page', async () => {
  mockGets();
  render(<PublicHighlights />);

  const recapLink = await screen.findByRole('link', { name: 'KC 20 @ BUF 27' });
  expect(recapLink).toHaveAttribute('href', '/recaps/20260111_KC@BUF');
  expect(screen.getByText(/Week 18 · Buffalo closed the season/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'All recaps' })).toHaveAttribute('href', '/recaps');
});

test('lists the newest strategy articles straight from the content registry', async () => {
  mockGets();
  render(<PublicHighlights />);
  await screen.findByRole('link', { name: 'Full rankings' });

  for (const article of listArticles().slice(0, 3)) {
    const link = screen.getByRole('link', { name: article.title });
    expect(link).toHaveAttribute('href', `/strategy/${article.slug}`);
  }
  expect(screen.getByRole('link', { name: 'All strategy articles' })).toHaveAttribute('href', '/strategy');
});

test('shows the quick-links row into every public section', async () => {
  mockGets();
  render(<PublicHighlights />);
  const section = (await screen.findByRole('region', { name: 'Around the League' }));

  expect(within(section).getByRole('link', { name: 'Waiver Wire' })).toHaveAttribute('href', '/waiver-wire');
  expect(within(section).getByRole('link', { name: 'Rankings' })).toHaveAttribute('href', '/rankings');
  expect(within(section).getByRole('link', { name: 'Strategy' })).toHaveAttribute('href', '/strategy');
  expect(within(section).getByRole('link', { name: 'Recaps' })).toHaveAttribute('href', '/recaps');
});

test('a failed fetch degrades that card only, never the section', async () => {
  mockGets({ rankings: new Error('boom') });
  render(<PublicHighlights />);

  expect(await screen.findByText("Couldn't load the rankings right now.")).toBeInTheDocument();
  // The other two cards still render their content.
  expect(await screen.findByRole('link', { name: 'KC 20 @ BUF 27' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'All strategy articles' })).toBeInTheDocument();
});

test('an empty recap list gets a quiet empty state', async () => {
  mockGets({ recaps: { data: { recaps: [] } } });
  render(<PublicHighlights />);

  expect(await screen.findByText('No recaps published yet.')).toBeInTheDocument();
});
