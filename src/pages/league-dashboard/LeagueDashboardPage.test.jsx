import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { invalidate } from '../../lib/resourceCache';
import { publishTeamProfileUpdate } from '../../lib/teamProfileEvents';
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

// The four legacy surfaces the cutover (#645) composes "as-is" are mocked as
// lightweight stand-ins: each has its own dedicated test file, carries its own
// socket/Redux/self-fetching machinery, and is composed here only for its
// presence and the conditions it mounts under. Mocking them keeps this page
// test on the ONE apiClient seam above (no socket mock, no pick'em cache setup)
// and isolates what the cutover actually adds: the composition gating and the
// page's own chat launcher/badge markup, which stay real below.
//
// The chat panel stand-in reports `mockChatUnread` up through onUnreadChange on
// mount, so a test can drive the launcher's badge without reaching into the
// closed persistent drawer (whose paper MUI hides while closed).
let mockChatUnread = 0;
jest.mock('../../components/ChatPanel/ChatPanel', () => {
  const ReactLib = require('react');
  function MockChatPanel({ onUnreadChange }) {
    ReactLib.useEffect(() => {
      if (onUnreadChange) onUnreadChange(mockChatUnread);
    }, [onUnreadChange]);
    return ReactLib.createElement('div', { 'data-testid': 'mock-chat-panel' });
  }
  return { __esModule: true, default: MockChatPanel };
});
jest.mock('../../components/RecapCard/RecapCard', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId }) =>
      ReactLib.createElement('div', { 'data-testid': 'recap-card' }, `recap ${leagueId}`),
  };
});
jest.mock('../../components/TrophyCase/TrophyCase', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId }) =>
      ReactLib.createElement('div', { 'data-testid': 'trophy-case' }, `trophies ${leagueId}`),
  };
});
jest.mock('../../components/LeaguePickem/PickemStandings', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: ({ leagueId, season }) =>
      ReactLib.createElement(
        'div',
        { 'data-testid': 'pickem-standings' },
        `pickem ${leagueId} ${String(season)}`
      ),
  };
});

beforeEach(() => {
  // Clear ALL shared resource caches (ADR 0004), not the league alone: the
  // dashboard widgets read cached resources that are module state and outlive a
  // test (useLeague, and since #641 the week-keyed useStandings both widgets
  // share), so without a blanket clear a later test is served an earlier test's
  // row. A whole-store invalidate covers every cached read a widget adds without
  // this setup needing to name each one.
  invalidate(undefined, { reload: false });
  // The copy-invite feature writes to the clipboard; jsdom has none by default.
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  // The chat stand-in reports no unread by default; the badge test opts in.
  mockChatUnread = 0;
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
  const loading = screen.getByTestId('dashboard-loading');
  expect(loading).toBeInTheDocument();
  // The loading region owns the league read, so it is the one that announces
  // it (Skeleton.jsx: the shapes stay aria-hidden, the owning region speaks).
  expect(loading).toHaveAttribute('aria-busy', 'true');
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
//
// SCOPE EVERY VALUE ASSERTION to the widget under test with within(card): a
// grade letter, a roster value and a Team name are all rendered by sibling
// widgets on this same page (#640/#641 render the viewer's Team name, #642 a
// grade + roster value per team), and get*/find* throw on multiple matches, so
// a page-wide getByText for one of those turns green here but hard-fails in a
// sibling's PR. Page-level chrome (the header chips) stays page-scoped on
// purpose; only the per-widget values are scoped.
// ==========================================================================

// The viewer (teamId 1) plus one opponent. `teamName` is the canonical Team
// identity field (teamIdentity.js), distinct from the league name
// ('MinneApple') so a test can prove the card reads the viewer's Team from
// teams[], not the league or a user payload.
const myTeams = [
  { teamId: 1, id: 1, teamName: 'MyBallsHurts' },
  { teamId: 2, id: 2, teamName: 'Terrific T' },
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
  // wrapper, since TeamAvatar itself is aria-hidden). Scoped to the card:
  // sibling widgets render the viewer's avatar too.
  expect(within(card).getByRole('img', { name: 'MyBallsHurts' })).toBeInTheDocument();
});

test('my-team card: draft-grades fixture fills the grade and roster-value tiles', async () => {
  mockGetByUrl({
    '/api/league/1': myTeamLeague(),
    '/api/league/1/draft-grades': draftGradesResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('my-team-summary');
  // Scoped to the card: #642 renders a grade letter and a roster value for
  // every team, so a page-wide query would match many.
  expect(await within(card).findByText('C')).toBeInTheDocument();
  expect(within(card).getByText('1,284')).toBeInTheDocument();
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
  const card = await screen.findByTestId('my-team-summary');
  expect(within(card).getAllByTestId('my-team-skeleton').length).toBeGreaterThan(0);
  // The card (the region that owns the fetch) announces the loading state to
  // assistive tech, since the skeleton shapes themselves are aria-hidden.
  expect(card).toHaveAttribute('aria-busy', 'true');
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
  // The rest of the page is untouched: the league header chips (page-level
  // chrome, so page-scoped on purpose) still render...
  expect(screen.getByText('2 Teams')).toBeInTheDocument();
  expect(screen.getByText('Week 3 · In season')).toBeInTheDocument();
  // ...and the viewer identity still renders inside the card (scoped: siblings
  // render the viewer's Team name too).
  const card = screen.getByTestId('my-team-summary');
  expect(within(card).getByText('MyBallsHurts')).toBeInTheDocument();
});

// ==========================================================================
// standings-table widget (#641), the main-grid slot-standings card. Appended
// after the my-team-summary section, which it shares the standings read with:
// both widgets read the same week-keyed useStandings entry, so the page issues
// ONE standings GET between them (AC4 below pins that count).
//
// Every identifier this section adds is slug-prefixed (`standingsTable*`,
// `standings-table-*`) so a sibling ticket appending its own section here can
// never collide silently with one of ours. Per-widget value assertions are
// scoped with within(card): the viewer's Team name and avatar are rendered by
// my-team-summary too, so a page-wide query would match more than one.
// ==========================================================================

// teams[] carrying the canonical `teamName` (teamIdentity.js) plus the raw
// avatar columns the league route serializes. The names are distinct from the
// standings rows' off-contract `name` column below, so a test can prove the
// card reads identity from teams[] and never from the standings row.
const standingsTableTeams = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    teamName: `Squad ${i + 1}`,
    avatar_url: null,
    avatar_static_url: null,
  }));

// GET /api/scoring/league/:id/standings rows, in standings order (rank = the
// position). `name` is the raw, off-contract column the endpoint leaks beside
// identity; it is deliberately NOT the teams[] teamName, so a test can catch a
// widget that reads it. In-season values: distinct records and points per row.
const standingsTableRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    name: `RAW ${i + 1}`,
    wins: n - i,
    losses: i,
    ties: 0,
    pf: 1200 - i * 7.3,
    pa: 1000 + i * 3.1,
    rank: i + 1,
  }));

// Preseason rows: every team present, zero games played.
const standingsTablePreseasonRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1, name: `RAW ${i + 1}`, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, rank: i + 1,
  }));

const standingsTableResponse = (rows) => ({
  data: { league: { current_week: 3, season_status: 'regular' }, standings: rows },
});

// An in-season league whose viewer (teamId 1) owns a named Team in teams[].
const standingsTableLeague = (leagueOverrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3, ...leagueOverrides },
    teams: standingsTableTeams(12),
    viewerTeamId: 1,
  });

// A pre-draft league (phase before in-season): the honest empty state.
const standingsTablePreseasonLeague = () =>
  leagueDetail({
    league: { draft_status: 'pending' },
    teams: standingsTableTeams(8),
    viewerTeamId: 1,
  });

// The dispatcher's call count for the scoring-standings URL, the AC4 property.
const standingsTableGetCount = () =>
  apiClient.get.mock.calls.filter(
    ([url]) => typeof url === 'string' && /\/api\/scoring\/league\/\d+\/standings$/.test(url)
  ).length;

