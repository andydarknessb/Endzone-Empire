import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, useLocation } from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { invalidate } from '../../lib/resourceCache';
import { publishTeamProfileUpdate, TEAM_PROFILE_UPDATED_EVENT } from '../../lib/teamProfileEvents';
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
    // `data-teams` carries the raw `teams` prop as JSON (teamId/name/teamName/
    // avatar fields, whatever the panel hands the real component today) so a
    // live-identity test (#1172) can pin the write-through this page's own
    // subscription is responsible for - the raw `name` CommissionerTools
    // renders in its removable-Teams row and `Remove <name>` control, and the
    // canonical `teamName` its other tabs read - without reaching into that
    // component's own heavy fetch/tab machinery, which its dedicated test
    // file already covers.
    default: ({ leagueId, league, teams, viewerTeamId, isOwner, onRefresh }) =>
      ReactLib.createElement(
        'div',
        {
          'data-testid': 'mock-commissioner-tools',
          'data-league-id': leagueId,
          'data-league-name': league?.name,
          'data-teams-count': Array.isArray(teams) ? teams.length : -1,
          'data-teams': JSON.stringify(teams ?? []),
          'data-viewer-team-id': viewerTeamId,
          'data-is-owner': String(isOwner),
          'data-has-refresh': typeof onRefresh === 'function' ? 'yes' : 'no',
        },
        ReactLib.createElement('h3', null, 'Commissioner Tools')
      ),
  };
});

// The join-requests widget (#1109) has its own dedicated test file
// (src/widgets/join-requests/ui/JoinRequests.test.jsx) covering its rows, its
// read gate and the decide round trip. What this page's own test can answer -
// and the only thing mocking it out lets that file answer cleanly - is
// whether the PAGE mounts it at all for a given league.
jest.mock('../../widgets/join-requests', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId }) =>
      ReactLib.createElement('div', { 'data-testid': 'mock-join-requests' }, `join requests ${leagueId}`),
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

// Carries both Team-name shapes the live-identity tests (#1172) pin: the raw
// `name` column CommissionerTools renders (the removable-Teams row, the
// `Remove <name>` control) and the canonical `teamName` other consumers read,
// deliberately distinct so a write-through that only patches one shape is
// caught. Also carries the avatar columns the same event updates.
const teamsWithIdentity = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    name: `raw-${i + 1}`,
    teamName: `Team ${i + 1}`,
    avatar_url: `avatar-${i + 1}.png`,
    avatar_static_url: `avatar-${i + 1}-static.png`,
  }));

// The GET /api/league/:id payload. `league` merges over a fully-configured
// commissioner league so a test that only cares about the gate need not
// restate every fact-grid field. No fixture in this file ever sets
// `invite_code`.
const leagueResponse = ({ league = {}, teams, viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: { ...fullyConfiguredLeague(), ...league },
    teams: teams ?? teamsWithLocks(12, 2),
  },
});

// Matches LeagueDashboardPage.test.jsx's own dispatcher: a plain value
// resolves as the GET's data, a `{ reject: <error> }` marker rejects the
// promise, and a `{ pending: true }` marker never settles (for the loading
// branch). Exact/suffix matching keeps '/api/league/42' from also matching
// a nested '/api/league/42/...' request.
const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        if (value && value.reject) return Promise.reject(value.reject);
        if (value && value.pending) return new Promise(() => {}); // never settles
        return Promise.resolve(value);
      }
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

// The redirect LANDS on `/league/:leagueId` - a route this page's own Route
// does not register - so the probe has to be that route's own element (the
// house shape PlayerManagement.test.jsx uses for the same kind of
// cross-route assertion), not a sibling mounted alongside the page under its
// ORIGINAL route. A sibling would unmount the instant Navigate fires (no
// Route matches `/league/42` without this one), which lets `findByTestId`
// resolve during the pre-redirect render instead - the loading skeleton,
// where the h1 does not exist either - and pass for the wrong reason.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{location.pathname}</output>;
}

const renderPageWithLocation = (leagueId = 42) =>
  renderWithProviders(<CommissionerConsolePage />, {
    path: '/league/:leagueId/commissioner',
    route: `/league/${leagueId}/commissioner`,
    state: { user: { id: 1, username: 'alice' } },
    routes: <Route path="/league/:leagueId" element={<LocationProbe />} />,
  });

