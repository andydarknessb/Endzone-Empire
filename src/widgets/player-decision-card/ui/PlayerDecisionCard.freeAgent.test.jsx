import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import PlayerDecisionCard from './PlayerDecisionCard';
import { freeAgent } from '../model/decisionContext';

/**
 * player-decision-card widget tests, the `free_agent` kind (#1515, T19: the
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

// #1307 (ADR 0040): a non-lineup player row, the shape WaiverWire and
// PlayerManagement map their own rows into - no slot/locked/spent/
// eligibleSlots, since neither surface has a lineup to read those from.
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
    context: freeAgent({ availability, roster, onActionDone, playerIds, onNavigate }),
  };
  return { ...renderWithProviders(<PlayerDecisionCard {...merged} />), props: merged };
}

test('at capacity renders the inline drop pick', async () => {
  mockCardRoute(null);
  renderCard({
    availability: { rosterCount: 16, rosterCapacity: 16 },
    roster: [{ id: 20, name: 'Bench Guy', position: 'WR', projected_weekly_points: 3.2 }],
  });

  const action = await screen.findByTestId('add-player-action');
  expect(within(action).getByLabelText('Drop a player')).toBeInTheDocument();
  expect(within(action).getByTestId('add-player-submit')).toHaveTextContent('Add and drop');
});

test('no bench options and no Claim action render for a free_agent open', async () => {
  mockCardRoute(null);
  renderCard({ availability: { rosterCount: 10, rosterCapacity: 16 } });

  await screen.findByTestId('add-player-action');
  expect(screen.queryByTestId('decision-card-bench-options')).not.toBeInTheDocument();
  expect(screen.queryByTestId('claim-player-action')).not.toBeInTheDocument();
});

test('a null Upgrade renders no Upgrade tile and no empty label', async () => {
  mockCardRoute({
    decision: { projWeek: { week: 4, points: 12 }, ros: { points: 90 }, upgrade: null },
    news: [{ headline: 'Questionable for Sunday', publishedAt: null }],
  });
  renderCard({ availability: { rosterCount: 10, rosterCapacity: 16 } });

  await screen.findByTestId('decision-strip');
  expect(screen.queryByTestId('decision-strip-upgrade')).not.toBeInTheDocument();
  expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
});

// formal-001-f3: this used to render only under `waivers`; `free_agent` is
// its own branch (AddPlayerAction) and needs its own assertion that the
// sections outside the lineupManaged gate (#1358's Season summary/pick)
// render here too, not only under my_team.
test('the Season summary and Season pick render in the free_agent context too, not only my_team', async () => {
  mockCardRoute({
    seasons: [
      { season: 2026, games: 10, points: 150, pointsPerGame: 15, posRank: 5, posRankOf: 40, adp: null, weeks: [{ week: 1, kind: 'actual', points: 10 }], log: [] },
      { season: 2025, games: 10, points: 140, pointsPerGame: 14, posRank: 6, posRankOf: 40, adp: null, weeks: [{ week: 1, kind: 'actual', points: 9 }], log: [] },
    ],
  });
  renderCard({ availability: { rosterCount: 14, rosterCapacity: 16 } });

  await screen.findByTestId('decision-card-seasons');
  expect(await screen.findByRole('radiogroup', { name: 'Season' })).toBeInTheDocument();
});

// #1312, ADR 0040 follow-up (grill ruling Q6): Watch renders across every
// Availability context, driven by the #1306 card payload's own `watching`
// field, with no fetch of its own.
test('the Watch button flips from "Watch" to "Watching" from the card payload, no fetch', async () => {
  mockCardRoute({ watching: false });
  renderCard({ availability: { rosterCount: 10, rosterCapacity: 16 } });

  expect(await screen.findByRole('button', { name: 'Watch' })).toBeInTheDocument();

  apiClient.put.mockResolvedValue({});
  await userEvent.click(screen.getByRole('button', { name: 'Watch' }));

  expect(apiClient.put).toHaveBeenCalledWith('/api/players/7/watch', null, { params: { leagueId: 1 } });
  // The optimistic local override, not a second GET /card fetch: `get` is
  // called only for the initial line/weather/usage + card reads.
  expect(await screen.findByRole('button', { name: 'Watching' })).toBeInTheDocument();
});

// #1515 (T19), spec #1494 ("Acquire builders ... carry the action-done
// callback"): `freeAgent(...)`'s own `onActionDone` field is what reaches
// AddPlayerAction's `onAdded` now - there is no loose `onActionDone` prop
// left for it to ride beside `context`.
test('onActionDone from the built context fires after a successful Add', async () => {
  mockCardRoute(null);
  apiClient.post.mockResolvedValue({});
  const onActionDone = jest.fn();
  renderCard({ availability: { rosterCount: 10, rosterCapacity: 16 }, onActionDone });

  await userEvent.click(await screen.findByTestId('add-player-submit'));

  expect(apiClient.post).toHaveBeenCalledWith('/api/team/roster/7', { leagueId: 1 });
  await screen.findByTestId('add-player-submit'); // still rendered, action settled
  expect(onActionDone).toHaveBeenCalledTimes(1);
});

// #1515: PlayerManagement's own prev/next over the page it opened the card
// from, threaded through freeAgent()'s own `playerIds`/`onNavigate` fields.
test('playerIds/onNavigate from the built context drive prev/next', async () => {
  mockCardRoute(null);
  const onNavigate = jest.fn();
  renderCard({
    availability: { rosterCount: 10, rosterCapacity: 16 },
    playerIds: [5, 7, 9],
    onNavigate,
  });

  expect(await screen.findByLabelText('Player 2 of 3')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('decision-card-next'));
  expect(onNavigate).toHaveBeenCalledWith(9);
});
