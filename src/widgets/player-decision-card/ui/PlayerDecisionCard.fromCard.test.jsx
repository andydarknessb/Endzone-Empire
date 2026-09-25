import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { fromCard, myTeam } from '../model/decisionContext';
import { ESPN_FACTS } from './decisionCardTestFixtures';

/**
 * player-decision-card widget tests, the `fromCard()` kind (#1311, ADR 0040
 * ruling c; #1514) (#1515, T19: the test file split by kind - AC3):
 * TransactionLog cannot derive `context` itself (its activity segments carry
 * only `{ playerId, name }`, no roster fact), so it passes `context={fromCard()}`
 * instead of a kind of its own.
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

function mockCardRoute(card) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/card?')) return Promise.resolve({ data: { ...ESPN_FACTS, ...(card || {}) } });
    return Promise.resolve({ data: { line: null, weather: null, usage: null } });
  });
}

function renderCard(props = {}) {
  const {
    open = true,
    onClose = jest.fn(),
    entry = { playerId: 7, name: 'Breece Hall' },
    leagueId = 1,
    week = 4,
    availability,
  } = props;
  const merged = { open, onClose, entry, leagueId, week, context: fromCard({ availability }) };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

test('renders no action bar until the card payload answers', async () => {
  apiClient.get.mockImplementation(() => new Promise(() => {})); // the card never resolves
  renderCard();

  const card = await screen.findByTestId('decision-card');
  expect(card).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('Breece Hall')).toBeInTheDocument();
  // Risk review (#1311): the ONE case where the whole card waits on this
  // read gets its own polite announcement, and a positionless header
  // renders no empty PosChip swatch.
  expect(screen.getByRole('status')).toHaveTextContent('Loading player details');
  expect(screen.queryByTestId('pos-chip')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-actions')).not.toBeInTheDocument();
  expect(screen.queryByTestId('claim-player-action')).not.toBeInTheDocument();
  expect(screen.queryByTestId('add-player-action')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-open-lineup')).not.toBeInTheDocument();
});

// Formal review round 1, f1: the error half of risk-001-f3 - a failed
// /card read used to leave a silent, near-empty dialog forever.
test('a failed /card read shows a visible error, never an action bar or the loading announcement', async () => {
  apiClient.get.mockRejectedValue(new Error('network error'));
  renderCard();

  expect(await screen.findByTestId('decision-card-load-error')).toHaveTextContent(
    "Couldn't load this player's details."
  );
  const card = screen.getByTestId('decision-card');
  expect(card).not.toHaveAttribute('aria-busy');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-actions')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-propose-trade')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-open-lineup')).not.toBeInTheDocument();
});

test('derives context from the card payload once it answers, and the header fills team/position from it', async () => {
  mockCardRoute({
    player: { teamCode: 'MIN', photoUrl: null, position: 'WR', injury: { designation: null, detail: null } },
    availability: { state: 'rostered' },
  });
  renderCard({ entry: { playerId: 7, name: 'Justin Jefferson' }, leagueId: 7 });

  // No `availability` is passed (TransactionLog has none to give), so the
  // rostering team's name is absent - only the header fields the card
  // payload itself supplies are asserted here.
  expect(await screen.findByTestId('decision-card-propose-trade')).toHaveAttribute('href', '/league/7/trades');
  expect(screen.getByText('MIN')).toBeInTheDocument();
  expect(screen.getByText('WR')).toBeInTheDocument();
  // The loading announcement and aria-busy clear once the payload answers.
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByTestId('decision-card')).not.toHaveAttribute('aria-busy');
});

// Formal review round 1, f2: the other three contextFromCard tests only
// exercise availability.state 'rostered'; 'my_team' (the viewer's own
// player) is the other direction TradeCenter/MatchupPage already cover.
test('a my_team payload with no lineup wiring renders Open lineup, not Propose trade', async () => {
  mockCardRoute({ availability: { state: 'my_team' } });
  renderCard({ entry: { playerId: 7, name: 'Breece Hall' }, leagueId: 7 });

  expect(await screen.findByTestId('decision-card-open-lineup')).toHaveAttribute('href', '/league/7/lineup');
  expect(screen.queryByTestId('decision-card-propose-trade')).not.toBeInTheDocument();
});

// #1515 (T19): the public profile's "In your leagues" line HAS its own
// availability fact (its own `/in-your-leagues` payload), unlike
// TransactionLog - `fromCard({ availability })` is what lets it reach the
// eventual action bar's copy (roster count, FAAB, "Rostered by") without a
// loose `availability` prop beside `context`.
test('an availability passed into fromCard() reaches the rostered action bar\'s "Rostered by" line', async () => {
  mockCardRoute({ availability: { state: 'rostered' } });
  renderCard({
    entry: { playerId: 7, name: 'Breece Hall' },
    leagueId: 7,
    availability: { teamName: 'Polk High Legends' },
  });

  expect(await screen.findByTestId('decision-card-propose-trade')).toHaveAttribute('href', '/league/7/trades');
  expect(screen.getByText('Rostered by Polk High Legends')).toBeInTheDocument();
});

// The `fromCard` flag, not the card payload's own availability fact alone,
// is what triggers deferral - a caller that builds a real kind of its own
// (`myTeam(...)`) is untouched even when the SAME mocked card payload would
// answer `waivers` for a `fromCard()` caller.
test('a caller with a kind of its own (myTeam) is untouched by the card payload\'s own availability fact', async () => {
  mockCardRoute({ availability: { state: 'waivers' } });
  renderWithProviders(
    <PlayerDecisionCard
      open
      onClose={jest.fn()}
      entry={{ playerId: 1, name: 'Josh Allen', slot: 'QB', eligibleSlots: ['BENCH', 'QB'] }}
      leagueId={1}
      week={4}
      context={myTeam({ managed: true, onSwap: jest.fn(), onRequestDrop: jest.fn(), canDropEntry: () => true, entries: [] })}
    />
  );

  await screen.findByTestId('decision-card-bench-action');
  expect(screen.queryByTestId('claim-player-action')).not.toBeInTheDocument();
});

test('the decision strip shows the Ownership and depth chart tiles in this context (#1677)', async () => {
  mockCardRoute({});
  renderCard();

  expect(await screen.findByTestId('decision-strip-ownership')).toHaveTextContent('64.0%');
  expect(screen.getByTestId('decision-strip-depth')).toHaveTextContent('RB1');
});
