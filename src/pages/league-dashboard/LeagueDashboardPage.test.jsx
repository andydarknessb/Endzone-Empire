import React from 'react';
import { screen, within } from '@testing-library/react';
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

// ==========================================================================
// my-team-summary widget (#639), the hero-left slot. Each later widget ticket
// (#640-#643) appends its own section like this one: add the endpoints it reads
// to `mockGetByUrl` (a per-test `overrides` map, so no shared setup changes)
// and its own fixture builders, without editing the seam above.
// ==========================================================================

// The viewer (teamId 1) plus one opponent. The Team name is distinct from the
// league name ('MinneApple') so a test can prove the card reads the viewer's
// Team from teams[], not the league or a user payload.
const myTeams = [
  { teamId: 1, id: 1, name: 'MyBallsHurts' },
  { teamId: 2, id: 2, name: 'Terrific T' },
];

// An in-season league whose viewer owns a named Team. Overrides pass straight
// through to leagueDetail (league columns, teams, viewerTeamId).
const myTeamLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
    teams: myTeams,
    viewerTeamId: 1,
    ...overrides,
  });

// GET /api/scoring/league/:id/standings — the widget's spine. Each row carries
// the record fields and a rank; `viewerRow` overrides the teamId-1 row.
const standingsResponse = (viewerRow = {}) => ({
  data: {
    standings: [
      { teamId: 1, name: 'MyBallsHurts', wins: 3, losses: 1, ties: 0, rank: 2, ...viewerRow },
      { teamId: 2, name: 'Terrific T', wins: 1, losses: 3, ties: 0, rank: 8 },
    ],
  },
});

// GET /api/league/:id/draft-grades — the viewer's grade + roster value.
const draftGradesResponse = (viewerRow = {}) => ({
  data: {
    computedAt: '2026-09-01T00:00:00.000Z',
    grades: [
      { teamId: 1, name: 'MyBallsHurts', grade: 'C', rosterValue: 1284, rank: 5, ...viewerRow },
      { teamId: 2, name: 'Terrific T', grade: 'A', rosterValue: 1620, rank: 1 },
    ],
  },
});

// GET /api/scoring/league/:id/power-rankings — the viewer's projected finish.
const powerRankingsResponse = (viewerRank = 6) => ({
  data: {
    season: 2026,
    week: 3,
    viewerTeamId: 1,
    data: {
      computedAt: '2026-09-01T00:00:00.000Z',
      rankings: [
        { teamId: 1, name: 'MyBallsHurts', rank: viewerRank },
        { teamId: 2, name: 'Terrific T', rank: viewerRank === 1 ? 2 : 1 },
      ],
    },
  },
});

test('my-team card shows the viewer Team name from teams[] with a You badge and a named avatar', async () => {
  mockGetByUrl({ '/api/league/1': myTeamLeague() });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // The name is the viewer's Team (teamId 1), not the league name or any account
  // identifier.
  expect(within(card).getByText('MyBallsHurts')).toBeInTheDocument();
  expect(within(card).getByText('You')).toBeInTheDocument();
  // The avatar's accessible name is the Team name (it rides on the labelled
  // wrapper, since TeamAvatar itself is aria-hidden).
  expect(screen.getByRole('img', { name: 'MyBallsHurts' })).toBeInTheDocument();
});

test('my-team card: draft-grades fixture fills the grade and roster-value tiles', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/league/1/draft-grades': draftGradesResponse(),
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  expect(await screen.findByText('C')).toBeInTheDocument();
  expect(screen.getByText('1,284')).toBeInTheDocument();
});

test('my-team card: a 404 from draft-grades leaves the grade and value tiles as placeholders with no digits', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/league/1/draft-grades': { reject: { response: { status: 404 } } },
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  const gradeTile = await screen.findByTestId('stat-draft-grade');
  const valueTile = screen.getByTestId('stat-roster-value');
  // A placeholder mark, and crucially no digits in either tile.
  expect(gradeTile).toHaveTextContent('-');
  expect(valueTile).toHaveTextContent('-');
  expect(gradeTile.textContent).not.toMatch(/\d/);
  expect(valueTile.textContent).not.toMatch(/\d/);
  // The dash is visual only; a screen reader gets a real "Not available" so the
  // tile is not announced as a label pointing at nothing.
  expect(within(gradeTile).getByText('Not available')).toBeInTheDocument();
  expect(within(valueTile).getByText('Not available')).toBeInTheDocument();
});

test('my-team card: no Proj. finish tile until power-rankings has been computed (404)', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/power-rankings': { reject: { response: { status: 404 } } },
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  // Give the rejected read a tick to settle before asserting absence.
  await screen.findByTestId('stat-roster-value');
  expect(screen.queryByTestId('stat-proj-finish')).not.toBeInTheDocument();
  expect(screen.queryByText('Proj. finish')).not.toBeInTheDocument();
});

test('my-team card: a power-rankings fixture placing the viewer 6th reads "6th"', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/power-rankings': powerRankingsResponse(6),
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  const projTile = await screen.findByTestId('stat-proj-finish');
  expect(projTile).toHaveTextContent('6th');
});

test('my-team card: the secondary line shows record and rank once games have been played', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/standings': standingsResponse({ wins: 3, losses: 1, ties: 0, rank: 2 }),
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  const secondary = await screen.findByTestId('my-team-record');
  expect(secondary).toHaveTextContent('3-1');
  expect(secondary).toHaveTextContent('2nd');
});

test('my-team card: preseason (no games played) omits the secondary record line', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague({ league: { draft_status: 'complete', season_status: 'regular' } }),
    '/api/scoring/league/1/standings': standingsResponse({ wins: 0, losses: 0, ties: 0, rank: 1 }),
  });
  renderPage();

  await screen.findByTestId('my-team-summary');
  // The card is present and the standings read has resolved (grade tile is up),
  // but with no games played there is no record line.
  await screen.findByTestId('stat-draft-grade');
  expect(screen.queryByTestId('my-team-record')).not.toBeInTheDocument();
});

test('my-team card: while standings are pending the card holds its layout with skeletons', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/standings': { pending: true },
  });
  renderPage();

  // The league resolves and the card mounts; its identity is up while the
  // standings spine is still in flight, so the data region is skeletons.
  await screen.findByTestId('my-team-summary');
  expect(screen.getAllByTestId('my-team-skeleton').length).toBeGreaterThan(0);
});

test('my-team card: a standings 500 shows a compact error inside the card while the page header chips still render', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/scoring/league/1/standings': { reject: { response: { status: 500, data: { error: 'boom' } } } },
  });
  renderPage();

  // The compact error is self-contained in the card.
  const alert = await screen.findByTestId('my-team-error');
  expect(alert).toHaveTextContent(/could not load/i);
  // The rest of the page is untouched: the league header chips and the viewer
  // identity still render.
  expect(screen.getByText('2 Teams')).toBeInTheDocument();
  expect(screen.getByText('Week 3 · In season')).toBeInTheDocument();
  expect(screen.getByText('MyBallsHurts')).toBeInTheDocument();
});