test('standings-table: in-season renders the full table, a team count, names from teams[], and one You badge', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  // Wait for the standings read to resolve (the card is present while it loads).
  await within(card).findByText('Squad 1');
  // Column headers.
  expect(within(card).getByText('Rank')).toBeInTheDocument();
  expect(within(card).getByText('Team')).toBeInTheDocument();
  expect(within(card).getByText('W-L-T')).toBeInTheDocument();
  expect(within(card).getByText('PF')).toBeInTheDocument();
  expect(within(card).getByText('PA')).toBeInTheDocument();
  // The header count of teams.
  expect(within(card).getByTestId('standings-table-count')).toHaveTextContent('12');
  // Each Team name comes from teams[] (teamName), never the standings row's raw
  // `name`: Squad 1 and Squad 12 render; RAW 1 does not.
  expect(within(card).getByText('Squad 1')).toBeInTheDocument();
  expect(within(card).getByText('Squad 12')).toBeInTheDocument();
  expect(within(card).queryByText('RAW 1')).not.toBeInTheDocument();
  // Exactly one You badge, in the viewer's own row - this already proves the
  // pill is absent from every non-viewer row, not just present on the
  // viewer's.
  const youBadges = within(card).getAllByText('You');
  expect(youBadges).toHaveLength(1);
  const youRow = within(card).getByTestId('standings-table-you-row');
  expect(within(youRow).getByText('You')).toBeInTheDocument();
  expect(within(youRow).getByText('Squad 1')).toBeInTheDocument();
  // The row contract (#671): every row-shaped viewer mark carries
  // data-viewer-team, in addition to the visible You pill.
  expect(youRow).toHaveAttribute('data-viewer-team', 'true');
  const youBadge = within(youRow).getByTestId('badge');
  expect(youBadge).toHaveAttribute('data-variant', 'you');
  expect(youBadge).toHaveTextContent('You');
  // Exclusivity, checked directly (not just inferred from the badge count):
  // a non-viewer row carries neither half of the marker. The attribute and
  // the pill are two independent conditionals in the widget, so each needs
  // its own negative - a regression that drops the isViewer guard on only
  // one of them would otherwise pass. Row 0 is the header; row 1 is the
  // viewer (Squad 1); row 2 is the first non-viewer row (Squad 2).
  const tableRows = within(card).getAllByRole('row');
  const otherRow = tableRows[2];
  expect(within(otherRow).getByText('Squad 2')).toBeInTheDocument();
  expect(otherRow).not.toHaveAttribute('data-viewer-team');
  expect(within(otherRow).queryByTestId('badge')).not.toBeInTheDocument();
});

test('standings-table: in-season renders the viewer record as W-L-T and points to one decimal', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  // Viewer is row 0: 12 wins, 0 losses, 0 ties, pf 1200, pa 1000.
  expect(within(youRow).getByText('12-0-0')).toBeInTheDocument();
  expect(within(youRow).getByText('1200.0')).toBeInTheDocument();
  expect(within(youRow).getByText('1000.0')).toBeInTheDocument();
});

test('standings-table: preseason masks records and points and shows the after-Week-1 note', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTablePreseasonLeague(),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTablePreseasonRows(8)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  // The table still renders its teams and ranks (wait for the read to resolve)...
  await within(card).findByText('Squad 1');
  // ...but no 0-0-0 record text anywhere, and the record/points cells are
  // placeholders (a screen-reader "Not available").
  expect(within(card).queryByText('0-0-0')).not.toBeInTheDocument();
  expect(within(card).getAllByText('Not available').length).toBeGreaterThan(0);
  // The honest empty-state note.
  const note = within(card).getByTestId('standings-table-preseason-note');
  expect(note).toHaveTextContent(/after Week 1/i);
});

test('standings-table: pending standings shows skeletons and marks the card busy', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': { pending: true },
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  expect(within(card).getAllByTestId('standings-table-skeleton').length).toBeGreaterThan(0);
  // The card owns the fetch, so it (not each aria-hidden skeleton) reports busy.
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('standings-table: a standings 500 shows a compact error while the header still renders', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague(),
    '/api/scoring/league/1/standings': { reject: { response: { status: 500, data: { error: 'boom' } } } },
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  const error = await within(card).findByTestId('standings-table-error');
  expect(error).toHaveTextContent(/could not load/i);
  // The card header (a labelled landmark) still renders beside the error.
  expect(within(card).getByRole('heading', { name: /standings/i })).toBeInTheDocument();
  expect(within(card).getByTestId('standings-table-count')).toBeInTheDocument();
});

test('standings-table: advancing the league current week causes a second standings GET (1 -> 2)', async () => {
  mockGetByUrl({
    '/api/league/1': standingsTableLeague({ current_week: 3 }),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  // One GET for the page: my-team-summary and standings-table share the read.
  expect(standingsTableGetCount()).toBe(1);

  // The week advances. Re-point the league mock and invalidate the shared league
  // cache so the mounted page re-reads it; the standings key is week-scoped, so
  // week 4 is a new entry and a second GET.
  mockGetByUrl({
    '/api/league/1': standingsTableLeague({ current_week: 4 }),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  act(() => {
    clearLeagueCache(1);
  });
  await waitFor(() => expect(standingsTableGetCount()).toBe(2));
});

// ==========================================================================
// matchup-preview widget (#640), the hero-right slot. Same seam as the
// sections above: this ticket registers its own endpoints on `mockGetByUrl`
// and its own fixture builders without editing anything already here.
//
// SCOPE EVERY VALUE ASSERTION with within(card): the viewer's Team name and
// avatar are rendered by my-team-summary (hero-left) too, so a page-wide query
// for 'MyBallsHurts' would throw on multiple matches. Page-level chrome (the
// header chips) stays page-scoped on purpose.
//
// This widget makes a CHAINED read the earlier sections did not: a matchups
// list read, then a detail read for the matchup it selects. The detail URL
// depends on the first response, so the tests below prove the second read never
// fires with a null id, and that the list read happens exactly once.
// ==========================================================================

// teamId 3 is the viewer, 7 the opponent. `teamName` is the canonical Team
// identity field (teamIdentity.js), kept distinct from the league name
// ('MinneApple') so a test can prove the card reads teams[], not the league.
const mpTeams = [
  { teamId: 3, id: 3, teamName: 'MyBallsHurts', avatar_url: null, avatar_static_url: null },
  { teamId: 7, id: 7, teamName: 'Terrific T', avatar_url: null, avatar_static_url: null },
];

// A week-1 in-season league whose viewer (id 3) owns a named Team. Overrides
// pass straight through to leagueDetail (league columns, teams, viewerTeamId).
const mpLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 1 },
    teams: mpTeams,
    viewerTeamId: 3,
    ...overrides,
  });

// GET /api/league/:id/matchups?week=N - a BARE ARRAY (the real endpoint's
// shape), carrying the raw matchups.* columns the pairing reads (id +
// home/away_team_id). `attachExpectedFinals` also rides on the real row as
// `home_expected_final` / `away_expected_final`, which the widget now prefers
// (#670). `mpViewerPaired` below deliberately omits both fields (`undefined`,
// which the widget's `!= null` check treats the same as `null`): that is what
// keeps the pre-existing tests below on the chained detail-read path. The
// #670 tests that exercise the list-preferred path build their own row via
// `{ ...mpViewerPaired[0], home_expected_final: ..., away_expected_final: ... }`
// rather than adding the fields here.
const mpMatchupsList = (rows) => ({ data: rows });

// A week-1 list pairing the viewer (home, Team 3) against Team 7 as matchup 55,
// plus one unrelated matchup so the pick is a real find, not the only row.
const mpViewerPaired = [
  { id: 55, week: 1, season: 2026, home_team_id: 3, away_team_id: 7, final: false },
  { id: 56, week: 1, season: 2026, home_team_id: 5, away_team_id: 9, final: false },
];

// A week-1 list in which the viewer (Team 3) appears nowhere.
const mpViewerUnpaired = [
  { id: 56, week: 1, season: 2026, home_team_id: 5, away_team_id: 9, final: false },
  { id: 57, week: 1, season: 2026, home_team_id: 8, away_team_id: 2, final: false },
];

// GET /api/league/:id/matchups/:matchupId - detail. The widget reads only each
// side's `expectedFinal` here (the field the matchup detail page renders under
// a "Projected" label); names + avatars come from teams[], never the detail's
// off-contract `name` column, so the fixture's names are deliberately wrong.
const mpMatchupDetail = ({ homeFinal = 112.4, awayFinal = 118.9 } = {}) => ({
  data: {
    viewerTeamId: 3,
    matchup: { id: 55, week: 1, season: 2026, home_team_id: 3, away_team_id: 7 },
    home: { teamId: 3, name: 'WRONG home name', expectedFinal: homeFinal, starters: [], bench: [] },
    away: { teamId: 7, name: 'WRONG away name', expectedFinal: awayFinal, starters: [], bench: [] },
  },
});

const MP_LIST_URL = '/api/league/1/matchups?week=1';
const MP_DETAIL_URL = '/api/league/1/matchups/55';

test('matchup card: heading, both Team names from teams[], and each projected total beside a Projected label', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: mpMatchupDetail(),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(within(card).getByRole('heading', { name: 'Week 1 Matchup' })).toBeInTheDocument();

  // Each side is scoped so the viewer's number sits beside the viewer's name and
  // its own "Projected" label, and likewise the opponent's. findBy waits for the
  // list spine to resolve and the pairing to render.
  const viewerSide = await within(card).findByTestId('matchup-side-viewer');
  const opponentSide = within(card).getByTestId('matchup-side-opponent');
  // Names come from teams[] (teamName), matched by id, NOT the detail's name.
  expect(within(viewerSide).getByText('MyBallsHurts')).toBeInTheDocument();
  expect(within(opponentSide).getByText('Terrific T')).toBeInTheDocument();
  // The projected totals arrive on the chained detail read.
  expect(await within(viewerSide).findByText('112.4')).toBeInTheDocument();
  expect(within(viewerSide).getByText('Projected')).toBeInTheDocument();
  expect(within(opponentSide).getByText('118.9')).toBeInTheDocument();
  expect(within(opponentSide).getByText('Projected')).toBeInTheDocument();
});

