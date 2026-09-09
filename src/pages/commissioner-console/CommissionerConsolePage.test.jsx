import React from 'react';
import { screen, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { invalidate } from '../../lib/resourceCache';
import CommissionerConsolePage from './index';

/**
 * commissioner-console page slice tests (ADR 0034, #1107): the single
 * page-level seam, `renderWithProviders` + a URL-keyed apiClient mock, the
 * same shape `LeagueDashboardPage.test.jsx` and `GameCenterPage.test.jsx`
 * use. `CommissionerTools` is mocked - it has its own dedicated test file
 * and its own heavy fetch/tab machinery - to a stand-in that keeps the one
 * thing this page's composition test can answer: that the legacy tools
 * still mount, with an `<h3>` at the level `CommissionerTools` itself sets,
 * and with the props the panel hands them today.
 */
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../components/LeagueDashboard/CommissionerTools', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId, league, teams, viewerTeamId, isOwner, onRefresh }) =>
      ReactLib.createElement(
        'div',
        {
          'data-testid': 'mock-commissioner-tools',
          'data-league-id': leagueId,
          'data-league-name': league?.name,
          'data-teams-count': Array.isArray(teams) ? teams.length : -1,
          'data-viewer-team-id': viewerTeamId,
          'data-is-owner': String(isOwner),
          'data-has-refresh': typeof onRefresh === 'function' ? 'yes' : 'no',
        },
        ReactLib.createElement('h3', null, 'Commissioner Tools')
      ),
  };
});

beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

// A league carrying every field the fact grid reads, plus what the header
// derives from: `is_commissioner`/`ownerTeamId` (the gate), `current_week`
// and a completed draft (the phase chip and the advance-week gate).
const fullyConfiguredLeague = (overrides = {}) => ({
  id: 42,
  name: 'MinneApple',
  is_commissioner: true,
  ownerTeamId: 1,
  draft_status: 'complete',
  season_status: 'regular',
  current_week: 3,
  transactions_locked: true,
  trade_deadline_week: 11,
  waiver_type: 'faab',
  waiver_period_hours: 24,
  trade_review_hours: 24,
  bench_slots: 5,
  ir_slots: 1,
  roster_slots: [
    { key: 'QB', count: 1 },
    { key: 'RB', count: 2 },
    { key: 'WR', count: 3 },
    { key: 'TE', count: 1 },
    { key: 'FLEX', count: 1 },
    { key: 'K', count: 1 },
  ],
  scoring_rules: { receiving: { reception: 0.5 } },
  ...overrides,
});

const teamsWithLocks = (n, lockedCount) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    teamName: `Team ${i + 1}`,
    locked: i < lockedCount,
  }));

// The GET /api/league/:id payload. `league` merges over a fully-configured
// commissioner league so a test that only cares about the gate need not
// restate every fact-grid field. Pass an explicit `league` field to override
// (e.g. `{ is_commissioner: false }` for the member case, which - per the
// red-tell - carries no `invite_code`, so a wrong gate on that field would
// only fail THIS case and no other).
const leagueResponse = ({ league = {}, teams, viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: { ...fullyConfiguredLeague(), ...league },
    teams: teams ?? teamsWithLocks(12, 2),
  },
});

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) return Promise.resolve(value);
    }
    return Promise.resolve({ data: [] });
  });
};

const renderPage = (leagueId = 42) =>
  renderWithProviders(<CommissionerConsolePage />, {
    path: '/league/:leagueId/commissioner',
    route: `/league/${leagueId}/commissioner`,
    state: { user: { id: 1, username: 'alice' } },
  });

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

const renderPageWithLocation = (leagueId = 42) =>
  renderWithProviders(
    <>
      <CommissionerConsolePage />
      <LocationProbe />
    </>,
    {
      path: '/league/:leagueId/commissioner',
      route: `/league/${leagueId}/commissioner`,
      state: { user: { id: 1, username: 'alice' } },
    }
  );

test('a commissioner sees the h1, the breadcrumb, the facts and the CommissionerTools h3', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse() });
  renderPage();

  expect(await screen.findByRole('heading', { level: 1, name: 'Commissioner console' })).toBeInTheDocument();

  const breadcrumb = screen.getByTestId('commissioner-console-breadcrumb');
  expect(within(breadcrumb).getByRole('link', { name: 'MinneApple' })).toHaveAttribute('href', '/league/42');
  expect(within(breadcrumb).getByText('Commissioner')).toBeInTheDocument();

  expect(screen.getByTestId('commissioner-console-fact-transactions')).toHaveTextContent('Locked');
  expect(screen.getByTestId('commissioner-console-fact-roster')).toHaveTextContent('9 starters · 5 bench · 1 IR');

  expect(screen.getByRole('heading', { level: 3, name: 'Commissioner Tools' })).toBeInTheDocument();
  const tools = screen.getByTestId('mock-commissioner-tools');
  expect(tools).toHaveAttribute('data-league-id', '42');
  expect(tools).toHaveAttribute('data-teams-count', '12');
  expect(tools).toHaveAttribute('data-viewer-team-id', '1');
  expect(tools).toHaveAttribute('data-has-refresh', 'yes');
});

test('a member is redirected to the league dashboard', async () => {
  // No invite_code anywhere on this fixture (the red-tell): gating on that
  // field instead of `is_commissioner` would only make THIS case wrongly
  // pass through, not fail, so a mistaken invite_code gate is caught here
  // and nowhere else needs to guard against it.
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { is_commissioner: false, ownerTeamId: 9 },
      viewerTeamId: 1,
    }),
  });
  renderPageWithLocation();

  expect(await screen.findByTestId('location-probe')).toHaveTextContent('/league/42');
  expect(screen.queryByRole('heading', { name: 'Commissioner console' })).not.toBeInTheDocument();
});

test('a non-owner commissioner sees the co-commissioner explainer', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { ownerTeamId: 9 }, viewerTeamId: 1 }),
  });
  renderPage();

  await screen.findByRole('heading', { level: 3, name: 'Commissioner Tools' });
  expect(screen.getByTestId('commissioner-console-co-commissioner-note')).toHaveTextContent(
    'Only the league creator can add or remove co-commissioners.'
  );
});

test('the owner sees no co-commissioner explainer', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { ownerTeamId: 1 }, viewerTeamId: 1 }),
  });
  renderPage();

  await screen.findByRole('heading', { level: 3, name: 'Commissioner Tools' });
  expect(screen.queryByTestId('commissioner-console-co-commissioner-note')).not.toBeInTheDocument();
});

test("a pick'em-only league renders no advance-week control and no facts", async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { pickem_only: true } }),
  });
  renderPage();

  await screen.findByRole('heading', { level: 3, name: 'Commissioner Tools' });
  expect(screen.queryByTestId('commissioner-console-facts')).not.toBeInTheDocument();
  expect(screen.queryByTestId('advance-week')).not.toBeInTheDocument();
});
