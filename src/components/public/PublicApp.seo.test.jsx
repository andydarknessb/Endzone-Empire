import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import publicApiClient from '../../api/publicApiClient';
import PublicApp from './PublicApp';

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

function canonical() {
  return document.head.querySelector('link[rel="canonical"]');
}

function meta(selector) {
  return document.head.querySelector(selector);
}

afterEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, '', '/');
});

test('player profile emits its real canonical URL and points-based OG/Twitter metadata', async () => {
  publicApiClient.get.mockResolvedValue({
    data: {
      playerId: 42,
      name: 'Alpha Back',
      position: 'RB',
      nflTeam: 'KC',
      photoUrl: null,
      jerseyNumber: 25,
      injuryStatus: null,
      injuryDetail: null,
      news: null,
      adp: 12.5,
      seasonSummary: {
        season: 2026,
        gamesPlayed: 3,
        fantasyPoints: 45.6,
        pointsPerGame: 15.2,
      },
      recentGames: [],
    },
  });
  window.history.pushState({}, '', '/players/42');

  render(<PublicApp />);

  await screen.findByRole('heading', { name: 'Alpha Back' }, { timeout: 5000 });
  await waitFor(() => expect(document.title).toBe('Alpha Back: 45.6 Fantasy Points · Endzone Empire'));

  expect(canonical()).toHaveAttribute('href', 'https://endzoneempire.gg/players/42');
  expect(meta('meta[property="og:title"]')).toHaveAttribute('content', document.title);
  expect(meta('meta[property="og:description"]')).toHaveAttribute(
    'content',
    expect.stringContaining('45.6 fantasy points in the 2026 season')
  );
  expect(meta('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://endzoneempire.gg/players/42'
  );
  expect(meta('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
});

test('the mock draft simulator is an indexable public page with its own canonical URL', async () => {
  // The simulator fetches its pool only after a draft starts, so the landing
  // state renders with no request at all.
  window.history.pushState({}, '', '/draft-simulator');

  render(<PublicApp />);

  await screen.findByRole('heading', { name: 'Mock Draft Simulator' }, { timeout: 5000 });
  await waitFor(() =>
    expect(document.title).toBe('Fantasy Football Mock Draft Simulator · Endzone Empire')
  );

  expect(canonical()).toHaveAttribute('href', 'https://endzoneempire.gg/draft-simulator');
  expect(meta('meta[property="og:title"]')).toHaveAttribute('content', document.title);
  expect(meta('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://endzoneempire.gg/draft-simulator'
  );
  expect(meta('meta[name="description"]')).toHaveAttribute(
    'content',
    expect.stringContaining('mock draft')
  );
  expect(publicApiClient.get).not.toHaveBeenCalled();
});

test('recap detail puts the final scoreboard in canonical OG metadata', async () => {
  publicApiClient.get.mockResolvedValue({
    data: {
      gameId: '20260112_KC@BUF',
      season: 2026,
      week: 19,
      awayTeam: 'KC',
      homeTeam: 'BUF',
      awayScore: 27,
      homeScore: 24,
      narrative: 'Kansas City edged Buffalo on a late field goal.',
      scoringPlays: [],
      topPerformers: [],
    },
  });
  window.history.pushState({}, '', '/recaps/20260112_KC@BUF');

  render(<PublicApp />);

  await screen.findByText('Week 19 · 2026', {}, { timeout: 5000 });
  await waitFor(() => expect(document.title).toBe('KC 27–24 BUF Final · Endzone Empire'));

  expect(canonical()).toHaveAttribute(
    'href',
    'https://endzoneempire.gg/recaps/20260112_KC%40BUF'
  );
  expect(meta('meta[property="og:title"]')).toHaveAttribute('content', document.title);
  expect(meta('meta[property="og:description"]')).toHaveAttribute(
    'content',
    expect.stringContaining('Final score: KC 27, BUF 24.')
  );
  expect(meta('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://endzoneempire.gg/og-brand-gradient.png'
  );
  expect(meta('meta[property="og:url"]')).not.toHaveAttribute('content', expect.stringContaining('#'));
});
