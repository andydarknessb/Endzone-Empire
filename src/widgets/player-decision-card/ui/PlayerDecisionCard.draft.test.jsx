import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { draft } from '../model/decisionContext';
import { availabilityEntry, mockCardRoute } from './decisionCardTestFixtures';

/**
 * player-decision-card widget tests, the `draft` kind (#1313, ADR 0040's own
 * follow-up, grill ruling Q32 - not an Availability state) (#1515, T19: the
 * test file split by kind - AC3).
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
    leagueId = 3,
    week = 4,
    draftedBy = null,
    adp = null,
    canDraft = false,
    draftUnavailableReason = null,
    queued = false,
    onDraft = jest.fn(),
    onQueue = jest.fn(),
    playerIds,
    onNavigate,
  } = props;
  const merged = {
    open,
    onClose,
    entry,
    leagueId,
    week,
    context: draft({ draftedBy, adp, canDraft, draftUnavailableReason, queued, onDraft, onQueue, playerIds, onNavigate }),
  };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

test('renders Draft and Queue for an undrafted player, and calls onDraft/onQueue', async () => {
  mockCardRoute(null);
  const onDraft = jest.fn();
  const onQueue = jest.fn();
  renderCard({ canDraft: true, queued: false, onDraft, onQueue });

  await userEvent.click(await screen.findByRole('button', { name: 'Draft' }));
  expect(onDraft).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole('button', { name: 'Queue' }));
  expect(onQueue).toHaveBeenCalledTimes(1);
});

test('omits Draft when canDraft is false, and disables Queue once queued', async () => {
  mockCardRoute(null);
  renderCard({ canDraft: false, queued: true });

  expect(await screen.findByRole('button', { name: 'Queued' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
});

test('shows Draft as focusable aria-disabled with the given reason, and suppresses activation', async () => {
  mockCardRoute(null);
  const onDraft = jest.fn();
  renderCard({
    canDraft: true,
    draftUnavailableReason: "You can only Pick when it's your turn and the draft isn't paused.",
    onDraft,
  });

  const draftAction = await screen.findByRole('button', { name: 'Draft' });
  expect(draftAction).not.toBeDisabled();
  expect(draftAction).toHaveAttribute('aria-disabled', 'true');

  await userEvent.click(draftAction);
  expect(onDraft).not.toHaveBeenCalled();
});

test('replaces the action bar with a Drafted by line once draftedBy is set', async () => {
  mockCardRoute(null);
  renderCard({ draftedBy: 'Polk High Legends', canDraft: true, queued: false });

  expect(await screen.findByText('Drafted by Polk High Legends')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Queue/ })).not.toBeInTheDocument();
});

// #1515 (T19): the pool tiles and prev/next both read the SAME
// `playerIds`/`onNavigate` pair, now carried on draft()'s own context object
// rather than a loose prop beside it.
test('shows the pool ADP and Best available tiles from the built context\'s playerIds index', async () => {
  mockCardRoute(null);
  renderCard({
    entry: availabilityEntry({ playerId: 7 }),
    adp: 3.2,
    canDraft: true,
    playerIds: [5, 7, 9],
    onNavigate: jest.fn(),
  });

  expect(await screen.findByText('ADP 3.2')).toBeInTheDocument();
  expect(screen.getByText('Best available #2')).toBeInTheDocument();
});

test('playerIds/onNavigate from the built context drive prev/next', async () => {
  mockCardRoute(null);
  const onNavigate = jest.fn();
  renderCard({
    entry: availabilityEntry({ playerId: 7 }),
    canDraft: true,
    playerIds: [5, 7, 9],
    onNavigate,
  });

  expect(await screen.findByLabelText('Player 2 of 3')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('decision-card-next'));
  expect(onNavigate).toHaveBeenCalledWith(9);
});

test('no bench options render for the draft kind', async () => {
  mockCardRoute(null);
  const onDraft = jest.fn();
  const onQueue = jest.fn();
  renderCard({ canDraft: true, queued: false, onDraft, onQueue });

  expect(await screen.findByRole('button', { name: 'Draft' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Queue' })).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-bench-action')).not.toBeInTheDocument();
});

// #1312, ADR 0040 follow-up (grill ruling Q6): `draft` is the one context
// that is NOT an Availability state, so it never renders Watch.
test('never renders Watch, which is not shown in the draft context', async () => {
  mockCardRoute({ watching: false });
  renderCard({ canDraft: true, onDraft: jest.fn(), onQueue: jest.fn() });

  await screen.findByTestId('decision-card-draft-action');
  expect(screen.queryByTestId('decision-card-watch')).not.toBeInTheDocument();
  expect(screen.queryByTestId('watch-player-action')).not.toBeInTheDocument();
});

// #1667: Opponent rank vs position rides the card's one read in every context.
test('renders the Opp rank line from the card\'s opponents', async () => {
  mockCardRoute({
    opponents: [
      { week: 4, opponent: 'DAL', rankVsPosition: 1, allowedPerGame: 30, games: 3 },
      { week: 5, opponent: 'NYG', rankVsPosition: 32, allowedPerGame: 8, games: 3 },
    ],
  });
  renderCard();

  expect(await screen.findByTestId('decision-card-opp-rank')).toHaveTextContent('Opp rank vs RB: W4 DAL 1st, W5 NYG 32nd');
});
