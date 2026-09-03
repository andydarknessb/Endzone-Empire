import React from 'react';
import { act, screen, within } from '@testing-library/react';
import axios from 'axios';
import renderWithProviders from '../../test-utils/renderWithProviders';
import DraftPresenter from './DraftPresenter';

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ get: jest.fn() })) },
}));

const mockPresenterGet = axios.create.mock.results[0].value.get;

const draftState = {
  league: {
    name: 'Sunday Ballers',
    draft_status: 'active',
    roster_limit: 2,
    pick_deadline_at: '2099-09-01T12:01:00.000Z',
  },
  teams: [
    { teamId: 1, teamName: 'North Stars', draft_position: 1 },
    { teamId: 2, teamName: 'South Stars', draft_position: 2 },
  ],
  picks: [
    { pick_number: 1, teamId: 1, teamName: 'North Stars', player_id: 10, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', is_keeper: false },
  ],
  onTheClock: { teamId: 2, teamName: 'South Stars' },
};

// The presenter-safe activity feed (#438): Team-only Pick and lifecycle entries,
// oldest-first, exactly as leagueFeed.activityEntryOf shapes them. No chat, no
// account identity, no moderation surface.
const activityEntries = [
  {
    type: 'draft_activity', kind: 'draft_start', id: 1, seq: 1,
    teamId: 1, teamName: 'North Stars', isLegacy: false,
    created_at: '2099-09-01T12:00:00.000Z',
  },
  {
    type: 'draft_activity', kind: 'pick', id: 2, seq: 2,
    teamId: 1, teamName: 'North Stars',
    player: { id: 10, name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' },
    round: 1, pickNumber: 1, isAutopick: false, isLegacy: false,
    created_at: '2099-09-01T12:00:30.000Z',
  },
];

const isActivityUrl = (url) => url.endsWith('/activity');

function routeGet({ activity = activityEntries, activityError = null } = {}) {
  mockPresenterGet.mockImplementation((url) => {
    if (isActivityUrl(url)) {
      return activityError ? Promise.reject(activityError) : Promise.resolve({ data: activity });
    }
    return Promise.resolve({ data: draftState });
  });
}

const boardCalls = () => mockPresenterGet.mock.calls.filter(([url]) => !isActivityUrl(url));
const activityCalls = () => mockPresenterGet.mock.calls.filter(([url]) => isActivityUrl(url));

beforeEach(() => {
  mockPresenterGet.mockReset();
  routeGet();
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders a public draft board from the presenter token route', async () => {
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  expect(await screen.findByRole('heading', { name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.getByText('South Stars is on the clock')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Recent picks' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Round 1 pick 1, North Stars: Josh Allen' })).not.toBeInTheDocument();
  expect(boardCalls()[0][0]).toBe('/api/draft/board/share-token');
});

test('renders the pick clock as "Time remaining:" plus the room\'s m:ss, ticking on its own (#754)', async () => {
  // The fixture deadline is 12:01:00Z; pin the clock one minute before it.
  jest.useFakeTimers('modern');
  jest.setSystemTime(Date.parse('2099-09-01T12:00:00.000Z'));
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  await act(async () => {
    await Promise.resolve();
  });
  const clock = screen.getByTestId('draft-clock');
  expect(clock).toHaveTextContent('Time remaining: 1:00');
  // The old schedule Countdown spoke this as "1m 00s"; one vocabulary now.
  expect(clock).not.toHaveTextContent('1m 00s');

  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(screen.getByTestId('draft-clock')).toHaveTextContent('Time remaining: 0:57');
});

test('the shared DraftBoardMatrix keeps this page\'s own (pre-#121) heading level, not the Draft route\'s default H2', async () => {
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  await screen.findByRole('heading', { name: 'Sunday Ballers' });
  // This page's own hierarchy (h1 the league name, h3 on-the-clock status,
  // h4 Recent picks) has no h2 in it; DraftBoardMatrix's title stays out of
  // that chain entirely rather than defaulting into the middle of it.
  expect(screen.getByRole('heading', { name: 'Draft Board', level: 6 })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Draft Board', level: 2 })).not.toBeInTheDocument();
});

test('polls both the board and the activity feed every five seconds', async () => {
  jest.useFakeTimers();
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  await act(async () => {
    await Promise.resolve();
  });
  expect(boardCalls()).toHaveLength(1);
  expect(activityCalls()).toHaveLength(1);

  await act(async () => {
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
  });
  expect(boardCalls()).toHaveLength(2);
  expect(activityCalls()).toHaveLength(2);
});

test('renders the presenter-safe Draft activity feed (Pick and lifecycle lines)', async () => {
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  const feed = await screen.findByRole('region', { name: /draft activity/i });
  const lines = within(feed).getAllByTestId('draft-activity');
  expect(lines).toHaveLength(2);
  // Newest-first for a live glance board.
  expect(lines[0]).toHaveTextContent('drafted Josh Allen');
  // draft_start carries the acting Team here, so it reads as an attributed line.
  expect(lines[1]).toHaveTextContent('North Stars started the draft');
  // Team-only: the account behind North Stars is never named.
  expect(within(feed).queryByText(/@/)).not.toBeInTheDocument();
  expect(activityCalls()[0][0]).toBe('/api/draft/board/share-token/activity');
});

test('a failing activity fetch never blanks the board: the feed is best-effort', async () => {
  routeGet({ activityError: new Error('activity unavailable') });
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  // The board still renders even though the activity feed request rejected.
  expect(await screen.findByRole('heading', { name: 'Sunday Ballers' })).toBeInTheDocument();
  expect(screen.getByText('South Stars is on the clock')).toBeInTheDocument();
  expect(screen.getByText(/No draft activity yet/i)).toBeInTheDocument();
});

test('an empty activity feed reads as an explicit empty state', async () => {
  routeGet({ activity: [] });
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });

  await screen.findByRole('heading', { name: 'Sunday Ballers' });
  expect(screen.getByText(/No draft activity yet/i)).toBeInTheDocument();
});

test('the presenter link carries no Draft assistant: no panel, no toggle, no banner line (#787)', async () => {
  // The presenter link never joins the member socket, so it never mounts the
  // room's assistant provider or its surfaces (LiveDraftBanner and DraftRail are
  // member-room components this page does not render). Ruling item 5 asks the
  // presenter test to ASSERT that absence rather than the assistant to guard it.
  renderWithProviders(<DraftPresenter />, { path: '/present/:token', route: '/present/share-token' });
  await screen.findByRole('heading', { name: 'Sunday Ballers' });

  // No rail panel (its heading), no per-device toggle, no scrollback list.
  expect(screen.queryByRole('heading', { name: 'Draft assistant' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Draft assistant commentary' })).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Draft assistant commentary' })).not.toBeInTheDocument();
  expect(screen.queryByText('Misery Meter')).not.toBeInTheDocument();
});