test('a commissioner sees the h1, the breadcrumb, the facts and the CommissionerTools h3', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse() });
  renderPage();

  expect(await screen.findByRole('heading', { level: 1, name: 'Commissioner console' })).toBeInTheDocument();

  const breadcrumb = screen.getByTestId('commissioner-console-breadcrumb');
  expect(within(breadcrumb).getByRole('link', { name: 'MinneApple' })).toHaveAttribute('href', '/league/42');
  expect(within(breadcrumb).getByText('Commissioner')).toBeInTheDocument();

  expect(screen.getByTestId('commissioner-console-fact-transactions')).toHaveTextContent('Locked');
  expect(screen.getByTestId('commissioner-console-fact-roster')).toHaveTextContent('9 starters · 5 bench · 1 IR');

  // Re-parenting CommissionerTools (whose own "Commissioner Tools" is a
  // fixed h3) off the panel's Card - which supplied the h2 it was written to
  // nest under - must not leave the heading tree skipping from h1 to h3.
  expect(screen.getByRole('heading', { level: 2, name: 'League administration' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Commissioner Tools' })).toBeInTheDocument();
  // All six props the ticket pins by name, in the order the panel hands
  // them today: leagueId, league, teams, viewerTeamId, isOwner, onRefresh.
  const tools = screen.getByTestId('mock-commissioner-tools');
  expect(tools).toHaveAttribute('data-league-id', '42');
  expect(tools).toHaveAttribute('data-league-name', 'MinneApple');
  expect(tools).toHaveAttribute('data-teams-count', '12');
  expect(tools).toHaveAttribute('data-viewer-team-id', '1');
  expect(tools).toHaveAttribute('data-is-owner', 'true');
  expect(tools).toHaveAttribute('data-has-refresh', 'yes');
});

test('a null trade deadline reads None in the facts strip, never Week 0', async () => {
  // `Number(null)` is 0, so this pins the DOM output (not only the
  // commissionerFacts function boundary in shared/lib) against printing a
  // deadline week nobody set.
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { trade_deadline_week: null } }),
  });
  renderPage();

  const fact = await screen.findByTestId('commissioner-console-fact-trade-deadline');
  expect(fact).toHaveTextContent('None');
  expect(fact).not.toHaveTextContent('Week 0');
});

test('a member is redirected to the league dashboard', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({
      league: { is_commissioner: false, ownerTeamId: 9 },
      viewerTeamId: 1,
    }),
  });
  renderPageWithLocation();

  // An exact match, not a substring one: `/league/42/commissioner` (the
  // pre-redirect path) contains `/league/42` too, so a substring assertion
  // here would pass whether or not the redirect actually happened.
  expect(await screen.findByTestId('location-probe')).toHaveTextContent(/^\/league\/42$/);
  expect(screen.queryByRole('heading', { name: 'Commissioner console' })).not.toBeInTheDocument();
});

test('a non-owner commissioner sees the co-commissioner explainer', async () => {
  // This fixture - `is_commissioner: true`, `ownerTeamId` naming a DIFFERENT
  // Team than `viewerTeamId`, and (like every fixture in this file) no
  // `invite_code` - is the one the ticket's red-tell actually describes,
  // not the member-redirect case above. A gate mistakenly keyed on
  // `invite_code`'s presence rather than `is_commissioner` degenerates to
  // "redirect everyone who is not the creator": the member above is still
  // correctly redirected either way, but this non-owner commissioner - who
  // belongs on the page - would be wrongly redirected too, and this is the
  // only case that catches it.
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

test('the join-requests card mounts for a public, screened league', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { is_public: true, join_approval: true } }),
  });
  renderPage();

  expect(await screen.findByTestId('mock-join-requests')).toHaveTextContent('join requests 42');
});

test('the join-requests card is absent for a private league', async () => {
  mockGetByUrl({
    '/api/league/42': leagueResponse({ league: { is_public: false, join_approval: true } }),
  });
  renderPage();

  await screen.findByRole('heading', { level: 3, name: 'Commissioner Tools' });
  expect(screen.queryByTestId('mock-join-requests')).not.toBeInTheDocument();
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

// --- loading + error ------------------------------------------------------

test('shows a loading placeholder until the league arrives', () => {
  mockGetByUrl({ '/api/league/42': { pending: true } });
  renderPage();

  const loading = screen.getByTestId('commissioner-console-loading');
  expect(loading).toBeInTheDocument();
  // The loading region owns the league read, so it is the one that
  // announces it (Skeleton.jsx: the shapes stay aria-hidden, the owning
  // region speaks).
  expect(loading).toHaveAttribute('aria-busy', 'true');
});

test('a failed league read renders a titled dead end, one alert, and a control that re-fires it', async () => {
  mockGetByUrl({
    '/api/league/42': { reject: { response: { data: { error: 'league not found' } } } },
  });
  renderPage();

  // A surface the viewer can actually see is named here, not "Commissioner
  // console" - the console itself never rendered.
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Console unavailable' })
  ).toBeInTheDocument();

  // One alerted sentence, and it is the page's own: the server's string
  // (an axios internal on a network failure) is deliberately not on screen.
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('We could not load this league right now.');
  expect(screen.queryByText('league not found')).not.toBeInTheDocument();

  // Try again re-fires the read (refetch invalidates the shared league key,
  // so this is a real second GET, not a re-render).
  const before = apiClient.get.mock.calls.filter(([url]) => url === '/api/league/42').length;
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      apiClient.get.mock.calls.filter(([url]) => url === '/api/league/42').length
    ).toBeGreaterThan(before)
  );
});