test('matchup card: Compare rosters and Set Lineup are links to the matchup detail and lineup pages', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: mpMatchupDetail(),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const compare = await within(card).findByRole('link', { name: 'Compare rosters' });
  const setLineup = within(card).getByRole('link', { name: 'Set Lineup' });
  // The matchup id (55) rides on the Compare-rosters href; Set Lineup is fixed.
  expect(compare.getAttribute('href')).toMatch(/\/league\/1\/matchups\/55$/);
  expect(setLineup.getAttribute('href')).toMatch(/\/league\/1\/lineup$/);
});

test('matchup card: with no matchup for the viewer this week, the card reads "No matchup this week" and has no links', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerUnpaired),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(await within(card).findByText('No matchup this week')).toBeInTheDocument();
  expect(within(card).queryByRole('link', { name: 'Compare rosters' })).not.toBeInTheDocument();
  expect(within(card).queryByRole('link', { name: 'Set Lineup' })).not.toBeInTheDocument();
  // The chained detail read must NOT fire with a null id when there is no pick.
  expect(apiClient.get.mock.calls.some(([u]) => /\/matchups\/\d+$/.test(u))).toBe(false);
});

test('matchup card: a 500 from the matchups list shows a compact error in the card while my-team and the header still render', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: { reject: { response: { status: 500, data: { error: 'boom' } } } },
  });
  renderPage();

  const alert = await screen.findByTestId('matchup-preview-error');
  expect(alert).toHaveTextContent(/could not load/i);
  // The failed read is self-contained: the sibling widget and the page header
  // chips (page-level chrome, so page-scoped on purpose) still render.
  expect(screen.getByTestId('my-team-summary')).toBeInTheDocument();
  expect(screen.getByText('2 Teams')).toBeInTheDocument();
  expect(screen.getByText('Week 1 · In season')).toBeInTheDocument();
});

test('matchup card: exactly one matchups-list GET is made, and it carries the current week', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: mpMatchupDetail(),
  });
  renderPage();

  // Wait for the chained detail read to land so any re-render that would double
  // the list request has already had its chance before we count.
  const card = await screen.findByTestId('matchup-preview');
  await within(card).findByText('112.4');
  const listGets = apiClient.get.mock.calls.filter(([u]) => u.includes('/matchups?week='));
  expect(listGets).toHaveLength(1);
  expect(listGets[0][0]).toContain('week=1');
});

test('matchup card: with no current week the card reads "No matchup this week" and requests no matchups list', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague({
      league: { draft_status: 'complete', season_status: 'regular', current_week: null },
    }),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(await within(card).findByText('No matchup this week')).toBeInTheDocument();
  // No week, so the null-url convention keeps the spine read from ever firing.
  expect(apiClient.get.mock.calls.some(([u]) => u.includes('/matchups'))).toBe(false);
});

test('matchup card: while the matchups list is pending the card holds layout with skeletons and is aria-busy', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: { pending: true },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  expect(within(card).getAllByTestId('matchup-skeleton').length).toBeGreaterThan(0);
  // The card (the region that owns the fetch) announces the loading state; the
  // skeleton shapes themselves are aria-hidden.
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('matchup card: while the detail read is pending the pairing shows with skeletoned totals and stays aria-busy', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: { pending: true },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  // Identity is up from the list + teams[] while the projected totals wait on
  // the chained read, so the card is still layout-busy.
  expect(await within(card).findByText('MyBallsHurts')).toBeInTheDocument();
  expect(within(card).getAllByTestId('matchup-skeleton').length).toBeGreaterThan(0);
  expect(card).toHaveAttribute('aria-busy', 'true');
});

test('matchup card: a failed detail read degrades the projected totals to a placeholder without erroring the card', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList(mpViewerPaired),
    [MP_DETAIL_URL]: { reject: { response: { status: 500 } } },
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const viewerSide = await within(card).findByTestId('matchup-side-viewer');
  // The pairing (from the list + teams[]) still renders: the spine is fine, so a
  // failed detail read degrades only the number, it does not error the card.
  expect(within(viewerSide).getByText('MyBallsHurts')).toBeInTheDocument();
  expect(within(card).queryByTestId('matchup-preview-error')).not.toBeInTheDocument();
  // The projected total is a placeholder: no digits, a real "Not available" for
  // a screen reader, and the "Projected" label is not left pointing at nothing.
  await within(viewerSide).findByText('Not available');
  expect(viewerSide.textContent).not.toMatch(/\d/);
  expect(within(viewerSide).getByText('Projected')).toBeInTheDocument();
  // The detail read has settled, so the card is no longer busy.
  expect(card).toHaveAttribute('aria-busy', 'false');
});

// #670: the list row already carries `home_expected_final` /
// `away_expected_final` (attachExpectedFinals). The widget now prefers those
// over the detail read, and falls back to the detail only when either side is
// null there (never on a bare falsy check: a legitimate 0 is a value).
test('matchup card: list row with both expected finals present renders them and never reads the detail', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: 101.2, away_expected_final: 97.5 },
      mpViewerPaired[1],
    ]),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const viewerSide = await within(card).findByTestId('matchup-side-viewer');
  const opponentSide = within(card).getByTestId('matchup-side-opponent');
  expect(within(viewerSide).getByText('101.2')).toBeInTheDocument();
  expect(within(opponentSide).getByText('97.5')).toBeInTheDocument();
  expect(card).toHaveAttribute('aria-busy', 'false');
  // The list already answered both sides, so the detail read must never fire.
  expect(apiClient.get.mock.calls.some(([u]) => /\/matchups\/\d+$/.test(u))).toBe(false);
});

test('matchup card: list row with one side null falls back to the detail read and renders its values', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: null, away_expected_final: 97.5 },
      mpViewerPaired[1],
    ]),
    [MP_DETAIL_URL]: mpMatchupDetail({ homeFinal: 112.4, awayFinal: 118.9 }),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const viewerSide = await within(card).findByTestId('matchup-side-viewer');
  const opponentSide = within(card).getByTestId('matchup-side-opponent');
  // Both sides come from the detail response once the fallback fires, not a mix
  // of the list's non-null side and the detail's: the fallback is all-or-nothing.
  expect(await within(viewerSide).findByText('112.4')).toBeInTheDocument();
  expect(within(opponentSide).getByText('118.9')).toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([u]) => u === MP_DETAIL_URL)).toBe(true);
});

test('matchup card: a list value of 0 is a real value, not a trigger for the detail read', async () => {
  mockGetByUrl({
    '/api/league/1': mpLeague(),
    [MP_LIST_URL]: mpMatchupsList([
      { ...mpViewerPaired[0], home_expected_final: 0, away_expected_final: 45.6 },
      mpViewerPaired[1],
    ]),
  });
  renderPage();

  const card = await screen.findByTestId('matchup-preview');
  const viewerSide = await within(card).findByTestId('matchup-side-viewer');
  const opponentSide = within(card).getByTestId('matchup-side-opponent');
  expect(await within(viewerSide).findByText('0.0')).toBeInTheDocument();
  expect(within(opponentSide).getByText('45.6')).toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([u]) => /\/matchups\/\d+$/.test(u))).toBe(false);
});

