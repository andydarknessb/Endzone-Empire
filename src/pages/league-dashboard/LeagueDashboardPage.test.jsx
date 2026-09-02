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
