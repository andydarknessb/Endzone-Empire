import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import ArticlePage from './ArticlePage';

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

test('article renders breadcrumb, generated table of contents, progress, and related links', async () => {
  render(
    <AppThemeProvider>
      <HelmetProvider>
        <MemoryRouter initialEntries={['/strategy/draft-by-tiers']}>
          <Routes>
            <Route path="/strategy/:slug" element={<ArticlePage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    </AppThemeProvider>
  );

  expect(screen.getByRole('heading', { name: 'Draft by Tiers, Not by Rank' })).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Strategy' })).toHaveAttribute('href', '/strategy');
  expect(screen.getByRole('progressbar', { name: 'Article reading progress' })).toBeInTheDocument();
  // The body is loaded on demand (it is not in the initial bundle); the prose
  // arrives, and the table of contents is built from it once it has.
  expect(await screen.findByRole('heading', { name: 'How to build tiers' })).toBeInTheDocument();
  const toc = await screen.findByRole('navigation', { name: 'Table of contents' });
  expect(toc).toHaveTextContent('How to build tiers');
  expect(toc).toHaveTextContent('Using tiers live');
  expect(screen.getByRole('heading', { name: 'Related articles' })).toBeInTheDocument();
});

test('navigating to a related article loads its body and rebuilds the table of contents from it', async () => {
  const user = userEvent.setup();
  render(
    <AppThemeProvider>
      <HelmetProvider>
        <MemoryRouter initialEntries={['/strategy/draft-by-tiers']}>
          <Routes>
            <Route path="/strategy/:slug" element={<ArticlePage />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    </AppThemeProvider>
  );
  await screen.findByRole('heading', { name: 'How to build tiers' });

  // The related strip links to the waiver article; this is an in-app hop, so
  // the page keeps its component instance and only the slug changes.
  await user.click(screen.getByRole('link', { name: /Winning the Waiver Wire/ }));

  expect(await screen.findByRole('heading', { name: 'Priority (rolling waivers)' })).toBeInTheDocument();
  const toc = await screen.findByRole('navigation', { name: 'Table of contents' });
  await waitFor(() => expect(toc).toHaveTextContent('FAAB (free-agent budget)'));
  expect(toc).not.toHaveTextContent('How to build tiers');
});
