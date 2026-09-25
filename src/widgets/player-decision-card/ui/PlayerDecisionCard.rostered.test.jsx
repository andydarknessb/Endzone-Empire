import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { rostered } from '../model/decisionContext';
import { availabilityEntry, mockCardRoute } from './decisionCardTestFixtures';

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
    onActionDone,
  } = props;
  const merged = {
    open,
    onClose,
    entry,
    leagueId,
    week,
    context: rostered({ availability, playerIds, onNavigate, onActionDone }),
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

// Formal review f1 (risk-001-f1): PlayerManagement's rostered open had a
// refresh-after-Watch before this ticket (the loose `onActionDone` prop
// every context shared) - AC4 means `rostered`'s own `onActionDone` field
// restores it.
test('Watch calls onActionDone from the built context on a rostered open', async () => {
  mockCardRoute({ watching: false });
  const onActionDone = jest.fn();
  renderCard({ availability: { teamName: 'Polk High Legends' }, onActionDone });

  apiClient.put.mockResolvedValue({});
  await userEvent.click(await screen.findByRole('button', { name: 'Watch' }));

  expect(await screen.findByRole('button', { name: 'Watching' })).toBeInTheDocument();
  expect(onActionDone).toHaveBeenCalledTimes(1);
});

describe('Opp rank vs position (#1609)', () => {
  const contextRoute = (opponents) => mockCardRoute({ opponents });

  test('renders the position and each opponent rank ordinal', async () => {
    contextRoute([
      { week: 4, opponent: 'DAL', rankVsPosition: 1, allowedPerGame: 30, games: 3 },
      { week: 5, opponent: 'NYG', rankVsPosition: 32, allowedPerGame: 8, games: 3 },
    ]);
    renderCard();

    expect(await screen.findByText(/Opp rank vs RB/)).toBeInTheDocument();
    expect(screen.getByText(/W4 DAL 1st, W5 NYG 32nd/)).toBeInTheDocument();
  });

  test('renders nothing when opponents is empty', async () => {
    contextRoute([]);
    renderCard();

    await screen.findByTestId('decision-card-propose-trade');
    expect(screen.queryByText(/Opp rank vs/)).not.toBeInTheDocument();
  });
});

// #1667: the Usage table is the managed context's alone; the card read
// carries usage for every context, and a non-managed one still hides it.
test('a rostered open hides the Usage table even when the card carries usage', async () => {
  mockCardRoute({
    decision: {
      usage: {
        weeks: [{ season: 2026, week: 3, targets: 8, carries: 0, airYards: 90, snaps: 58, snapShare: 0.87, targetShare: 0.23, fantasyPoints: 12.4 }],
        seasonAverage: null,
      },
    },
  });
  renderCard();

  await screen.findByTestId('decision-card-propose-trade');
  expect(screen.queryByTestId('decision-card-usage-table')).not.toBeInTheDocument();
});

test('the decision strip shows the card payload\'s Ownership and depth chart tiles', async () => {
  mockCardRoute({ ownership: { percentOwned: 64, change: -1.5 }, depth: { positionGroup: 'RB', rank: 1 } });
  renderCard({ availability: {} });

  expect(await screen.findByTestId('decision-strip-ownership')).toHaveTextContent('64.0%');
  expect(screen.getByTestId('decision-strip-depth')).toHaveTextContent('RB1');
});
