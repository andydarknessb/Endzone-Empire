import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { waivers } from '../model/decisionContext';
import { availabilityEntry, mockCardRoute } from './decisionCardTestFixtures';

/**
 * player-decision-card widget tests, the `waivers` kind (#1515, T19: the
 * test file split by kind - AC3). See PlayerDecisionCard.myTeam.test.jsx for
 * the sections every kind shares (Decision strip, Season summary/pick, the
 * weekly bars, Game log, Bio) and the widget's own six-prop contract test.
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

function renderCard(props = {}) {
  const {
    open = true,
    onClose = jest.fn(),
    entry = availabilityEntry(),
    leagueId = 1,
    week = 4,
    availability = {},
    roster = [],
    onActionDone,
    playerIds,
    onNavigate,
  } = props;
  const merged = {
    open,
    onClose,
    entry,
    leagueId,
    week,
    context: waivers({ availability, roster, onActionDone, playerIds, onNavigate }),
  };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

test('renders Claim and the news list, and no bench options', async () => {
  mockCardRoute({ news: [{ headline: 'Questionable for Sunday', publishedAt: null }] });
  renderCard({ availability: { waiverPriority: 3 } });

  expect(await screen.findByTestId('claim-player-action')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
  expect(await screen.findByText('Questionable for Sunday')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-bench-action')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-start-action')).not.toBeInTheDocument();
});

test('a null Upgrade renders no Upgrade tile and no empty label', async () => {
  mockCardRoute({
    decision: { projWeek: { week: 4, points: 12 }, ros: { points: 90 }, upgrade: null },
    news: [],
  });
  renderCard({ availability: { waiverPriority: 1 } });

  await screen.findByTestId('decision-strip');
  expect(screen.queryByTestId('decision-strip-upgrade')).not.toBeInTheDocument();
  expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
});

// formal-001-f3: the sections outside the lineupManaged gate (#1358's Season
// summary/pick) render under waivers too, not only my_team.
test('the Season summary and Season pick render in the waivers context too, not only my_team', async () => {
  mockCardRoute({
    seasons: [
      { season: 2026, games: 10, points: 150, pointsPerGame: 15, posRank: 5, posRankOf: 40, adp: null, weeks: [{ week: 1, kind: 'actual', points: 10 }], log: [] },
      { season: 2025, games: 10, points: 140, pointsPerGame: 14, posRank: 6, posRankOf: 40, adp: null, weeks: [{ week: 1, kind: 'actual', points: 9 }], log: [] },
    ],
  });
  renderCard({ availability: { waiverPriority: 3 } });

  await screen.findByTestId('decision-card-seasons');
  expect(await screen.findByRole('radiogroup', { name: 'Season' })).toBeInTheDocument();
});

// #1312, ADR 0040 follow-up (grill ruling Q6): a watched player opens
// already showing "Watching", and DELETEs on click.
test('a watched player opens already showing "Watching", and DELETEs on click', async () => {
  mockCardRoute({ watching: true });
  renderCard({ availability: { waiverPriority: 3 } });

  expect(await screen.findByRole('button', { name: 'Watching' })).toBeInTheDocument();

  apiClient.delete.mockResolvedValue({});
  await userEvent.click(screen.getByRole('button', { name: 'Watching' }));

  expect(apiClient.delete).toHaveBeenCalledWith('/api/players/7/watch', { params: { leagueId: 1 } });
  expect(await screen.findByRole('button', { name: 'Watch' })).toBeInTheDocument();
});

// #1515 (T19), spec #1494: `waivers(...)`'s own `onActionDone` field is what
// reaches ClaimPlayerAction's `onClaimed` now - no loose `onActionDone` prop
// is left for it to ride beside `context`.
test('onActionDone from the built context fires after a successful Claim', async () => {
  mockCardRoute(null);
  apiClient.post.mockResolvedValue({});
  const onActionDone = jest.fn();
  renderCard({ availability: { waiverPriority: 3 }, onActionDone });

  await userEvent.click(await screen.findByTestId('claim-player-submit'));

  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 1,
    playerId: 7,
    dropPlayerId: null,
    bid: 0,
  });
  await screen.findByTestId('claim-player-submit'); // still rendered, action settled
  expect(onActionDone).toHaveBeenCalledTimes(1);
});

// #1515: PlayerManagement/WaiverWire's own prev/next over the page each
// opened the card from, threaded through waivers()'s own
// `playerIds`/`onNavigate` fields (second risk review, finding 3: the SAME
// sorted order the table renders, not the raw fetch order).
test('playerIds/onNavigate from the built context drive prev/next', async () => {
  mockCardRoute(null);
  const onNavigate = jest.fn();
  renderCard({
    availability: { waiverPriority: 3 },
    playerIds: [5, 7, 9],
    onNavigate,
  });

  expect(await screen.findByLabelText('Player 2 of 3')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('decision-card-next'));
  expect(onNavigate).toHaveBeenCalledWith(9);
});
