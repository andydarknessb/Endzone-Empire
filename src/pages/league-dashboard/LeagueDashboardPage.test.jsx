import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import { invalidate } from '../../lib/resourceCache';
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
  // Clear ALL shared resource caches (ADR 0004), not the league alone: the
  // dashboard widgets read cached resources that are module state and outlive a
  // test (useLeague, and since #641 the week-keyed useStandings both widgets
  // share), so without a blanket clear a later test is served an earlier test's
  // row. A whole-store invalidate covers every cached read a widget adds without
  // this setup needing to name each one.
  invalidate(undefined, { reload: false });
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
  // Exactly one You badge, in the viewer's own row.
  const youBadges = within(card).getAllByText('You');
  expect(youBadges).toHaveLength(1);
  const youRow = within(card).getByTestId('standings-table-you-row');
  expect(within(youRow).getByText('You')).toBeInTheDocument();
  expect(within(youRow).getByText('Squad 1')).toBeInTheDocument();
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
// home/away_team_id). `attachExpectedFinals` also rides on the real row, but
// the widget takes projections from the detail read, not the list, so the
// fixture omits them.
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

  // The row is identifiable to assistive tech, not by color alone (WCAG
  // 1.4.1): a visually-hidden marker, present only on the viewer's row.
  expect(within(viewerRow).getByText('Your team')).toBeInTheDocument();
  expect(within(rows[1]).queryByText('Your team')).not.toBeInTheDocument();
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
