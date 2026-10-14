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

const mockGets = ({ recaps = recapsResponse } = {}) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/recaps') {
      return recaps instanceof Error ? Promise.reject(recaps) : Promise.resolve(recaps);
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
};

afterEach(() => jest.clearAllMocks());

test('has no Top Players card and never fetches the rankings', async () => {
  mockGets();
  render(<PublicHighlights />);

  await screen.findByRole('link', { name: 'KC 20 @ BUF 27' });
  expect(screen.queryByRole('heading', { name: 'Top Players' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Full rankings' })).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/public/rankings', expect.anything());
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
  await screen.findByRole('link', { name: 'KC 20 @ BUF 27' });

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

test('a failed recaps fetch degrades that card only, never the section', async () => {
  mockGets({ recaps: new Error('boom') });
  render(<PublicHighlights />);

  expect(await screen.findByText("Couldn't load recaps right now.")).toBeInTheDocument();
  // The strategy card still renders its content.
  expect(screen.getByRole('link', { name: 'All strategy articles' })).toBeInTheDocument();
});

test('an empty recap list gets a quiet empty state', async () => {
  mockGets({ recaps: { data: { recaps: [] } } });
  render(<PublicHighlights />);

  expect(await screen.findByText('No recaps published yet.')).toBeInTheDocument();
});
