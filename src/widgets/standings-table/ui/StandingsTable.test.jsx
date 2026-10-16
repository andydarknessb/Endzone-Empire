import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate, setResource } from '../../../lib/resourceCache';
import StandingsTable from '../index';
import { winPctLabel } from '../model/useStandingsTable';
import { teamStandingFromRow } from '../../../entities/standings';

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

/// --- density: streak, record ----------------------------------------------

test('standings-table: renders the streak the read already carries and no win percentage column', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  // The column exists, and the viewer's own row carries the server's trailing streak string. The
  // board's columns are rank, team, W-L-T, PF, PA and STRK: win percentage is not one of them.
  expect(within(card).getByText('STRK')).toBeInTheDocument();
  expect(within(card).queryByText('PCT')).not.toBeInTheDocument();
  expect(within(youRow).getByText('W3')).toBeInTheDocument();
  expect(within(youRow).getByText('1200.0')).toBeInTheDocument();
  expect(within(youRow).getByText('1000.0')).toBeInTheDocument();
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
  expect(within(card).getByTestId('standings-table-preseason-note')).toHaveTextContent(
    'Records, points and streaks populate after Week 1.'
  );
});

// --- the Record cell (#959) -------------------------------------------------

// The tie rule is not this widget's to state: src/entities/standings owns it and asserts every case
// (standingsModel.test.js). What is left here is the widget's own job: the entity's value reaches the DOM.
test("standings-table: the entity's record for a row reaches that row's cell", async () => {
  primeLeague();
  const rows = standingsRows({ count: 12 });
  rows[0] = { ...rows[0], wins: 8, losses: 2, ties: 2 };
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({ rows }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  // Not a literal: whatever the entity computes for this row is what the cell
  // must show, so the assertion cannot drift from the owner of the rule.
  expect(within(youRow).getByText(teamStandingFromRow(rows[0]).record)).toBeInTheDocument();
});

// --- the playoff line ------------------------------------------------------

test('standings-table: the playoff line sits between the last Team in the bracket and the first out', async () => {
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
  // Exactly once, labelled in words (never colour or a dash alone), directly under the last seeded Team.
  const marks = within(card).getAllByTestId('standings-table-cut-line');
  expect(marks).toHaveLength(1);
  expect(marks[0]).toHaveTextContent('Playoff line');
  // eslint-disable-next-line testing-library/no-node-access -- walking from the label up to its own row is the assertion
  const cutRow = marks[0].closest('tr');
  expect(cutRows()).toHaveLength(1);
  // eslint-disable-next-line testing-library/no-node-access -- the boundary is the row order: last in, line, first out
  expect(within(cutRow.previousElementSibling).getByText('Squad 6')).toBeInTheDocument();
  // eslint-disable-next-line testing-library/no-node-access -- see above
  expect(within(cutRow.nextElementSibling).getByText('Squad 7')).toBeInTheDocument();
});

test('standings-table: no playoff line in a league where every team makes the playoffs', async () => {
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
  // Nothing is out, so there is no boundary to draw or to announce.
  expect(within(card).queryByTestId('standings-table-cut-line')).not.toBeInTheDocument();
  expect(cutRows()).toHaveLength(0);
});

test('standings-table: no playoff line when the standings read states no bracket', async () => {
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

test('standings-table: no playoff line across a preseason table', async () => {
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

// --- the Play-select look ---------------------------------------------------

test('standings-table: the viewer row is Play blue with an arrow and a You tag, not a cursor', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  const youRow = await within(card).findByTestId('standings-table-you-row');
  expect(youRow).toHaveAttribute('aria-current', 'true');
  expect(within(youRow).getByText('You')).toBeInTheDocument();
  const cells = within(youRow).getAllByRole('cell');
  expect(allRules(cells[0])).toMatch(/background-color:\s*var\(--ps-play\)/);
  expect(allRules(cells[0])).toMatch(/color:\s*var\(--ps-play-ink\)/);
  // eslint-disable-next-line testing-library/no-node-access -- the arrow is a decorative svg before the name
  expect(youRow.querySelector('svg')).not.toBeNull();
  // The one cursor belongs to Your move: nothing in this table wears it.
  // eslint-disable-next-line testing-library/no-node-access -- the cursor is a class, not a role
  expect(card.querySelector('.cursor')).toBeNull();

  // A non-viewer row is a plain panel row on a 2px Rule divider, with no You tag.
  // eslint-disable-next-line testing-library/no-node-access -- walking from a cell to the row whose emitted rules are under test
  const otherRow = within(card).getByText('Squad 2').closest('tr');
  expect(otherRow).not.toHaveAttribute('aria-current');
  expect(within(otherRow).queryByText('You')).not.toBeInTheDocument();
  // A phone's Team column is fixed, so a long name ellipsizes: the full name is the name's title.
  expect(within(otherRow).getByTitle('Squad 2')).toHaveTextContent('Squad 2');
  expect(allRules(within(otherRow).getAllByRole('cell')[0])).toMatch(/border-bottom:\s*2px solid var\(--ps-rule\)/);
});

test('standings-table: the first two columns stay in view and the table scrolls inside its box', async () => {
  primeLeague();
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  const head = within(card).getByRole('columnheader', { name: 'Rank' });
  expect(allRules(head)).toMatch(/position:\s*sticky/);
  expect(allRules(head)).toMatch(/left:\s*0/);
  expect(allRules(within(card).getByTestId('standings-table-scroll'))).toMatch(/overflow-x:\s*auto/);
  // The scroll box is a named, focusable region, so a keyboard user can scroll it.
  expect(within(card).getByRole('region', { name: 'Standings, 12 teams' })).toHaveAttribute('tabindex', '0');
});

test('standings-table: the Rank head reads # below sm and keeps Rank as its name', async () => {
  primeLeague();
  mockGetByUrl({ '/api/scoring/league/1/standings': standingsResponse() });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 1');
  // The accessible name is Rank at every width; only the painted glyph changes.
  const head = within(card).getByRole('columnheader', { name: 'Rank' });
  const word = within(head).getByText('Rank');
  const glyph = within(head).getByText('#');
  expect(rulesUnder(word)[XS]).toMatch(/display:\s*none/);
  expect(rulesUnder(word)[SM]).toMatch(/display:\s*inline/);
  expect(rulesUnder(glyph)[XS]).toMatch(/display:\s*inline/);
  expect(rulesUnder(glyph)[SM]).toMatch(/display:\s*none/);
});

// --- the phone fold ---------------------------------------------------------

// MUI's useMediaQuery reads window.matchMedia; this answers down('sm') true for a phone.
const asPhone = () => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
};

describe('on a phone', () => {
  beforeEach(asPhone);
  afterEach(() => {
    delete window.matchMedia;
  });

  test('standings-table: the table folds to the viewer row, two teams either side and the playoff line', async () => {
    primeLeague();
    // The viewer (team 1) leads, so the window is rows 1-3 and then runs down to the cut after 6.
    mockGetByUrl({
      '/api/scoring/league/1/standings': standingsResponse({
        rows: standingsRows({ count: 12, playoffTeams: 6 }),
        league: { playoff_teams: 6 },
      }),
    });
    renderTable();

    const card = await screen.findByTestId('standings-table');
    await within(card).findByText('Squad 1');
    expect(within(card).getByText('Squad 3')).toBeInTheDocument();
    expect(within(card).getByText('Squad 6')).toBeInTheDocument();
    expect(within(card).queryByText('Squad 7')).not.toBeInTheDocument();
    expect(within(card).getByTestId('standings-table-cut-line')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Full standings, all 12 teams' })).toBeInTheDocument();
  });

  test('standings-table: a viewer mid-table gets two teams above and below, and Full standings opens the rest', async () => {
    primeLeague();
    setResource(['league', 1], { ...leagueResponse().data, viewerTeamId: 8 });
    mockGetByUrl({
      '/api/scoring/league/1/standings': standingsResponse({
        rows: standingsRows({ count: 12, playoffTeams: 6 }),
        league: { playoff_teams: 6 },
      }),
    });
    renderTable();

    const card = await screen.findByTestId('standings-table');
    await within(card).findByText('Squad 8');
    ['Squad 6', 'Squad 7', 'Squad 8', 'Squad 9', 'Squad 10'].forEach((name) => {
      expect(within(card).getByText(name)).toBeInTheDocument();
    });
    expect(within(card).queryByText('Squad 5')).not.toBeInTheDocument();
    expect(within(card).queryByText('Squad 11')).not.toBeInTheDocument();
    expect(within(card).getByTestId('standings-table-you-row')).toHaveTextContent('Squad 8');

    await userEvent.click(within(card).getByRole('link', { name: 'Full standings, all 12 teams' }));
    expect(within(card).getByText('Squad 1')).toBeInTheDocument();
    expect(within(card).getByText('Squad 12')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Show fewer teams' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('standings-table: a short league has nothing to fold', async () => {
    primeLeague({ teamCount: 4 });
    mockGetByUrl({ '/api/scoring/league/1/standings': standingsResponse({ rows: standingsRows({ count: 4 }) }) });
    renderTable();

    const card = await screen.findByTestId('standings-table');
    await within(card).findByText('Squad 4');
    expect(within(card).queryByRole('link', { name: /Full standings/ })).not.toBeInTheDocument();
  });
});

test('standings-table: a failed read is one danger panel that re-fires the read', async () => {
  primeLeague();
  mockGetByUrl({ '/api/scoring/league/1/standings': { reject: new Error('boom') } });
  renderTable();

  expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the standings right now.');
  const reads = () => apiClient.get.mock.calls.filter(([url]) => String(url).startsWith('/api/scoring/league/1/standings')).length;
  const before = reads();
  await userEvent.click(screen.getByRole('button', { name: 'Try loading the standings again' }));
  await waitFor(() => expect(reads()).toBeGreaterThan(before));
});

test.each([null, undefined, ''])('winPctLabel(%p) is null so the cell shows the placeholder', (value) => {
  expect(winPctLabel(value)).toBeNull();
});

test('winPctLabel keeps real fractions, including a true 0', () => {
  expect(winPctLabel(0.875)).toBe('.875');
  expect(winPctLabel('0.5')).toBe('.500');
  expect(winPctLabel(0)).toBe('.000');
  expect(winPctLabel(1)).toBe('1.000');
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
    expect(card).toHaveAttribute('aria-busy', 'true');
    // eslint-disable-next-line testing-library/no-node-access -- skeleton rows are aria-hidden placeholders, so they are counted as elements
    expect(card.querySelectorAll('tbody tr')).toHaveLength(teamCount);
  }
);

test('standings-table: a CPU-managed team (teams[].is_cpu) carries the CPU label, and only it', async () => {
  const data = leagueResponse({ teamCount: 4 }).data;
  data.teams[2] = { ...data.teams[2], is_cpu: true };
  setResource(['league', 1], data);
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse({ rows: standingsRows({ count: 4 }) }),
  });
  renderTable();

  const card = await screen.findByTestId('standings-table');
  await within(card).findByText('Squad 3');
  const badges = within(card).getAllByTestId('cpu-badge');
  expect(badges).toHaveLength(1);
  expect(within(screen.getByRole('rowheader', { name: /Squad 3/ })).getByText('CPU')).toBeInTheDocument();
});
