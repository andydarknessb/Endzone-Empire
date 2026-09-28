import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import ArticlePage from './ArticlePage';

// The in-app hop is about the page, not about which articles are published:
// against real content it landed on the newest related article, which grew
// from about 2 KB to 45 KB of prose as reports were published, and rendering
// that under parallel test workers took 5 to 12 s, past the suite's 4 s waitFor
// budget (the ArticlePage flake).
// Two small fixture articles behind the content module's interface keep the
// hop the same size forever.
jest.mock('../../../content/articles', () => {
  const mockReact = require('react');
  const body = (prefix) => function FixtureBody() {
    return mockReact.createElement(
      mockReact.Fragment,
      null,
      mockReact.createElement('h2', { id: `${prefix}-one` }, `${prefix} section one`),
      mockReact.createElement('p', null, `${prefix} prose.`),
      mockReact.createElement('h2', { id: `${prefix}-two` }, `${prefix} section two`),
    );
  };
  const articles = [
    { slug: 'alpha-guide', title: 'Alpha guide', category: 'Strategy', excerpt: 'Alpha.', readMinutes: 2, date: '2026-09-02', body: body('Alpha') },
    { slug: 'beta-guide', title: 'Beta guide', category: 'Strategy', excerpt: 'Beta.', readMinutes: 3, date: '2026-09-01', body: body('Beta') },
  ];
  const meta = ({ body: _body, ...rest }) => rest;
  return {
    listArticles: () => articles.map(meta),
    getArticle: (slug) => {
      const article = articles.find((a) => a.slug === slug);
      return article ? { ...meta(article), loadBody: () => Promise.resolve(article.body) } : null;
    },
    relatedArticles: (slug) => articles.filter((a) => a.slug !== slug).map(meta),
  };
});

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
});

test('navigating to a related article loads its body and rebuilds the table of contents from it', async () => {
  const user = userEvent.setup();
  render(
    <AppThemeProvider>
      <HelmetProvider>
        <MemoryRouter initialEntries={['/strategy/alpha-guide']}>
          <Routes>
            <Route path="/strategy/:slug" element={<ArticlePage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    </AppThemeProvider>
  );
  const toc = await screen.findByRole('navigation', { name: 'Table of contents' });
  expect(toc).toHaveTextContent('Alpha section one');

  // An in-app hop: the page keeps its component instance and only the slug
  // changes, so the new body must load and the table of contents be rebuilt.
  await user.click(screen.getByRole('link', { name: /Beta guide/ }));

  expect(await screen.findByRole('heading', { name: 'Beta section one' })).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole('navigation', { name: 'Table of contents' })).toHaveTextContent('Beta section two');
  });
  expect(screen.getByRole('navigation', { name: 'Table of contents' })).not.toHaveTextContent('Alpha section one');
});
