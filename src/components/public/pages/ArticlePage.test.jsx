import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
  const toc = await screen.findByRole('navigation', { name: 'Table of contents' });
  expect(toc).toHaveTextContent('How to build tiers');
  expect(toc).toHaveTextContent('Using tiers live');
  expect(screen.getByRole('heading', { name: 'Related articles' })).toBeInTheDocument();
});
