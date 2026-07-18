import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import PlayerQuickView from './PlayerQuickView';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const summaryResponse = (overrides = {}) => ({
  data: {
    player: {
      id: 7,
      name: 'Justin Jefferson',
      position: 'WR',
      nfl_team: 'Minnesota Vikings',
      jersey_number: 18,
      injury_status: null,
      injury_detail: null,
      news: null,
      photo_url: 'https://example.com/photo.jpg',
      bye_week: 6,
      adp: 3.4,
      ...(overrides.player || {}),
    },
    fantasy:
      overrides.fantasy !== undefined
        ? overrides.fantasy
        : {
            adp: 3.4,
            previousSeasonYear: 2025,
            previousSeasonTotal: 300,
            projectionSeason: 2026,
            projectedPoints: 299.2,
          },
    currentSeason:
      overrides.currentSeason !== undefined
        ? overrides.currentSeason
        : {
            season: 2026,
            weekly: [
              { week: 1, stats: { receivingYards: 120, receivingTDs: 1, receptions: 8 }, fantasy_points: 20 },
              { week: 2, stats: { receivingYards: 90, receptions: 6 }, fantasy_points: 15 },
            ],
            games: 2,
            points: 35,
            perGame: 17.5,
          },
    previousSeasons:
      overrides.previousSeasons !== undefined
        ? overrides.previousSeasons
        : [
            {
              season: 2025,
              games: 17,
              stats: { receivingYards: 1500, receivingTDs: 10, receptions: 110 },
              points: 300,
              perGame: 17.6,
            },
          ],
  },
});

const renderQuickView = (props = {}) =>
  renderWithProviders(
    <PlayerQuickView open onClose={jest.fn()} playerId={7} {...props} />
  );

beforeEach(() => {
  apiClient.get.mockResolvedValue(summaryResponse());
});

test('renders header (name, position) after a successful fetch', async () => {
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByText('WR')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/7/summary', undefined);
});

test('shows the fantasy strip: ADP, projection, and last-season total', async () => {
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  const strip = screen.getByTestId('fantasy-strip');
  expect(strip).toHaveTextContent('ADP 3.4');
  expect(strip).toHaveTextContent('2026 Proj 299.2');
  expect(strip).toHaveTextContent('2025: 300 pts');
});

test('fantasy strip is hidden when there is no ADP/projection/prior data', async () => {
  apiClient.get.mockResolvedValue(
    summaryResponse({
      fantasy: { adp: null, previousSeasonTotal: null, projectedPoints: null },
      previousSeasons: [],
    })
  );
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.queryByTestId('fantasy-strip')).not.toBeInTheDocument();
});

test('toggle switches from Current Season weekly table to Previous Seasons table', async () => {
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByText('120 Rec Yds, 1 Rec TD, 8 Rec')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous Seasons' }));

  expect(screen.getByText('1500 Rec Yds, 10 Rec TD, 110 Rec')).toBeInTheDocument();
  expect(screen.getByText('2025')).toBeInTheDocument();
});

test('previousSeasons: [] shows the "No previous-season data" empty state', async () => {
  apiClient.get.mockResolvedValue(summaryResponse({ previousSeasons: [] }));
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous Seasons' }));

  expect(
    screen.getByText('No previous-season data available for this player.')
  ).toBeInTheDocument();
});

test('currentSeason: null shows the "No current-season stats" empty state', async () => {
  apiClient.get.mockResolvedValue(summaryResponse({ currentSeason: null }));
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  // The toggle's last-selected view persists across opens for the session
  // (module-level state) — force back to "Current Season" for this assertion
  // regardless of what a prior test left it on.
  fireEvent.click(screen.getByRole('button', { name: 'Current Season' }));
  expect(screen.getByText('No current-season stats yet')).toBeInTheDocument();
});

test('missing photo_url still renders the initials fallback avatar', async () => {
  apiClient.get.mockResolvedValue(summaryResponse({ player: { photo_url: null } }));
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByText('JJ')).toBeInTheDocument();
});

test('draftedBy renders the "Drafted by Team X" banner', async () => {
  renderQuickView({ draftedBy: 'Team X' });

  expect(await screen.findByText('Drafted by Team X')).toBeInTheDocument();
});

test('clicking the X (aria-label Close) calls onClose', async () => {
  const onClose = jest.fn();
  renderQuickView({ onClose });

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  expect(onClose).toHaveBeenCalled();
});