// --- live Team identity (#1172) --------------------------------------------
//
// The dashboard (LeagueDashboardPage.jsx) only keeps teams[] current while
// IT is mounted; once the viewer is on this console instead, that
// subscription is gone. useCommissionerConsole owns its own League-scoped
// copy so CommissionerTools - which renders the raw `name` column in its
// removable-Teams row and `Remove <name>` control - never shows a stale
// rename. `data-teams` on the mocked stand-in carries the exact `teams` prop
// the real component would render from, so these tests pin the write-through
// this page's own subscription is responsible for without reaching into
// CommissionerTools' own heavy fetch/tab machinery.
const teamsPropOf = (tools) => JSON.parse(tools.getAttribute('data-teams'));

test('a Team-profile rename for this League patches the raw name, canonical teamName and avatar fields with no second league GET', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ teams: teamsWithIdentity(3) }) });
  renderPage();

  const tools = await screen.findByTestId('mock-commissioner-tools');
  expect(teamsPropOf(tools).find((t) => t.teamId === 2)).toMatchObject({
    name: 'raw-2',
    teamName: 'Team 2',
    avatar_url: 'avatar-2.png',
    avatar_static_url: 'avatar-2-static.png',
  });

  const before = apiClient.get.mock.calls.filter(([url]) => url === '/api/league/42').length;

  act(() => {
    publishTeamProfileUpdate({
      leagueId: 42,
      teamId: 2,
      name: 'Renamed Two',
      avatarUrl: 'renamed-two.png',
      avatarStaticUrl: 'renamed-two-static.png',
    });
  });

  await waitFor(() => {
    expect(teamsPropOf(screen.getByTestId('mock-commissioner-tools')).find((t) => t.teamId === 2)).toMatchObject({
      name: 'Renamed Two',
      teamName: 'Renamed Two',
      avatar_url: 'renamed-two.png',
      avatar_static_url: 'renamed-two-static.png',
    });
  });

  // Team 1 and Team 3 are untouched.
  const teams = teamsPropOf(screen.getByTestId('mock-commissioner-tools'));
  expect(teams.find((t) => t.teamId === 1)).toMatchObject({ name: 'raw-1', teamName: 'Team 1' });
  expect(teams.find((t) => t.teamId === 3)).toMatchObject({ name: 'raw-3', teamName: 'Team 3' });

  // The write-through made no request: still the same league GET count.
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/api/league/42').length).toBe(before);
});

test('a Team-profile update for another League does not change the console', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ teams: teamsWithIdentity(3) }) });
  renderPage();

  const tools = await screen.findByTestId('mock-commissioner-tools');
  const before = teamsPropOf(tools);

  act(() => {
    publishTeamProfileUpdate({ leagueId: 999, teamId: 2, name: 'Should not appear' });
  });

  expect(teamsPropOf(screen.getByTestId('mock-commissioner-tools'))).toEqual(before);
  expect(screen.queryByText(/Should not appear/)).not.toBeInTheDocument();
});

test('the subscription is cleaned up on unmount', async () => {
  mockGetByUrl({ '/api/league/42': leagueResponse({ teams: teamsWithIdentity(3) }) });
  const addSpy = jest.spyOn(window, 'addEventListener');
  const removeSpy = jest.spyOn(window, 'removeEventListener');

  const { unmount } = renderPage();
  await screen.findByTestId('mock-commissioner-tools');

  const addCall = addSpy.mock.calls.find(([eventName]) => eventName === TEAM_PROFILE_UPDATED_EVENT);
  expect(addCall).toBeDefined();
  const [, handler] = addCall;

  unmount();

  expect(removeSpy).toHaveBeenCalledWith(TEAM_PROFILE_UPDATED_EVENT, handler);

  addSpy.mockRestore();
  removeSpy.mockRestore();
});