// ==========================================================================
// draft-grades widget (#642), the rail-top slot. Same seam as the section
// above: add the endpoint override to a per-test `mockGetByUrl` map, no
// shared setup changes.
//
// This widget reads the SAME /api/league/:id/draft-grades endpoint as
// my-team-summary above, and AC1 pins the very values (grade C, roster value
// 1,284) that #639's fixture already renders inside its own card. Every
// value assertion here is scoped with within(card) (the widget's own card)
// or within(row) (one row of it), never a page-wide getBy*/findBy*, so this
// section never collides with the section above it or with a sibling ticket
// rendering the same numbers.
// ==========================================================================

// 12 Teams, matching the dashboard-concept mockup's Draft Grades rail: the
// viewer (teamId 1) sits at rank 6 with grade C and roster value 1,284, and
// the top roster value (1,592) belongs to a different Team. `teamName` is the
// canonical Team-identity field (teamIdentity.js); `name` here is the raw
// column the league route also leaks (carry-over comment #5) and must NOT be
// what the card renders.
const draftGradesRailTeams = [
  { teamId: 2, id: 2, teamName: 'Terrific T', name: 'raw-2' },
  { teamId: 3, id: 3, teamName: 'Mike Mike Mike', name: 'raw-3' },
  { teamId: 4, id: 4, teamName: 'Nanagoat', name: 'raw-4' },
  { teamId: 5, id: 5, teamName: 'Lo Expectations', name: 'raw-5' },
  { teamId: 6, id: 6, teamName: 'Fourth and Slong', name: 'raw-6' },
  { teamId: 1, id: 1, teamName: 'MyBallsHurts', name: 'raw-1' },
  { teamId: 7, id: 7, teamName: 'Skattebo Stans', name: 'raw-7' },
  { teamId: 8, id: 8, teamName: 'Bussin Team', name: 'raw-8' },
  { teamId: 9, id: 9, teamName: 'Team Ramrod', name: 'raw-9' },
  { teamId: 10, id: 10, teamName: 'Keep My Team Name', name: 'raw-10' },
  { teamId: 11, id: 11, teamName: 'Hank Da Tank', name: 'raw-11' },
  { teamId: 12, id: 12, teamName: 'Bigpapa6', name: 'raw-12' },
];

const draftGradesRailLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
    teams: draftGradesRailTeams,
    viewerTeamId: 1,
    ...overrides,
  });

// GET /api/league/:id/draft-grades, 12 rows in rank order (the server already
// ranks best-first). Each row's `name` is a decoy raw column deliberately
// different from the matching Team's `teamName` above, so a test that reads
// it by mistake fails loudly instead of passing by coincidence.
const draftGradesRailResponse = () => ({
  data: {
    computedAt: '2026-09-01T00:00:00.000Z',
    grades: [
      { teamId: 2, name: 'raw-2', grade: 'A', rosterValue: 1592, rank: 1 },
      { teamId: 3, name: 'raw-3', grade: 'A', rosterValue: 1548, rank: 2 },
      { teamId: 4, name: 'raw-4', grade: 'A', rosterValue: 1501, rank: 3 },
      { teamId: 5, name: 'raw-5', grade: 'A', rosterValue: 1477, rank: 4 },
      { teamId: 6, name: 'raw-6', grade: 'B', rosterValue: 1390, rank: 5 },
      { teamId: 1, name: 'raw-1', grade: 'C', rosterValue: 1284, rank: 6 },
      { teamId: 7, name: 'raw-7', grade: 'C', rosterValue: 1241, rank: 7 },
      { teamId: 8, name: 'raw-8', grade: 'D', rosterValue: 1144, rank: 8 },
      { teamId: 9, name: 'raw-9', grade: 'D', rosterValue: 1120, rank: 9 },
      { teamId: 10, name: 'raw-10', grade: 'D', rosterValue: 1082, rank: 10 },
      { teamId: 11, name: 'raw-11', grade: 'F', rosterValue: 968, rank: 11 },
      { teamId: 12, name: 'raw-12', grade: 'F', rosterValue: 902, rank: 12 },
    ],
  },
});

test('draft-grades card: heading, Roster value tail, 12 rows in rank order with Team names from teams[]', async () => {
  mockGetByUrl({
    '/api/league/1': draftGradesRailLeague(),
    '/api/league/1/draft-grades': draftGradesRailResponse(),
  });
  renderPage();

  const card = await screen.findByTestId('draft-grades');
  expect(within(card).getByRole('heading', { name: 'Draft Grades' })).toBeInTheDocument();
  expect(within(card).getByText('Roster value')).toBeInTheDocument();

  // Rank order (response order), read from teams[] rather than the grades
  // response's own (decoy) `name` field.
  const expectedOrder = [
    'Terrific T',
    'Mike Mike Mike',
    'Nanagoat',
    'Lo Expectations',
    'Fourth and Slong',
    'MyBallsHurts',
    'Skattebo Stans',
    'Bussin Team',
    'Team Ramrod',
    'Keep My Team Name',
    'Hank Da Tank',
    'Bigpapa6',
  ];
  const rows = await within(card).findAllByRole('row');
  expect(rows).toHaveLength(12);
  expectedOrder.forEach((name, i) => {
    expect(within(rows[i]).getByText(name)).toBeInTheDocument();
  });
  // None of the decoy raw names ever render.
  expect(within(card).queryByText(/^raw-/)).not.toBeInTheDocument();

  // The viewer's own row (teamId 1): scoped to that row so its "C" chip and
  // "1,284" value cannot collide with my-team-summary's card above, which
  // renders the same grade and value for the same viewer.
  const viewerRow = within(card).getByTestId('draft-grades-row-1');
  expect(within(viewerRow).getByRole('img', { name: 'Grade C' })).toBeInTheDocument();
  expect(within(viewerRow).getByText('1,284')).toBeInTheDocument();

  const bar = within(viewerRow).getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-valuenow', '1284');
  expect(bar).toHaveAttribute('aria-valuemax', '1592');
  // Without aria-valuetext, AT reads the value as a percentage of min/max
  // (81%) instead of the roster value itself.
  expect(bar).toHaveAttribute('aria-valuetext', '1,284 of 1,592');

  // The row is identifiable in the accessibility tree and to tooling, not by
  // color alone (WCAG 1.4.1): the shared island viewer-row marker (#671) - a
  // visible "You" pill plus the row-contract attribute.
  expect(viewerRow).toHaveAttribute('data-viewer-team', 'true');
  const youBadge = within(viewerRow).getByTestId('badge');
  expect(youBadge).toHaveAttribute('data-variant', 'you');
  expect(youBadge).toHaveTextContent('You');
  // Exclusivity: a non-viewer row carries neither half of the marker. The
  // attribute and the pill are two independent conditionals in the widget, so
  // each needs its own negative - a regression that drops the isViewer guard
  // on only one of them would otherwise pass.
  expect(rows[1]).not.toHaveAttribute('data-viewer-team');
  expect(within(rows[1]).queryByTestId('badge')).not.toBeInTheDocument();
});

test('draft-grades card: a 404 renders the pending copy with no error', async () => {
  mockGetByUrl({
    '/api/league/1': draftGradesRailLeague(),
    '/api/league/1/draft-grades': { reject: { response: { status: 404 } } },
  });
  renderPage();

  const card = await screen.findByTestId('draft-grades');
  expect(await within(card).findByTestId('draft-grades-pending')).toHaveTextContent(
    'Draft grades arrive once the draft is complete.'
  );
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  expect(within(card).queryByTestId('draft-grades-error')).not.toBeInTheDocument();
  // The card's own header still renders even when the read fails.
  expect(within(card).getByRole('heading', { name: 'Draft Grades' })).toBeInTheDocument();
});

