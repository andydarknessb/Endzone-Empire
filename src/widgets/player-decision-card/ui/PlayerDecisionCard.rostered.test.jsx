import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { rostered } from '../model/decisionContext';

/**
 * player-decision-card widget tests, the `rostered` kind (#1515, T19: the
 * test file split by kind - AC3). See PlayerDecisionCard.myTeam.test.jsx for
 * the sections every kind shares and the widget's own six-prop contract
 * test.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  apiClient.get.mockResolvedValue({ data: { line: null, weather: null, usage: null } });
});

afterEach(() => {
  jest.clearAllMocks();
});

const availabilityEntry = (over = {}) => ({
  playerId: 7,
  name: 'Breece Hall',
  position: 'RB',
  nflTeam: 'NYJ',
  slot: 'RB',
  injuryStatus: null,
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  ...over,
});

function mockCardRoute(card) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/card?')) return Promise.resolve({ data: card || {} });
    return Promise.resolve({ data: { line: null, weather: null, usage: null } });
  });
}

function renderCard(props = {}) {
  const {
    open = true,
    onClose = jest.fn(),
    entry = availabilityEntry(),
    leagueId = 1,
    week = 4,
    availability = {},
    playerIds,
    onNavigate,
  } = props;
  const merged = {
    open,
    onClose,
    entry,
    leagueId,
    week,
    context: rostered({ availability, playerIds, onNavigate }),
  };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

test('shows a Propose trade link and the rostering team', async () => {
  mockCardRoute(null);
  renderCard({ leagueId: 7, availability: { teamName: 'Polk High Legends' } });

  expect(await screen.findByTestId('decision-card-propose-trade')).toHaveAttribute('href', '/league/7/trades');
  expect(screen.getByText('Rostered by Polk High Legends')).toBeInTheDocument();
});

test('renders no "Rostered by" line when the owning team is unknown, and no bench options or acquire action bar', async () => {
  mockCardRoute(null);
  renderCard({ leagueId: 7, availability: {} });

  await screen.findByTestId('decision-card-propose-trade');
  expect(screen.queryByText(/Rostered by/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
  expect(screen.queryByTestId('add-player-action')).not.toBeInTheDocument();
  expect(screen.queryByTestId('claim-player-action')).not.toBeInTheDocument();
});

// #1515: PlayerManagement's own prev/next over the page it opened the card
// from, threaded through rostered()'s own `playerIds`/`onNavigate` fields -
// TradeCenter/MatchupPage's single-player open never sets either.
test('playerIds/onNavigate from the built context drive prev/next', async () => {
  mockCardRoute(null);
  const onNavigate = jest.fn();
  renderCard({
    availability: { teamName: 'Polk High Legends' },
    playerIds: [5, 7, 9],
    onNavigate,
  });

  expect(await screen.findByLabelText('Player 2 of 3')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('decision-card-next'));
  expect(onNavigate).toHaveBeenCalledWith(9);
});

test('a single-player open (TradeCenter/MatchupPage) renders no prev/next controls', async () => {
  mockCardRoute(null);
  renderCard({ availability: { teamName: 'Polk High Legends' } });

  await screen.findByTestId('decision-card-propose-trade');
  expect(screen.queryByTestId('decision-card-prev')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-next')).not.toBeInTheDocument();
});
