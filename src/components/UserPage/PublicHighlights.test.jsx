import React from 'react';
import { render, screen } from '@testing-library/react';
import * as articlesModule from '../../content/articles';
import { listArticles } from '../../content/articles';
import { formatInstant } from '../../shared/lib/instantFormat';
import PublicHighlights from './PublicHighlights';

// PublicHighlights uses no router or redux, so a plain render is enough. Its
// link is intentionally a full-page href into the public BrowserRouter tree.

const meta = (slug, title, date, extra = {}) => ({
  slug, title, category: 'Waivers', excerpt: `Excerpt of ${slug}`, readMinutes: 5, date, ...extra,
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the newest Darkness Report under Columns: heading, title, series byline and a 44px link to the article', () => {
  // Newest first, as the registry sorts: a non-report leads, then two reports.
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue([
    meta('newest-guide', 'Newest Guide', '2026-10-14'),
    meta('wk6-darkness', 'Week 6 Waiver Wire: The Darkness Report', '2026-10-13', { author: 'Andy Darkness', readMinutes: 15 }),
    meta('wk5-darkness', 'Week 5 Waiver Wire: The Darkness Report', '2026-10-06'),
  ]);
  render(<PublicHighlights />);

  const heading = screen.getByRole('heading', { level: 2, name: 'Columns' });
  expect(heading).toHaveStyle({ textTransform: 'uppercase' });
  expect(screen.getByRole('region', { name: 'Columns' })).toBeInTheDocument();
  expect(screen.getByText('Week 6 Waiver Wire: The Darkness Report')).toBeInTheDocument();
  expect(screen.queryByText('Week 5 Waiver Wire: The Darkness Report')).not.toBeInTheDocument();
  expect(screen.queryByText('Newest Guide')).not.toBeInTheDocument();
  expect(screen.getByText(`Waiver Wire · Andy Darkness · ${formatInstant('2026-10-13T00:00:00', 'day')} · 15 min read`)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Read the Waiver Wire column' });
  expect(link).toHaveAttribute('href', '/strategy/wk6-darkness');
  expect(link).toHaveStyle({ minHeight: '44px', display: 'inline-flex' });
});

test('a report with no author and no series in its title reads category, date and length', () => {
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue([
    meta('wk6-darkness', 'Week 6 Darkness Report', '2026-10-13'),
  ]);
  render(<PublicHighlights />);

  expect(screen.getByText(`Waivers · ${formatInstant('2026-10-13T00:00:00', 'day')} · 5 min read`)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Read the Waivers column' })).toBeInTheDocument();
});

test('with no Darkness Report the frame renders nothing', () => {
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue([meta('a', 'Guide a', '2026-10-09')]);
  const { container } = render(<PublicHighlights />);

  expect(container).toBeEmptyDOMElement();
});

test('the real registry has a report for the frame to lead with', () => {
  render(<PublicHighlights />);

  const report = listArticles().find((article) => /Darkness Report/i.test(article.title));
  expect(screen.getByRole('link', { name: /^Read the .* column$/ })).toHaveAttribute('href', `/strategy/${report.slug}`);
});
