import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import LeagueDashboardPage from './index';

// The page reads the league through the shared apiClient (via useLeague ->
// useResource), so the whole client is mocked and every GET is answered by the
// URL-keyed dispatcher below. This is the ONE test seam the six later dashboard
// tickets extend: they add their endpoints to `mockGetByUrl` and their payload
// shapes to the fixture builders, without editing the tests already here.
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  // useLeague reads through the shared resource cache, which is module state and
  // outlives a test: without this clear the next test renders the previous
  // test's league row.
  clearLeagueCache();
  // The copy-invite feature writes to the clipboard; jsdom has none by default.
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
});

afterEach(() => {
  jest.clearAllMocks();
});

// A `teams[]` of length n. Widgets in later tickets add the per-team fields they
// read (record, points, avatar); the page shell reads only the count.
const buildTeams = (n) =>
  Array.from({ length: n }, (_, i) => ({ teamId: i + 1, id: i + 1, name: `Team ${i + 1}` }));

/**
 * The GET /api/league/:id payload: the league row (carrying `is_commissioner`
 * and, for a commissioner, `invite_code`), its teams, and the viewer's own team
 * id at the response root (#112). Later tickets extend `league`/`teams` here.
 */
const leagueDetail = ({ league = {}, teams, viewerTeamId = 1 } = {}) => ({
  data: {
    viewerTeamId,
    league: {
      id: 1,
      name: 'MinneApple',
      draft_status: 'pending',
      season_status: 'regular',
      is_commissioner: false,
      ...league,
    },
    teams: teams ?? buildTeams(1),
  },
});

// Phase presets, each derived by the client League-phase helper from the raw
// columns, never a stored status field.
const inSeasonLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3, ...overrides },
    teams: buildTeams(12),
  });

const preDraftLeague = (overrides = {}) =>
  leagueDetail({ league: { draft_status: 'pending', ...overrides }, teams: buildTeams(8) });

const pickemOnlyLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      pickem_only: true,
      draft_status: 'pending',
      season_status: 'regular',
      current_week: 6,
      ...overrides,
    },
    teams: buildTeams(20),
  });

/**
 * Build a URL-keyed apiClient.get mock. `overrides` maps a URL (matched exactly
 * or as a trailing path segment via endsWith) to a resolved value, a
 * `{ reject: <error> }` marker, or a `{ pending: true }` marker for a request
 * that stays on the wire for the rest of the test. Unmatched URLs fall back to
 * an empty response. Exact/suffix matching (not a loose `includes`) keeps a key
 * like '/api/league/1' from also matching a nested '/api/league/1/...' request.
 * This mirrors the legacy dashboard test's dispatcher so the two read the same.
 */
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

const renderPage = (leagueId = 1) =>
  renderWithProviders(<LeagueDashboardPage />, {
    path: '/league/:leagueId',
    route: `/league/${leagueId}`,
  });

// --- loading + error ------------------------------------------------------

test('shows a loading placeholder until the league arrives', () => {
  mockGetByUrl({ '/api/league/1': { pending: true } });
  renderPage();
  expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
});

test('shows an error message when the league fails to load', async () => {
  mockGetByUrl({
    '/api/league/1': { reject: { response: { data: { error: 'league not found' } } } },
  });
  renderPage();
  expect(await screen.findByText('league not found')).toBeInTheDocument();
});

// --- header chips (derived from the League-phase helper) -------------------

test('in-season: h1 league name with Week/phase, team-count, and Draft Complete chips', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  expect(await screen.findByRole('heading', { level: 1, name: 'MinneApple' })).toBeInTheDocument();
  // The phase label is the helper's own (LEAGUE_PHASE_META), never a parallel
  // in-page derivation; the week rides in front of it while the season is live.
  expect(screen.getByText('Week 3 · In season')).toBeInTheDocument();
  expect(screen.getByText('12 Teams')).toBeInTheDocument();
  expect(screen.getByText('Draft Complete')).toBeInTheDocument();
});

test('pre-draft: shows the pre-draft phase label and no Draft Complete chip', async () => {
  mockGetByUrl({ '/api/league/1': preDraftLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.getByText('Pre-draft')).toBeInTheDocument();
  expect(screen.getByText('8 Teams')).toBeInTheDocument();
  expect(screen.queryByText('Draft Complete')).not.toBeInTheDocument();
});

test("pick'em-only: renders no draft chip, still counts teams and shows the live week", async () => {
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.getByText('20 Teams')).toBeInTheDocument();
  // A pick'em-only league is in season from creation, so the live week chip
  // renders, but it has no draft, so the draft chip never does.
  expect(screen.getByText('Week 6 · In season')).toBeInTheDocument();
  expect(screen.queryByText('Draft Complete')).not.toBeInTheDocument();
});

// --- copy-invite feature slice --------------------------------------------

test('commissioner (invite_code present): the Invite button copies the join link and confirms', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague({ invite_code: 'abc123' }) });
  renderPage();

  const inviteButton = await screen.findByRole('button', { name: /invite/i });
  // The accessible name carries the code so a screen-reader user hears which
  // league they are sharing.
  expect(inviteButton).toHaveAccessibleName(/abc123/);
  expect(screen.getByText('abc123')).toBeInTheDocument();

  await userEvent.click(inviteButton);

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    `${window.location.origin}/#/league/join?code=abc123`
  );
  expect(await screen.findByText('Copied')).toBeInTheDocument();
  // The success is announced to assistive tech through a polite live region,
  // not left to the (inconsistently announced) button-name swap alone.
  expect(screen.getByRole('status')).toHaveTextContent('Invite link copied');
});

test('non-commissioner (no invite_code): no Invite button is rendered', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
});

// --- grid frame -----------------------------------------------------------

test('lays out the hero and main grid regions as empty landmarks', async () => {
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  // The frame the six widget tickets fill: two layout regions, present and empty
  // now, each holding the slots a later ticket swaps its widget into.
  expect(screen.getByTestId('dashboard-hero')).toBeInTheDocument();
  expect(screen.getByTestId('dashboard-main')).toBeInTheDocument();
});
