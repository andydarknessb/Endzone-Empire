import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate, setResource } from '../../../lib/resourceCache';
import StandingsTable from '../index';

/**
 * The standings-table widget's own suite (#641 follow-ups T3/T4). The page test
 * mounts this widget for real and pins its content; what lives here is what
 * only the widget can answer: the density columns it maps off the standings
 * read, the playoff cut and its guard, the island's viewer-row treatment and
 * the phone fold.
 *
 * The widget is mounted through its public surface (widgets/standings-table's
 * index, ADR 0020) on the one seam the page test uses too: the shared apiClient,
 * with every GET answered by the URL-keyed dispatcher below.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  // The widget's two reads are shared, module-level caches (ADR 0004) that
  // outlive a test, so every entry is dropped between tests or a later test is
  // served an earlier one's league.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class
// (GameCenterPage.test.jsx:168 reads layout the same way). This gathers the
// declarations of every rule emitted for one element, keyed by media condition
// ('' for the unconditional ones), so the responsive fold can be read as well
// as the resting look.
const rulesUnder = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const found = {};
  const visit = (rules, media) => {
    Array.from(rules || []).forEach((rule) => {
      if (rule.cssRules && rule.media) {
        visit(rule.cssRules, rule.media.mediaText);
        return;
      }
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      found[media] = `${found[media] || ''}${rule.style.cssText};`;
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => visit(sheet.cssRules, ''));
  return found;
};

// Every declaration emitted for an element, media queries included, as one
// string: enough for "is this rule present at all" assertions.
const allRules = (el) => Object.values(rulesUnder(el)).join(' ');

// The keys `rulesUnder` returns for a responsive sx value. MUI emits every
// breakpoint as a min-width query, xs included, so a value set at xs is not in
// the unconditional rule but in the 0px one.
const XS = '(min-width:0px)';
const SM = '(min-width:600px)';
const LG = '(min-width:1200px)';

const teamsPayload = (n) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: i + 1,
    id: i + 1,
    teamName: `Squad ${i + 1}`,
    avatar_url: null,
    avatar_static_url: null,
  }));

// GET /api/league/:id. `draft_status: 'complete'` with a regular-season status
// is the in-season phase (leaguePhase.js), the state the density columns are
// about; the preseason league below is the pre-draft one.
const leagueResponse = ({ teamCount = 12, league = {} } = {}) => ({
  data: {
    league: {
      id: 1,
      draft_status: 'complete',
      season_status: 'regular',
      current_week: 6,
      ...league,
    },
    teams: teamsPayload(teamCount),
    viewerTeamId: 1,
  },
});

// GET /api/scoring/league/:id/standings, in standings order. `streak`, `winPct`
// and `playoffSeed` are shaped exactly as season.service.js and
// scoring.router.js emit them: the seed is the rank while it is inside the
// bracket and null once it is not, and `-` is the server's own "no games yet"
// streak. `name` is the row's raw, off-contract column, never the display name.
const standingsRows = ({ count = 12, playoffTeams = null, seeded = true } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    teamId: i + 1,
    name: `RAW ${i + 1}`,
    wins: count - i,
    losses: i,
    ties: 0,
    pf: 1200 - i * 7.3,
    pa: 1000 + i * 3.1,
    rank: i + 1,
    streak: i === 0 ? 'W3' : 'L1',
    winPct: i === 0 ? 0.875 : 0.5,
    ...(seeded && playoffTeams != null
      ? { playoffSeed: i + 1 <= playoffTeams ? i + 1 : null }
      : {}),
  }));

const standingsResponse = ({ rows = standingsRows(), league = {} } = {}) => ({
  data: { league: { current_week: 6, ...league }, standings: rows },
});

// Preseason: every Team present, no games played, and the server's bare-dash
// streak.
const preseasonRows = (count = 8) =>
  Array.from({ length: count }, (_, i) => ({
    teamId: i + 1,
    name: `RAW ${i + 1}`,
    wins: 0,
    losses: 0,
    ties: 0,
    pf: 0,
    pa: 0,
    rank: i + 1,
    streak: '-',
    winPct: 0,
    playoffSeed: i + 1,
  }));

// `pending: true` never resolves, which is the loading branch.
const mockGetByUrl = (byUrl) => {
  apiClient.get.mockImplementation((url) => {
    const match = Object.keys(byUrl).find((key) => String(url).startsWith(key));
    const answer = match ? byUrl[match] : undefined;
    if (!answer) return Promise.reject(new Error(`unmocked GET ${url}`));
    if (answer.pending) return new Promise(() => {});
    if (answer.reject) return Promise.reject(answer.reject);
    return Promise.resolve(answer);
  });
};

// The league is put in the shared cache rather than fetched, because the
// standings read is keyed by the league's current week (useStandings): mounted
// outside the page's own "no widget until the league lands" gate, this widget
// would otherwise key that read weekless, re-key when the league arrived and
// drop back to skeletons mid-test. Priming is the write-through useLeague
// itself performs, and it leaves exactly one GET for a test to answer.
const primeLeague = ({ teamCount = 12, league = {} } = {}) => {
  setResource(['league', 1], leagueResponse({ teamCount, league }).data);
};

const renderTable = () => renderWithProviders(<StandingsTable leagueId={1} />);

// The one row carrying the playoff cut, if any.
// eslint-disable-next-line testing-library/no-node-access -- the cut mark is a border on a row, identifiable to tooling only
const cutRows = () => document.querySelectorAll('tr[data-cut-line]');

// --- density: streak, win percentage --------------------------------------

test('standings-table: renders the streak and win percentage the read already carries', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  // The column exists, and the viewer's own row carries the server's trailing
  // streak string and its win percentage in standings form (no leading zero).
  expect(within(card).getByText('STRK')).toBeInTheDocument();
  expect(within(card).getByText('PCT')).toBeInTheDocument();
  expect(within(youRow).getByText('W3')).toBeInTheDocument();
  expect(within(youRow).getByText('.875')).toBeInTheDocument();
});

test('standings-table: preseason masks the streak instead of printing the server dash', async () => {
  primeLeague({ teamCount: 8, league: { draft_status: 'pending' } });
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({ rows: preseasonRows(8) }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  // No raw '-' streak and no ".000" win percentage: both are Placeholders,
  // which is what makes the footer note ("populate after Week 1") true.
  expect(within(card).queryByText('.000')).not.toBeInTheDocument();
  expect(within(card).getAllByText('Not available').length).toBeGreaterThan(0);
});

// --- the playoff cut -------------------------------------------------------

test('standings-table: the playoff cut rules off the first Team out of the bracket', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({
      rows: standingsRows({ count: 12, playoffTeams: 6 }),
      league: { playoff_teams: 6 },
    }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  // Exactly once, and on the row below the last seeded Team - so it reads as a
  // boundary, not as a property of a row.
  const marks = within(card).getAllByTestId('standings-table-cut-line');
  expect(marks).toHaveLength(1);
  expect(marks[0]).toHaveTextContent('Playoff cut line');
  // eslint-disable-next-line testing-library/no-node-access -- walking from the visually hidden mark up to its own row is the assertion
  const cutRow = marks[0].closest('tr');
  expect(within(cutRow).getByText('Squad 7')).toBeInTheDocument();
  expect(cutRows()).toHaveLength(1);
  // The rule itself, on that row's cells: the strong line token, not the
  // hairline every other row carries.
  expect(allRules(cutRow)).toMatch(/border-top:\s*2px solid var\(--dash-line-strong\)/);
});

test('standings-table: no cut line in a league where every team makes the playoffs', async () => {
  primeLeague({ teamCount: 4 });
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({
      rows: standingsRows({ count: 4, playoffTeams: 4 }),
      league: { playoff_teams: 4 },
    }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 4');
  // Nothing is out, so there is no boundary to draw or to announce - and no
  // row may carry the rule, including the last one.
  expect(within(card).queryByTestId('standings-table-cut-line')).not.toBeInTheDocument();
  expect(cutRows()).toHaveLength(0);
  // eslint-disable-next-line testing-library/no-node-access -- proving the rule is on NO row means reading every row as an element
  const rows = card.querySelectorAll('tbody tr');
  rows.forEach((row) => {
    expect(allRules(row)).not.toMatch(/var\(--dash-line-strong\)/);
  });
});

test('standings-table: no cut line when the standings read states no bracket', async () => {
  // The shape the page-test fixture ships: no playoff_teams on the league, and
  // therefore no seed on any row. Unguarded, "the first row with no seed" is
  // row 1 and the rule lands above the league leader.
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({
      rows: standingsRows({ count: 12, seeded: false }),
    }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  expect(within(card).queryByTestId('standings-table-cut-line')).not.toBeInTheDocument();
  expect(cutRows()).toHaveLength(0);
});

test('standings-table: no cut line across a preseason table', async () => {
  primeLeague({ teamCount: 8, league: { draft_status: 'pending' } });
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({
      rows: preseasonRows(8),
      league: { playoff_teams: 4 },
    }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  // Every Team is 0-0-0: the order is a tiebreak artefact, so a bracket rule
  // across it would claim a standing nobody has yet.
  expect(cutRows()).toHaveLength(0);
});

// --- the island's row treatment (T3) ---------------------------------------

test('standings-table: the viewer row carries the accent tint and the accent bar', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  const viewerRules = allRules(youRow);
  expect(viewerRules).toMatch(/background-color:\s*var\(--dash-accent-soft\)/);
  expect(viewerRules).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--dash-accent\)/);

  // A non-viewer row is untinted and hovers to surface3, NOT to surface2 (the
  // tier that used to mark the viewer's own row, which would now be ambiguous).
  // eslint-disable-next-line testing-library/no-node-access -- walking from a cell to the row whose emitted rules are under test
  const otherRow = within(card).getByText('Squad 2').closest('tr');
  const otherRules = allRules(otherRow);
  expect(otherRules).not.toMatch(/background-color:\s*var\(--dash-accent-soft\)/);
  expect(otherRules).toMatch(/background-color:\s*var\(--dash-surface3\)/);
  expect(otherRules).not.toMatch(/var\(--dash-surface2\)/);
  expect(otherRules).toMatch(/transition:\s*background-color var\(--transition-fast\)/);
});

test('standings-table: the header cells stick to the top of the scroll wrapper', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  const head = within(card).getByText('Rank');
  const headRules = allRules(head);
  expect(headRules).toMatch(/position:\s*sticky/);
  // top: 0, not an app-bar offset: Nav is position="static".
  expect(headRules).toMatch(/top:\s*0/);
  expect(headRules).toMatch(/background-color:\s*var\(--dash-surface\)/);
  // The wrapper stops being a one-axis scroller (and therefore the scrollport
  // the header would stick to) at the widths where the table fits.
  const scrollRules = rulesUnder(within(card).getByTestId('standings-table-scroll'));
  expect(scrollRules[XS]).toMatch(/overflow-x:\s*auto/);
  expect(scrollRules[LG]).toMatch(/overflow-x:\s*visible/);
});

// --- the phone fold (T4) ---------------------------------------------------

test('standings-table: PF and PA fold into the Team cell below sm', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  // The column is gone at xs and back at sm...
  const pfRules = rulesUnder(within(card).getByText('PF'));
  expect(pfRules[XS]).toMatch(/display:\s*none/);
  expect(pfRules[SM]).toMatch(/display:\s*table-cell/);
  // ...and the same two totals ride in the Team cell instead, one line, one
  // middot, mirrored: exactly one of the two is on screen at any width, so
  // nothing is announced twice.
  const points = within(youRow).getByTestId('standings-table-points-line');
  expect(points).toHaveTextContent('1200.0 PF · 1000.0 PA');
  // eslint-disable-next-line testing-library/no-node-access -- proving the folded points line shares the team name cell means comparing the two th elements
  expect(points.closest('th')).toBe(within(youRow).getByText('Squad 1').closest('th'));
  const pointsRules = rulesUnder(points);
  expect(pointsRules[XS]).toMatch(/display:\s*block/);
  expect(pointsRules[SM]).toMatch(/display:\s*none/);
});

// --- the loading shape -----------------------------------------------------

test.each([4, 12])(
  'standings-table: the skeleton holds %i rows, one per Team in the league',
  async (teamCount) => {
    primeLeague({ teamCount });
    mockGetByUrl({
      '/api/scoring/league/1/standings': { pending: true },
    });
    renderTable();

    const card = await screen.findByTestId('standings-table');
    // The count is read off the membership, not the standings, so it is on
    // screen while the read that fills the rows is still in flight.
    await waitFor(() =>
      expect(within(card).getByTestId('standings-table-count')).toHaveTextContent(
        String(teamCount)
      )
    );
    // eslint-disable-next-line testing-library/no-node-access -- skeleton rows are aria-hidden placeholders, so they are counted as elements
    expect(card.querySelectorAll('tbody tr')).toHaveLength(teamCount);
  }
);
