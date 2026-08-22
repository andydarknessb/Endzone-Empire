import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import ArticlePage, { articleDate } from './ArticlePage';

// A date-only ISO string parses as UTC midnight, so in any timezone west of
// UTC toLocaleDateString renders the PREVIOUS day: every byline was a day
// early. Asserting the local calendar parts holds in every timezone, which a
// formatted-string assertion would not (it passes either way under TZ=UTC).
test('an article date keeps its calendar day in every timezone', () => {
  const parsed = articleDate('2026-08-19');
  expect(parsed.getFullYear()).toBe(2026);
  expect(parsed.getMonth()).toBe(7); // August
  expect(parsed.getDate()).toBe(19);
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
  // The nav is re-queried inside waitFor: it empties (unmounts) while the new
  // body loads and comes back built from the new article's headings.
  await waitFor(() => {
    expect(screen.getByRole('navigation', { name: 'Table of contents' })).toHaveTextContent('FAAB (free-agent budget)');
  });
  expect(screen.getByRole('navigation', { name: 'Table of contents' })).not.toHaveTextContent('How to build tiers');
});

// The fallback matters as much as the happy path: formatDate returns the raw
// input when parsing fails, so a malformed frontmatter date shows the string
// rather than "Invalid Date" in a published byline.
test('article date handles malformed, empty and full-timestamp input', () => {
  expect(Number.isNaN(articleDate('2026-13-45').getTime())).toBe(true);
  expect(Number.isNaN(articleDate('').getTime())).toBe(true);
  expect(Number.isNaN(articleDate(undefined).getTime())).toBe(true);

  // A full ISO timestamp already carries its own zone and must pass through
  // untouched rather than having a second T00:00:00 appended.
  const stamped = articleDate('2026-08-19T12:00:00Z');
  expect(Number.isNaN(stamped.getTime())).toBe(false);
  expect(stamped.toISOString()).toBe('2026-08-19T12:00:00.000Z');
});
