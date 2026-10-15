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

test('shows the newest Darkness Report: heading, title, byline and a 44px link to the article', () => {
  // Newest first, as the registry sorts: a non-report leads, then two reports.
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue([
    meta('newest-guide', 'Newest Guide', '2026-10-14'),
    meta('wk6-darkness', 'Week 6 Waiver Wire: The Darkness Report', '2026-10-13', { author: 'Andy Darkness', readMinutes: 15 }),
    meta('wk5-darkness', 'Week 5 Waiver Wire: The Darkness Report', '2026-10-06'),
  ]);
  render(<PublicHighlights />);

  expect(screen.getByRole('heading', { level: 2, name: 'The Darkness Report' })).toHaveStyle({ fontSize: '20px' });
  expect(screen.getByText('Week 6 Waiver Wire: The Darkness Report')).toBeInTheDocument();
  expect(screen.queryByText('Week 5 Waiver Wire: The Darkness Report')).not.toBeInTheDocument();
  expect(screen.queryByText('Newest Guide')).not.toBeInTheDocument();
  expect(screen.getByText(`Andy Darkness · ${formatInstant('2026-10-13T00:00:00', 'day')} · 15 min read`)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Read the report' });
  expect(link).toHaveAttribute('href', '/strategy/wk6-darkness');
  expect(link).toHaveStyle({ minHeight: '44px', display: 'inline-flex' });
});

test('a report with no author reads date and length only', () => {
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue([
    meta('wk6-darkness', 'Week 6 Darkness Report', '2026-10-13'),
  ]);
  render(<PublicHighlights />);

  expect(screen.getByText(`${formatInstant('2026-10-13T00:00:00', 'day')} · 5 min read`)).toBeInTheDocument();
});

test('with no Darkness Report the card renders nothing', () => {
  jest.spyOn(articlesModule, 'listArticles').mockReturnValue([meta('a', 'Guide a', '2026-10-09')]);
  const { container } = render(<PublicHighlights />);

  expect(container).toBeEmptyDOMElement();
});

test('the real registry has a report for the card to lead with', () => {
  render(<PublicHighlights />);

  const report = listArticles().find((article) => /Darkness Report/i.test(article.title));
  expect(screen.getByRole('link', { name: 'Read the report' })).toHaveAttribute('href', `/strategy/${report.slug}`);
});