test('draft-grades card: a 500 shows a compact error, and the header still renders', async () => {
  mockGetByUrl({
    '/api/league/1': draftGradesRailLeague(),
    '/api/league/1/draft-grades': { reject: { response: { status: 500, data: { error: 'boom' } } } },
  });
  renderPage();

  const card = await screen.findByTestId('draft-grades');
  const alert = await within(card).findByRole('alert');
  expect(alert).toHaveAttribute('data-testid', 'draft-grades-error');
  expect(alert).toHaveTextContent(/could not load/i);
  expect(within(card).queryByTestId('draft-grades-pending')).not.toBeInTheDocument();
  expect(within(card).getByRole('heading', { name: 'Draft Grades' })).toBeInTheDocument();
});

// #679: the owning Card computes aria-busy from `phase` (Card aria-busy=
// {phase === 'loading'}) rather than from mount/unmount, so a widget stuck
// busy forever would still pass a true-only assertion. The endpoint mock
// below is a manually-resolved promise (not mockGetByUrl's `{ pending: true }`
// marker, which never settles) so this one test can observe both the busy
// state and the settle within it, mirroring the matchup-preview pending/
// settled pair. Scoped with within(card): the draft-grades fixture's viewer
// grade/value collide with my-team-summary's (#642's own review finding).
test('draft-grades card: aria-busy is true while the grades read is pending and false once it resolves', async () => {
  let resolveGrades;
  const gradesPromise = new Promise((resolve) => {
    resolveGrades = resolve;
  });
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1/draft-grades' || url.endsWith('/api/league/1/draft-grades')) {
      return gradesPromise;
    }
    if (url === '/api/league/1' || url.endsWith('/api/league/1')) {
      return Promise.resolve(draftGradesRailLeague());
    }
    return Promise.resolve({ data: [] });
  });
  renderPage();

  const card = await screen.findByTestId('draft-grades');
  expect(within(card).getAllByTestId('draft-grades-skeleton').length).toBeGreaterThan(0);
  expect(card).toHaveAttribute('aria-busy', 'true');

  await act(async () => {
    resolveGrades(draftGradesRailResponse());
    await gradesPromise;
  });

  await within(card).findAllByRole('row');
  expect(card).toHaveAttribute('aria-busy', 'false');
});

// ==========================================================================
// quick-actions widget (#643), the full-width section below the main grid.
// Same seam as the sections above: this ticket registers its own endpoint
// (the viewer roster) on `mockGetByUrl` and its own fixture builders without
// editing anything already here.
//
// Every identifier this section adds is slug-prefixed (`quickActions*`,
// `quick-action(s)-*`) so a sibling ticket appending its own section here can
// never collide silently with one of ours. Per-widget value assertions are
// scoped with within(card) (the widget's own `quick-actions` card) or
// within(tile) (one action link): "Set Lineup" is also rendered as a link by
// matchup-preview above, and "Recommended" would collide across cards, so a
// page-wide query for either would throw on multiple matches. The one
// deliberately page-wide assertion is AC2's negative ("no Recommended anywhere
// on an in-season member page"), which is exactly a page-level claim.
//
// AC5 scope note: a pick'em-only league still renders the my-team, matchup,
// standings and draft-grades cards today (their pick'em gating is #645's
// cutover job, not this ticket). "Shows only Pick'em, Activity, History and
// League Rules" is a claim about THIS widget's own card list, so it is scoped
// with within(card).
// ==========================================================================

// The viewer (teamId 1) plus one opponent, carrying the canonical `teamName`.
const quickActionsTeams = [
  { teamId: 1, id: 1, teamName: 'MyBallsHurts' },
  { teamId: 2, id: 2, teamName: 'Terrific T' },
];

// An in-season fantasy league whose viewer (teamId 1) owns a Team. Overrides
// pass straight through to leagueDetail (league columns, teams, viewerTeamId).
const quickActionsLeague = (overrides = {}) =>
  leagueDetail({
    league: { draft_status: 'complete', season_status: 'regular', current_week: 3 },
    teams: quickActionsTeams,
    viewerTeamId: 1,
    ...overrides,
  });

// The standard 9-starter roster shape, as the league row's `roster_slots`
// jsonb. Only needed by the empty-starting-slot assertion (AC3); the bye
// assertions read it off the default starter order, so they omit it.
const quickActionsStandardSlots = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
  { key: 'TE', count: 1 },
  { key: 'FLEX', count: 1 },
  { key: 'K', count: 1 },
  { key: 'DEF', count: 1 },
];

// GET /api/team/roster?leagueId=1 - a BARE ARRAY of roster rows (the real
// endpoint's shape). The widget reads only `lineup_slot` and `bye_week`.
const quickActionsRosterResponse = (rows) => ({ data: rows });

// A full standard starting lineup: one player per starting slot instance of
// quickActionsStandardSlots. Nobody is on the CURRENT week's bye. DEF One
// deliberately carries an OFF-week bye (bye_week 5, never the fixtures'
// current_week 3): a widget that counted "any non-null bye_week" instead of the
// current week would flag it, so its presence in the no-current-week-bye cases
// pins the comparison to the current week.
const quickActionsFullRoster = () => [
  { id: 11, name: 'QB One', lineup_slot: 'QB', bye_week: null },
  { id: 12, name: 'RB One', lineup_slot: 'RB', bye_week: null },
  { id: 13, name: 'RB Two', lineup_slot: 'RB', bye_week: null },
  { id: 14, name: 'WR One', lineup_slot: 'WR', bye_week: null },
  { id: 15, name: 'WR Two', lineup_slot: 'WR', bye_week: null },
  { id: 16, name: 'TE One', lineup_slot: 'TE', bye_week: null },
  { id: 17, name: 'FLEX One', lineup_slot: 'FLEX', bye_week: null },
  { id: 18, name: 'K One', lineup_slot: 'K', bye_week: null },
  { id: 19, name: 'DEF One', lineup_slot: 'DEF', bye_week: 5 },
];

const QUICK_ACTIONS_ROSTER_URL = '/api/team/roster?leagueId=1';

test('quick-actions: in-season fantasy member renders Play/Moves/League labels with counts and cards linking to league sub-routes', async () => {
  mockGetByUrl({ '/api/league/1': quickActionsLeague() });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  // Group labels carry the visible-card count (no Draft Settings for a member,
  // so League is 4).
  expect(within(card).getByText('Play · 4')).toBeInTheDocument();
  expect(within(card).getByText('Moves · 2')).toBeInTheDocument();
  expect(within(card).getByText('League · 4')).toBeInTheDocument();
  expect(within(card).queryByRole('link', { name: /Draft Settings/ })).not.toBeInTheDocument();

  // Each card is a link whose href ends in the expected league sub-route
  // (scoped to this widget: matchup-preview also renders a "Set Lineup" link).
  const expectedRoutes = {
    draft: /\/league\/1\/draft$/,
    lineup: /\/league\/1\/lineup$/,
    'game-center': /\/league\/1\/game-center$/,
    pickem: /\/league\/1\/pickem$/,
    waivers: /\/league\/1\/waivers$/,
    trades: /\/league\/1\/trades$/,
    activity: /\/league\/1\/activity$/,
    'power-rankings': /\/league\/1\/power-rankings$/,
    history: /\/league\/1\/history$/,
    rules: /\/league\/1\/rules$/,
  };
  Object.entries(expectedRoutes).forEach(([key, route]) => {
    const tile = within(card).getByTestId(`quick-action-${key}`);
    expect(tile.getAttribute('href')).toMatch(route);
  });
});

test('quick-actions: a commissioner fixture adds Draft Settings and the League count becomes 5', async () => {
  mockGetByUrl({ '/api/league/1': quickActionsLeague({ league: { draft_status: 'complete', season_status: 'regular', current_week: 3, is_commissioner: true } }) });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  expect(within(card).getByText('League · 5')).toBeInTheDocument();
  const draftSettings = within(card).getByTestId('quick-action-draft-settings');
  expect(draftSettings.getAttribute('href')).toMatch(/\/league\/1\/draft-settings$/);
});

