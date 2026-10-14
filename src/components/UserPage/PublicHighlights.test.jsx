import React from 'react';
import { render, screen, within } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import * as articlesModule from '../../content/articles';
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

// Every link on the section is a 44px target (spec #2308): row links and the
// "All ..." links alike, not just the header's quick links.
test('every recap, strategy and "All ..." link reaches a 44px box', async () => {
  mockGets();
  render(<PublicHighlights />);
  await screen.findByRole('link', { name: 'KC 20 @ BUF 27' });

  const section = screen.getByRole('region', { name: 'Around the League' });
  const links = within(section).getAllByRole('link');
  expect(links.length).toBeGreaterThan(8);
  for (const link of links) expect(link).toHaveStyle({ minHeight: '44px' });
});

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

test('the newest Darkness Report leads the Strategy card with its excerpt, and the card still shows three rows', async () => {
  const meta = (slug, title, date) => ({
    slug, title, category: 'Strategy', excerpt: `Excerpt of ${slug}`, readMinutes: 5, date,
  });
  // Newest first, as the registry sorts: a non-report leads, the report is second.
  const listed = [
    meta('newest-guide', 'Newest Guide', '2026-10-13'),
    meta('wk6-darkness', 'Week 6 Waiver Wire Darkness Report', '2026-10-12'),
    meta('wk5-darkness', 'Week 5 Waiver Wire Darkness Report', '2026-10-05'),
    meta('old-guide', 'Old Guide', '2026-09-01'),
  ];
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue(listed);
  mockGets();
  render(<PublicHighlights />);
  await screen.findByRole('link', { name: 'KC 20 @ BUF 27' });

  // The recaps list is first, the Strategy list second.
  const card = screen.getAllByRole('list')[1];
  const rows = within(card).getAllByRole('listitem');
  expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
    'Week 6 Waiver Wire Darkness Report', 'Newest Guide', 'Week 5 Waiver Wire Darkness Report',
  ]);
  expect(within(rows[0]).getByText('Excerpt of wk6-darkness')).toBeInTheDocument();
  expect(within(rows[1]).getByText('Strategy · 5 min read')).toBeInTheDocument();
  articlesModule.listArticles.mockRestore();
});

test('with no Darkness Report the Strategy card shows the newest three as before', async () => {
  const listed = ['a', 'b', 'c', 'd'].map((s, i) => ({
    slug: s, title: `Guide ${s}`, category: 'Strategy', excerpt: 'x', readMinutes: 4, date: `2026-10-0${9 - i}`,
  }));
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue(listed);
  mockGets();
  render(<PublicHighlights />);
  await screen.findByRole('link', { name: 'KC 20 @ BUF 27' });

  // The recaps list is first, the Strategy list second.
  const card = screen.getAllByRole('list')[1];
  expect(within(card).getAllByRole('listitem').map((row) => within(row).getByRole('link').textContent))
    .toEqual(['Guide a', 'Guide b', 'Guide c']);
  articlesModule.listArticles.mockRestore();
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