test('quick-actions: two starters on a current-week bye mark Set Lineup Recommended with the bye copy', async () => {
  const roster = quickActionsFullRoster().map((row) =>
    row.lineup_slot === 'QB' || row.id === 12 ? { ...row, bye_week: 3 } : row
  );
  mockGetByUrl({
    '/api/league/1': quickActionsLeague(),
    [QUICK_ACTIONS_ROSTER_URL]: quickActionsRosterResponse(roster),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  // The recommendation lands once the roster read resolves.
  expect(await within(tile).findByText('Recommended')).toBeInTheDocument();
  expect(within(tile).getByText('2 starters on bye · fix before Sunday')).toBeInTheDocument();
});

test('quick-actions: a full roster with no current-week byes shows no Recommended anywhere on an in-season member page', async () => {
  // roster_slots is supplied so the empty-slot half of the recommendation is
  // LIVE here, not inert: with the required slots known, an empty roster would
  // read 9 empty slots and recommend. A full roster is therefore the reason
  // there is no recommendation, not a coincidence of missing config. The full
  // roster also carries DEF One's off-week bye (bye_week 5 vs current_week 3),
  // so this asserts the widget counts current-week byes only.
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: {
        draft_status: 'complete',
        season_status: 'regular',
        current_week: 3,
        roster_slots: quickActionsStandardSlots,
      },
    }),
    [QUICK_ACTIONS_ROSTER_URL]: quickActionsRosterResponse(quickActionsFullRoster()),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  // Wait for the roster read to resolve into the plain Set Lineup copy, so the
  // absence assertion below is not merely racing an unresolved read.
  expect(await within(tile).findByText('Set your Week 3 lineup')).toBeInTheDocument();
  // A page-level claim on purpose: no card, in this widget or any sibling on the
  // in-season member page, renders "Recommended".
  expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
});

test('quick-actions: a starter missing from a slot the league requires marks Set Lineup Recommended and names the empty-slot count', async () => {
  // Standard slots require two WRs; drop one so a single WR fills the slot.
  const roster = quickActionsFullRoster().filter((row) => row.id !== 15);
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: {
        draft_status: 'complete',
        season_status: 'regular',
        current_week: 3,
        roster_slots: quickActionsStandardSlots,
      },
    }),
    [QUICK_ACTIONS_ROSTER_URL]: quickActionsRosterResponse(roster),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  expect(await within(tile).findByText('Recommended')).toBeInTheDocument();
  expect(within(tile).getByText('1 empty starting slot')).toBeInTheDocument();
});

test('quick-actions: a 500 from the roster read leaves every card rendered and none in an error state', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague(),
    [QUICK_ACTIONS_ROSTER_URL]: { reject: { response: { status: 500 } } },
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-lineup');
  // Set Lineup renders its plain copy (the recommendation is best effort), and
  // the failed read never surfaces an error.
  expect(await within(tile).findByText('Set your Week 3 lineup')).toBeInTheDocument();
  expect(within(tile).queryByText('Recommended')).not.toBeInTheDocument();
  expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  // Every group's cards still render.
  ['draft', 'lineup', 'game-center', 'pickem', 'waivers', 'trades', 'activity', 'power-rankings', 'history', 'rules'].forEach((key) => {
    expect(within(card).getByTestId(`quick-action-${key}`)).toBeInTheDocument();
  });
});

test('quick-actions: a drafting-phase fixture marks Draft Room Recommended', async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({ league: { draft_status: 'active', season_status: 'regular', current_week: 3 } }),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  const tile = within(card).getByTestId('quick-action-draft');
  expect(within(tile).getByText('Recommended')).toBeInTheDocument();
  expect(within(tile).getByText('Draft is live now · make your picks')).toBeInTheDocument();
});

test("quick-actions: a pick'em-only in-season fixture shows only Pick'em, Activity, History and League Rules and marks Pick'em Recommended", async () => {
  mockGetByUrl({
    '/api/league/1': quickActionsLeague({
      league: { pickem_only: true, draft_status: 'pending', season_status: 'regular', current_week: 6 },
    }),
  });
  renderPage();

  const card = await screen.findByTestId('quick-actions');
  // The only cards in this widget's list are the four non-fantasy ones.
  expect(within(card).getByTestId('quick-action-pickem')).toBeInTheDocument();
  expect(within(card).getByTestId('quick-action-activity')).toBeInTheDocument();
  expect(within(card).getByTestId('quick-action-history')).toBeInTheDocument();
  expect(within(card).getByTestId('quick-action-rules')).toBeInTheDocument();
  // The fantasy-only cards (and the Moves group) are gone.
  ['draft', 'lineup', 'game-center', 'waivers', 'trades', 'power-rankings', 'draft-settings'].forEach((key) => {
    expect(within(card).queryByTestId(`quick-action-${key}`)).not.toBeInTheDocument();
  });
  expect(within(card).getByText('Play · 1')).toBeInTheDocument();
  expect(within(card).getByText('League · 3')).toBeInTheDocument();
  expect(within(card).queryByText(/^Moves ·/)).not.toBeInTheDocument();
  // Pick'em carries the highlight a pick'em-only in-season league gives it.
  const pickemTile = within(card).getByTestId('quick-action-pickem');
  expect(within(pickemTile).getByText('Recommended')).toBeInTheDocument();
});

// ==========================================================================
// commissioner-panel widget (#644) + advance-week feature, the rail slot below
// draft grades. Commissioner-only: the panel renders only when the league
// payload's `is_commissioner` flag is true (the same field useQuickActions
// gates its commissionerOnly card on), never on invite_code, which the shell
// gates CopyInvite on and which is a different question. Same test seam as the
// sections above: this ticket registers advance-week on `apiClient.post` and
// its own fixture builders without editing anything already here.
//
// SLUG every fixture identifier with `commissionerPanel` (namespace fence,
// #643 addendum). SCOPE per-widget value assertions with within(card); the
// MUI confirm dialog portals to document.body, so its text is reached with a
// page-level `screen`/`within(dialog)`, deliberately outside the card.
//
// AC3 is a CROSS-WIDGET assertion measured across the page dispatcher, not the
// card: my-team-summary and standings-table share one week-keyed standings read
// (#641), so one page load is ONE standings GET and a successful advance is TWO
// total, via the league refetch re-keying week 1 -> 2. The advance action does
// no standings read of its own; adding one to "make the count come out" is the
// exact mistake the release review warned against.

const commissionerPanelTeams = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    name: `Team ${i + 1}`,
    teamName: `Team ${i + 1}`,
    avatar_url: null,
    avatar_static_url: null,
  }));

// A fantasy league in season whose viewer (teamId 1) is the commissioner.
const commissionerPanelLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      draft_status: 'complete',
      season_status: 'regular',
      current_week: 1,
      is_commissioner: true,
      ...overrides,
    },
    teams: commissionerPanelTeams(12),
    viewerTeamId: 1,
  });

// The same league seen by a plain member: is_commissioner false. It still
// carries an invite_code to prove the panel gates on the flag and not on the
// code the shell's CopyInvite reads (release-review finding: the two gates
// disagree).
const commissionerPanelMemberLeague = (overrides = {}) =>
  commissionerPanelLeague({ is_commissioner: false, invite_code: 'member123', ...overrides });

// A pick'em-only league whose viewer is the commissioner: the panel renders,
// but week advancement is the scheduler's job, so no advance control.
const commissionerPanelPickemLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      pickem_only: true,
      draft_status: 'pending',
      season_status: 'regular',
      current_week: 6,
      is_commissioner: true,
      ...overrides,
    },
    teams: commissionerPanelTeams(20),
    viewerTeamId: 1,
  });

const commissionerPanelAdvanceUrl = '/api/scoring/league/1/advance-week';

test('commissioner-panel: a member sees no panel, no chip, no advance button, and no legacy tool heading', async () => {
  mockGetByUrl({ '/api/league/1': commissionerPanelMemberLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('commissioner-panel')).not.toBeInTheDocument();
  // The panel's card title is the only rendered "Commissioner" text on the
  // page; a member never sees it (verified absence, release review).
  expect(screen.queryByText('Commissioner')).not.toBeInTheDocument();
  expect(screen.queryByText('Only you see this')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /advance to week/i })).not.toBeInTheDocument();
  // A legacy commissioner-tools heading (mounted only behind the disclosure,
  // and only in a commissioner panel) is absent entirely.
  expect(screen.queryByRole('heading', { name: 'Commissioner Tools' })).not.toBeInTheDocument();
});

test('commissioner-panel: week 1 renders the chip, the consequence sentence, and an Advance to Week 2 button; Cancel posts nothing', async () => {
  mockGetByUrl({ '/api/league/1': commissionerPanelLeague({ current_week: 1 }) });
  renderPage();

  const card = await screen.findByTestId('commissioner-panel');
  expect(within(card).getByText('Only you see this')).toBeInTheDocument();
  // The sentence names the current week and the next one (scoped to the card;
  // the dialog restates the same consequence, portaled out of the card).
  expect(
    within(card).getByText("Advancing closes Week 1 matchups and opens Week 2. You'll be asked to confirm.")
  ).toBeInTheDocument();

  const advanceButton = within(card).getByRole('button', { name: 'Advance to Week 2' });
  await userEvent.click(advanceButton);

  // The confirm dialog restates the consequence (naming both weeks).
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/closes Week 1 matchups and opens Week 2/i)).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  // Cancel posts nothing.
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('commissioner-panel: Confirm posts once to advance-week; the league refetch to week 2 causes a second standings GET (1 -> 2) and offers Advance to Week 3', async () => {
  apiClient.post.mockResolvedValue({ data: {} });
  mockGetByUrl({
    '/api/league/1': commissionerPanelLeague({ current_week: 1 }),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  renderPage();

  const card = await screen.findByTestId('commissioner-panel');
  // One page load = one standings GET: my-team-summary and standings-table
  // dedupe onto the shared week-keyed read (#641).
  await waitFor(() => expect(standingsTableGetCount()).toBe(1));

  await userEvent.click(within(card).getByRole('button', { name: 'Advance to Week 2' }));
  const dialog = await screen.findByRole('dialog');

  // The league now reports week 2, so the post-advance refetch re-keys the
  // shared standings read; re-point the dispatcher before confirming.
  mockGetByUrl({
    '/api/league/1': commissionerPanelLeague({ current_week: 2 }),
    '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  });
  await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

  // Exactly one POST, to the advance-week URL, with no body (as the legacy path).
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith(commissionerPanelAdvanceUrl);

  // The action's only job was to land the league refetch; the standings read
  // follows from the week key changing. Second GET, not a third.
  await waitFor(() => expect(standingsTableGetCount()).toBe(2));

  // The panel now offers the following week.
  expect(await within(card).findByRole('button', { name: 'Advance to Week 3' })).toBeInTheDocument();
});

test('commissioner-panel: a 409 from advance-week shows the server message verbatim in an alert region and leaves the button usable', async () => {
  // The exact draft-not-finished sentence the phase gate returns (server's
  // SEASON_BEFORE_DRAFT_MESSAGE). The panel must render what the server sent,
  // not a message of its own built from the status code.
  const serverMessage =
    'the draft has not finished; schedule and scoring are available once it completes';
  apiClient.post.mockRejectedValue({ response: { status: 409, data: { error: serverMessage } } });
  mockGetByUrl({ '/api/league/1': commissionerPanelLeague({ current_week: 1 }) });
  renderPage();

  const card = await screen.findByTestId('commissioner-panel');
  await userEvent.click(within(card).getByRole('button', { name: 'Advance to Week 2' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

  const alert = await within(card).findByRole('alert');
  expect(alert).toHaveTextContent(serverMessage);
  // The button stays usable so the commissioner can retry once the draft ends.
  expect(within(card).getByRole('button', { name: 'Advance to Week 2' })).toBeEnabled();
});

test("commissioner-panel: a pick'em-only commissioner sees the panel but no advance control", async () => {
  mockGetByUrl({ '/api/league/1': commissionerPanelPickemLeague() });
  renderPage();

  const card = await screen.findByTestId('commissioner-panel');
  expect(within(card).getByText('Only you see this')).toBeInTheDocument();
  // Week advancement in a pick'em-only league is the scheduler's job.
  expect(within(card).queryByRole('button', { name: /advance to week/i })).not.toBeInTheDocument();
});

test('commissioner-panel: expanding League administration mounts the legacy commissioner tools', async () => {
  mockGetByUrl({ '/api/league/1': commissionerPanelLeague({ current_week: 1 }) });
  renderPage();

  const card = await screen.findByTestId('commissioner-panel');
  // Collapsed by default: the legacy tools are not mounted, so their heading is
  // absent until the disclosure is opened.
  expect(within(card).queryByRole('heading', { name: 'Commissioner Tools' })).not.toBeInTheDocument();

  await userEvent.click(within(card).getByRole('button', { name: /league administration/i }));

  // One of the legacy tools' known headings now renders (CommissionerTools's own
  // "Commissioner Tools" header), composed as-is with the props the legacy page
  // gives it.
  expect(await within(card).findByRole('heading', { name: 'Commissioner Tools' })).toBeInTheDocument();
});

// ==========================================================================
// Route cutover + parity (#645), the ninth slice. This section proves the
// composition the cutover adds: the four legacy surfaces (chat launcher, recap,
// trophy case, pick'em standings) mount under the same conditions the legacy
// page used, the fantasy vs pick'em-only bodies differ, live team identity
// writes through to every widget, and a widget's failed read never blanks the
// page. The four legacy surfaces are the mocked stand-ins declared at the top
// of this file; the widget slices and the page's own chat launcher markup are
// real. Fixtures are slugged `cutover*` (namespace fence, #643 addendum).
// ==========================================================================

// Count of GETs to the shared league detail URL: AC4's "no second league GET".
const cutoverLeagueGetCount = () =>
  apiClient.get.mock.calls.filter(([url]) => url === '/api/league/1').length;

// GETs that only a fantasy slice makes: scoring standings, matchups, or draft
// grades. AC3 requires a pick'em-only page to fire none of them.
const cutoverFantasyGets = () =>
  apiClient.get.mock.calls
    .map(([url]) => url)
    .filter(
      (url) =>
        typeof url === 'string' &&
        (/\/api\/scoring\/league\/\d+\/standings/.test(url) ||
          /\/api\/league\/\d+\/matchups(\?|\/|$)/.test(url) ||
          /\/api\/league\/\d+\/draft-grades/.test(url))
    );

test('cutover: a fantasy member composes the chat launcher, recap and trophy case alongside the five member widget slices', async () => {
  // inSeasonLeague() is a member (is_commissioner false, no invite_code) with a
  // draft-complete, in-season, 12-team league.
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });

  // Five of the six widget slices render for a member; the sixth, the
  // commissioner panel, mounts in the rail but returns null for a non-
  // commissioner by #644's design, so its own card is absent.
  expect(screen.getByTestId('slot-my-team')).toBeInTheDocument();
  expect(screen.getByTestId('slot-matchup-preview')).toBeInTheDocument();
  expect(screen.getByTestId('slot-standings')).toBeInTheDocument();
  expect(screen.getByTestId('slot-draft-grades')).toBeInTheDocument();
  expect(screen.getByTestId('dashboard-quick-actions')).toBeInTheDocument();
  expect(screen.queryByTestId('commissioner-panel')).not.toBeInTheDocument();

  // The composed-as-is fantasy surfaces.
  expect(screen.getByTestId('recap-card')).toBeInTheDocument();
  expect(screen.getByTestId('trophy-case')).toBeInTheDocument();
  // Pick'em standings never mount on a fantasy league.
  expect(screen.queryByTestId('pickem-standings')).not.toBeInTheDocument();

  // The chat launcher renders for every member, with no unread badge yet.
  expect(screen.getByRole('button', { name: 'Open league chat' })).toBeInTheDocument();
});

test('cutover: the chat launcher carries the unread count the chat panel reports', async () => {
  // The chat stand-in reports this on mount, standing in for messages that
  // arrived while the drawer was closed.
  mockChatUnread = 3;
  mockGetByUrl({ '/api/league/1': inSeasonLeague() });
  renderPage();

  // The launcher's accessible name carries the count (so a screen-reader user
  // hears it without opening the drawer) and the badge shows it.
  const launcher = await screen.findByRole('button', {
    name: 'Open league chat, 3 unread messages',
  });
  expect(within(launcher).getByText('3')).toBeInTheDocument();
});

test("cutover: a pick'em-only member shows pick'em standings and the Pick'em action, omits every fantasy slice, and fires no fantasy read", async () => {
  // pickemOnlyLeague() is a member, pickem_only, in season at week 6.
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });

  // The pick'em body stands in for the fantasy hero/main grid.
  expect(screen.getByTestId('pickem-standings')).toBeInTheDocument();
  // The Pick'em action, from the quick-actions widget (which trims itself to
  // the pick'em surfaces).
  const quickActions = screen.getByTestId('quick-actions');
  expect(within(quickActions).getByTestId('quick-action-pickem')).toBeInTheDocument();
  // The trophy case is common to both league kinds: a completed pick'em season
  // earns a pickem_champion trophy, so gating it on fantasy would drop it.
  expect(screen.getByTestId('trophy-case')).toBeInTheDocument();

  // No fantasy slices, no fantasy layout regions, no recap, no advance control.
  expect(screen.queryByTestId('dashboard-hero')).not.toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-main')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-my-team')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-matchup-preview')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-standings')).not.toBeInTheDocument();
  expect(screen.queryByTestId('slot-draft-grades')).not.toBeInTheDocument();
  expect(screen.queryByTestId('recap-card')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /advance to week/i })).not.toBeInTheDocument();

  // The dispatcher recorded no scoring-standings, matchups or draft-grades GET.
  expect(cutoverFantasyGets()).toEqual([]);
});

// A fantasy league whose teams[] both the standings table and the draft-grades
// rail read (each joins its response rows to teams[] by teamId and renders
// teamName). Team 7 is 'Skattebo Stans' in both until a profile update renames
// it. Reuses the draft-grades rail fixtures established earlier in this file.
const cutoverLiveIdentityMocks = {
  '/api/league/1': draftGradesRailLeague(),
  '/api/scoring/league/1/standings': standingsTableResponse(standingsTableRows(12)),
  '/api/league/1/draft-grades': draftGradesRailResponse(),
};

test('cutover: a team-profile rename writes through to the standings and draft-grades rows with no second league GET', async () => {
  mockGetByUrl(cutoverLiveIdentityMocks);
  renderPage();

  const standingsCard = await screen.findByTestId('standings-table');
  const draftGradesCard = await screen.findByTestId('draft-grades');
  // Team 7's canonical name renders in both widgets, each read from teams[].
  await within(standingsCard).findByText('Skattebo Stans');
  const gradesRow7 = within(draftGradesCard).getByTestId('draft-grades-row-7');
  expect(within(gradesRow7).getByText('Skattebo Stans')).toBeInTheDocument();

  // The single league GET that fed both widgets (they dedupe on the shared
  // useLeague entry).
  expect(cutoverLeagueGetCount()).toBe(1);

  // Another manager's session publishes a rename for Team 7.
  act(() => {
    publishTeamProfileUpdate({ leagueId: 1, teamId: 7, name: 'Renamed Seven' });
  });

  // Both rows re-render with the new name, from the shared teams[] write-through.
  await within(standingsCard).findByText('Renamed Seven');
  await within(gradesRow7).findByText('Renamed Seven');
  expect(within(standingsCard).queryByText('Skattebo Stans')).not.toBeInTheDocument();
  expect(within(gradesRow7).queryByText('Skattebo Stans')).not.toBeInTheDocument();

  // The write-through made no request: still exactly one league GET.
  expect(cutoverLeagueGetCount()).toBe(1);
});

test('cutover: a standings 500 errors the my-team card while matchup, draft grades, quick actions and the header render', async () => {
  // Everything resolves except the shared standings read, which 500s. Per #641
  // that one read feeds both my-team and the standings table, so both surface an
  // error; AC5 only claims the other four surfaces stay normal, which they do.
  // The matchups list is left to the dispatcher's empty fallback, so matchup
  // preview settles on its own honest empty state, not an error.
  mockGetByUrl({
    '/api/league/1': draftGradesRailLeague(),
    '/api/scoring/league/1/standings': { reject: { response: { status: 500 } } },
    '/api/league/1/draft-grades': draftGradesRailResponse(),
  });
  renderPage();

  // Header renders normally.
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });

  // The my-team card shows its own compact error.
  const myTeam = await screen.findByTestId('my-team-summary');
  expect(await within(myTeam).findByTestId('my-team-error')).toBeInTheDocument();

  // Matchup preview renders (no error) rather than being blanked by the
  // standings failure.
  const matchup = screen.getByTestId('matchup-preview');
  expect(within(matchup).queryByTestId('matchup-preview-error')).not.toBeInTheDocument();

  // Draft grades render their rail (no error).
  const draftGrades = screen.getByTestId('draft-grades');
  expect(await within(draftGrades).findByTestId('draft-grades-row-1')).toBeInTheDocument();
  expect(within(draftGrades).queryByTestId('draft-grades-error')).not.toBeInTheDocument();

  // Quick actions render.
  expect(screen.getByTestId('quick-actions')).toBeInTheDocument();
});

// A pre-draft fantasy league with a scheduled draft. draft_status 'pending'
// derives to the pre-draft phase; draft_date is a far-future instant so the
// countdown never expires mid-test.
const cutoverPreDraftLeague = (overrides = {}) =>
  leagueDetail({
    league: {
      draft_status: 'pending',
      draft_date: '2099-09-01T18:00:00.000Z',
      draft_timezone: 'America/New_York',
      ...overrides,
    },
    teams: buildTeams(8),
  });

test('cutover: a pre-draft fantasy league with a draft_date renders the draft countdown; nothing else does', async () => {
  mockGetByUrl({ '/api/league/1': cutoverPreDraftLeague() });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  const countdown = screen.getByTestId('slot-draft-countdown');
  // It is the real Countdown in its full variant, not an empty box: the
  // add-to-calendar control renders because leagueId and leagueName are passed.
  expect(within(countdown).getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument();
});

test('cutover: no draft countdown once the draft_date is absent, past pre-draft, or pick\'em-only', async () => {
  // Pre-draft but no date set: the surface is gated off (matches legacy).
  mockGetByUrl({ '/api/league/1': preDraftLeague() });
  const { unmount } = renderPage();
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('slot-draft-countdown')).not.toBeInTheDocument();
  unmount();

  // In season (past pre-draft): gated off even with a date present.
  invalidate(undefined, { reload: false });
  mockGetByUrl({ '/api/league/1': inSeasonLeague({ draft_date: '2099-09-01T18:00:00.000Z' }) });
  const { unmount: unmount2 } = renderPage();
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('slot-draft-countdown')).not.toBeInTheDocument();
  unmount2();

  // Pick'em-only: no draft at all.
  invalidate(undefined, { reload: false });
  mockGetByUrl({ '/api/league/1': pickemOnlyLeague({ draft_date: '2099-09-01T18:00:00.000Z' }) });
  renderPage();
  await screen.findByRole('heading', { level: 1, name: 'MinneApple' });
  expect(screen.queryByTestId('slot-draft-countdown')).not.toBeInTheDocument();
});

// A pre-draft fantasy league whose viewer (teamId 1) is the commissioner, so
// the commissioner panel can disclose the legacy CommissionerTools. Team 7
// carries a raw `name` deliberately different from its canonical `teamName`, so
// the test can prove the write-through patches the raw column CommissionerTools
// renders (its removable-teams list), not only the teamName the widgets read.
const cutoverCommissionerTeams = [
  { teamId: 1, id: 1, name: 'Owner Raw', teamName: 'Owner Canon', avatar_url: null, avatar_static_url: null },
  { teamId: 7, id: 7, name: 'RawSeven', teamName: 'CanonSeven', avatar_url: null, avatar_static_url: null },
  { teamId: 8, id: 8, name: 'RawEight', teamName: 'CanonEight', avatar_url: null, avatar_static_url: null },
];

test('cutover: a team-profile rename also patches the raw name column CommissionerTools reads', async () => {
  mockGetByUrl({
    '/api/league/1': leagueDetail({
      league: { draft_status: 'pending', is_commissioner: true },
      teams: cutoverCommissionerTeams,
      viewerTeamId: 1,
    }),
  });
  renderPage();

  const panel = await screen.findByTestId('commissioner-panel');
  await userEvent.click(within(panel).getByRole('button', { name: /league administration/i }));

  // CommissionerTools' removable-teams list renders each team's RAW name (Team 7
  // is removable: not the viewer's own team, pre-draft so the list is live).
  expect(await within(panel).findByRole('button', { name: 'Remove RawSeven' })).toBeInTheDocument();

  // Another manager renames Team 7.
  act(() => {
    publishTeamProfileUpdate({ leagueId: 1, teamId: 7, name: 'Renamed Seven' });
  });

  // The raw column updates live in the commissioner tools, as it did on the
  // legacy page (the write-through patches both `name` and `teamName`).
  expect(await within(panel).findByRole('button', { name: 'Remove Renamed Seven' })).toBeInTheDocument();
  expect(within(panel).queryByRole('button', { name: 'Remove RawSeven' })).not.toBeInTheDocument();
});
