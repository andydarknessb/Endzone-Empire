import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../../test-utils/renderWithProviders';
import apiClient from '../../../api/apiClient';
import { invalidate, setResource } from '../../../lib/resourceCache';
import MyTeamSummary from '../index';

/**
 * my-team-summary slice tests (T5). The page-level composition assertions (the
 * card's presence in the hero, the You badge, the grade/value placeholders)
 * stay in LeagueDashboardPage.test.jsx; what lives here is what only this slice
 * can answer: how many tiles the row is built to hold, which facts each tile
 * states from a given payload, and how the card names itself.
 *
 * Every read the widget owns goes through the shared apiClient (useLeague and
 * useStandings via useResource, draft-grades and power-rankings via
 * useEndpoint), so the whole client is mocked and answered by the URL-keyed
 * dispatcher below, the same seam the page test uses.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  // The league and standings reads are shared cached resources (ADR 0004) and
  // are module state that outlives a test, so they are cleared whole.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

// The base league carries NO waiver or roster-size columns, so the fourth tile
// is absent unless a test opts into them. That is what makes the two-tile case
// below a two-tile case.
const leagueDetail = ({ league = {}, teams, viewerTeamId = 1 } = {}) => ({
  viewerTeamId,
  league: { id: 1, name: 'MinneApple', current_week: 3, ...league },
  teams: teams ?? [
    { teamId: 1, id: 1, teamName: 'MyBallsHurts' },
    { teamId: 2, id: 2, teamName: 'Terrific T' },
  ],
});

const standingsResponse = () => ({
  data: {
    standings: [
      { teamId: 1, name: 'MyBallsHurts', wins: 3, losses: 1, ties: 0, rank: 2 },
      { teamId: 2, name: 'Terrific T', wins: 1, losses: 3, ties: 0, rank: 8 },
    ],
  },
});

const draftGradesResponse = () => ({
  data: { grades: [{ teamId: 1, grade: 'C', rosterValue: 1284, rank: 5 }] },
});

// The stored Monte Carlo run in the shape getLatestPowerRankings returns it (a
// `data.rankings` nested under the analytics row). `change` is prevRank - rank
// and `playoffOdds` a 0-1 fraction, both per montecarlo.service.js.
const powerRankingsResponse = (viewerRow = {}) => ({
  data: {
    season: 2026,
    week: 3,
    viewerTeamId: 1,
    data: {
      rankings: [
        { teamId: 1, name: 'MyBallsHurts', rank: 6, ...viewerRow },
        { teamId: 2, name: 'Terrific T', rank: 1 },
      ],
    },
  },
});

/**
 * URL-keyed apiClient.get mock, mirroring LeagueDashboardPage.test.jsx: a URL
 * maps to a resolved value, a `{ reject }` marker, or a `{ pending: true }`
 * marker for a request that never settles. Unmatched URLs answer empty.
 */
const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) {
        if (value && value.reject) return Promise.reject(value.reject);
        if (value && value.pending) return new Promise(() => {});
        return Promise.resolve(value);
      }
    }
    return Promise.resolve({ data: [] });
  });
};

/**
 * Mount the widget the way the route mounts it. The page gates its whole body
 * on the league having landed (LeagueDashboardPage: `!league && loading`), so
 * in production this widget always mounts with `current_week` already known and
 * keys its standings read once (useStandings' docblock records that
 * precondition). Priming the shared league cache reproduces that. Mounting cold
 * instead re-keys the standings read the moment the league lands, which flicks
 * the card back through its skeleton state mid-assertion - a harness artifact,
 * not a state the route can reach.
 */
const mountWith = ({ league, teams, viewerTeamId, ...reads } = {}) => {
  setResource(['league', 1], leagueDetail({ league, teams, viewerTeamId }));
  mockGetByUrl({
    '/api/scoring/league/1/standings': standingsResponse(),
    '/api/league/1/draft-grades': draftGradesResponse(),
    '/api/scoring/league/1/power-rankings': powerRankingsResponse(),
    ...reads,
  });
  return renderWithProviders(<MyTeamSummary leagueId={1} />);
};

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class.
// This gathers the declarations of every rule whose selector starts with that
// class, keyed by the selector's tail ('' for the element's own), exactly as
// GameCenterPage.test.jsx does.
const rulesUnder = (el) => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const found = {};
  Array.from(document.styleSheets).forEach((sheet) => {
    Array.from(sheet.cssRules).forEach((rule) => {
      if (!rule.selectorText || !rule.selectorText.startsWith(`.${cls}`)) return;
      const tail = rule.selectorText.slice(`.${cls}`.length).replace(/\s+/g, '');
      found[tail] = `${found[tail] || ''}${rule.style.cssText};`;
    });
  });
  return found;
};

const tileRow = () => rulesUnder(screen.getByTestId('my-team-tiles'))[''];

// --- the tile track --------------------------------------------------------

test('two tiles fill the row when power rankings 404', async () => {
  mountWith({
    '/api/scoring/league/1/power-rankings': { reject: { response: { status: 404 } } },
  });

  // The grade letter proves the draft-grades read has settled; the 404 was
  // issued in the same tick, so it has settled too.
  const grade = await screen.findByTestId('stat-draft-grade');
  expect(grade).toHaveTextContent('C');
  // A league with no stored run and no waiver/roster columns renders exactly
  // the two tiles that depend on no second read.
  expect(screen.getByTestId('stat-roster-value')).toBeInTheDocument();
  expect(screen.queryByTestId('stat-proj-finish')).not.toBeInTheDocument();
  expect(screen.queryByTestId('stat-playoff-odds')).not.toBeInTheDocument();
  expect(screen.queryByTestId('stat-capacity')).not.toBeInTheDocument();

  // One equal column per RENDERED child, so those two fill the card instead of
  // leaving a third track empty. Red-tell: put `repeat(3, 1fr)` back and these
  // are the assertions that go red.
  const row = tileRow();
  expect(row).toMatch(/grid-auto-flow:\s*column/);
  expect(row).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
  expect(row).not.toMatch(/repeat\(3/);
});

test('the loading row lays its skeletons on the same auto-flow track', async () => {
  // The standings spine is the card's loading state, and its three skeletons
  // are why a conditional track count cannot work: the count would change under
  // the reader as each read lands.
  mountWith({ '/api/scoring/league/1/standings': { pending: true } });

  await screen.findByTestId('my-team-summary');
  expect(screen.getAllByTestId('my-team-skeleton').length).toBeGreaterThan(0);
  const row = tileRow();
  expect(row).toMatch(/grid-auto-flow:\s*column/);
  expect(row).not.toMatch(/repeat\(3/);
});

test('a full payload renders five tiles in one row', async () => {
  mountWith({
    league: { waiver_type: 'faab', faab_budget: 100 },
    teams: [{ teamId: 1, id: 1, teamName: 'MyBallsHurts', faab_remaining: 24 }],
    '/api/scoring/league/1/power-rankings': powerRankingsResponse({ playoffOdds: 0.42, change: 2 }),
  });

  await screen.findByTestId('stat-playoff-odds');
  for (const id of [
    'stat-draft-grade',
    'stat-proj-finish',
    'stat-playoff-odds',
    'stat-roster-value',
    'stat-capacity',
  ]) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
});

// --- the new facts ---------------------------------------------------------

test('playoff odds render the stored 0-1 fraction as a whole percentage', async () => {
  mountWith({
    '/api/scoring/league/1/power-rankings': powerRankingsResponse({ playoffOdds: 0.42 }),
  });

  expect(await screen.findByTestId('stat-playoff-odds')).toHaveTextContent('42%');
});

test.each([
  [2, '+2', 'up 2 places'],
  [-1, '-1', 'down 1 place'],
  [0, '0', 'held its place'],
])('a rank change of %p reads "%s" and announces "%s"', async (change, mark, spoken) => {
  mountWith({ '/api/scoring/league/1/power-rankings': powerRankingsResponse({ change }) });

  const tile = await screen.findByTestId('stat-proj-finish');
  const movement = within(tile).getByTestId('stat-proj-movement');
  expect(movement).toHaveTextContent(mark);
  // The visible mark is an unlabelled number, so the direction has to be
  // readable as words rather than inferred from the sign.
  expect(within(movement).getByText(spoken)).toBeInTheDocument();
});

test('a null rank change renders no movement at all, not a zero', async () => {
  // The first stored run of a season carries change: null. Number(null) is 0,
  // so a coercion here would tell every manager they held their place.
  mountWith({ '/api/scoring/league/1/power-rankings': powerRankingsResponse({ change: null }) });

  const tile = await screen.findByTestId('stat-proj-finish');
  expect(within(tile).queryByTestId('stat-proj-movement')).not.toBeInTheDocument();
  expect(tile).toHaveTextContent('6th');
  expect(tile.textContent).not.toMatch(/[+-]/);
  expect(within(tile).queryByText(/place/)).not.toBeInTheDocument();
});

test('a FAAB league states the budget left', async () => {
  mountWith({
    league: { waiver_type: 'faab', faab_budget: 100 },
    teams: [{ teamId: 1, id: 1, teamName: 'MyBallsHurts', faab_remaining: 24, roster_count: 9 }],
  });

  const tile = await screen.findByTestId('stat-capacity');
  expect(tile).toHaveTextContent('FAAB left');
  expect(tile).toHaveTextContent('24/100');
});

test('a waiver-priority league states roster fullness instead', async () => {
  mountWith({
    league: { waiver_type: 'priority', faab_budget: 100, roster_limit: 15 },
    teams: [{ teamId: 1, id: 1, teamName: 'MyBallsHurts', faab_remaining: 24, roster_count: 9 }],
  });

  const tile = await screen.findByTestId('stat-capacity');
  expect(tile).toHaveTextContent('Roster');
  expect(tile).toHaveTextContent('9/15');
});

test('no capacity tile when the league row is missing the half that sizes it', async () => {
  // roster_count with no roster_limit is "9 of nothing", which is not a fact.
  mountWith({ teams: [{ teamId: 1, id: 1, teamName: 'MyBallsHurts', roster_count: 9 }] });

  await screen.findByTestId('stat-roster-value');
  expect(screen.queryByTestId('stat-capacity')).not.toBeInTheDocument();
});

// --- naming the card -------------------------------------------------------

test('the card is a region named by the Team name, and that name is its heading', async () => {
  mountWith();

  const card = await screen.findByTestId('my-team-summary');
  // The widget's own aria-labelledby wins over Card's conditional one, so the
  // card is named without a header box rendering.
  expect(screen.getByRole('region', { name: 'MyBallsHurts' })).toBe(card);
  const heading = screen.getByRole('heading', { level: 2, name: 'MyBallsHurts' });
  expect(card).toContainElement(heading);
  // Exactly one heading: Card rendered no title of its own.
  expect(within(card).getAllByRole('heading')).toHaveLength(1);
});

test('the Team name box breaks inside itself rather than over its neighbour', async () => {
  mountWith();

  const heading = await screen.findByRole('heading', { level: 2, name: 'MyBallsHurts' });
  // The zero minimum on the identity column is only safe because the box of
  // words on it is told to break (#916/#917/#919/#921).
  expect(rulesUnder(heading)['']).toMatch(/overflow-wrap:\s*anywhere/);
});

// --- Starters section (#1101) ----------------------------------------------
//
// Fixture fidelity (the #1097/#1101 ruling): every fixture below is shaped
// exactly as GET /api/team/lineup delivers a row (server/services/
// lineup.service.js getLineup), mirroring lineupModel.test.js's own `row()`
// helper - never a hand-built object invented to suit an assertion.

const lineupRow = (overrides = {}) => ({
  id: 1,
  name: 'Player',
  position: 'WR',
  nfl_team: 'BUF',
  slot: 'WR',
  projected_points: 10,
  injury_status: null,
  opponent: 'KC',
  bye_week: null,
  locked: false,
  onBye: false,
  valid_stash: false,
  ...overrides,
});

const lineupResponse = (entries = []) => ({
  data: { week: 3, season: 2026, teamId: 1, entries },
});

// The standard 9-instance starting shape (mirrors LeagueDashboardPage.test.jsx's
// quickActionsStandardSlots and the server's DEFAULT_ROSTER_SLOTS).
const NINE_SLOT_LEAGUE = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
  { key: 'TE', count: 1 },
  { key: 'FLEX', count: 1 },
  { key: 'K', count: 1 },
  { key: 'DEF', count: 1 },
];

// Nine real starters: five shown, four more, exactly one of the four
// questionable (WR Three). Bench and IR rows ride alongside them in `entries`
// exactly as the wire always sends them (Roster: starters, bench and IR
// together) - proving the section reads `lineup.starters`, never a
// bench/IR-inflated re-derivation from `lineup.entries` (#1101's red-tell: a
// wrong count here, not a sixth visible row, is what a re-derived filter
// would produce, since starters.length feeds both the note and the footer).
const nineStarters = () => [
  lineupRow({ id: 1, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', slot: 'QB', projected_points: 24.3, opponent: 'KC' }),
  lineupRow({ id: 2, name: 'RB One', position: 'RB', nfl_team: 'SF', slot: 'RB', projected_points: 18.2, opponent: 'LAR' }),
  lineupRow({ id: 3, name: 'RB Two', position: 'RB', nfl_team: 'DAL', slot: 'RB', projected_points: 15.5, opponent: 'NYG' }),
  lineupRow({ id: 4, name: 'WR One', position: 'WR', nfl_team: 'MIA', slot: 'WR', projected_points: 14.1, opponent: 'NYJ' }),
  lineupRow({ id: 5, name: 'WR Two', position: 'WR', nfl_team: 'CIN', slot: 'WR', projected_points: 13.0, opponent: 'BAL' }),
  lineupRow({ id: 6, name: 'WR Three', position: 'WR', nfl_team: 'SEA', slot: 'FLEX', projected_points: 11.4, opponent: 'ARI', injury_status: 'Q' }),
  lineupRow({ id: 7, name: 'TE One', position: 'TE', nfl_team: 'KC', slot: 'TE', projected_points: 9.8, opponent: 'BUF' }),
  lineupRow({ id: 8, name: 'DEF One', position: 'DEF', nfl_team: 'PHI', slot: 'DEF', projected_points: 8.0, opponent: 'DAL' }),
  lineupRow({ id: 9, name: 'K One', position: 'K', nfl_team: 'DET', slot: 'K', projected_points: 7.5, opponent: 'GB' }),
];

const benchAndIrRows = () => [
  lineupRow({ id: 100, name: 'Bench Guy', slot: 'BENCH', projected_points: 5, opponent: 'SEA' }),
  lineupRow({ id: 101, name: 'IR Guy', slot: 'IR', projected_points: 2, opponent: null }),
];

const LINEUP_URL = '/api/team/lineup?leagueId=1&week=3';

test('five starter rows render name, opponent line and projection from a nine-starter fixture, plus the "and N more" note', async () => {
  mountWith({ [LINEUP_URL]: lineupResponse([...nineStarters(), ...benchAndIrRows()]) });

  const rows = await screen.findAllByTestId('starter-row');
  expect(rows).toHaveLength(5);
  expect(within(rows[0]).getByText('Josh Allen')).toBeInTheDocument();
  expect(within(rows[0]).getByText('BUF vs KC')).toBeInTheDocument();
  expect(within(rows[0]).getByTestId('starter-projection')).toHaveTextContent('24.3');
  expect(within(rows[0]).getByTestId('pos-chip')).toHaveTextContent('QB');

  expect(screen.getByTestId('my-team-starters-more')).toHaveTextContent(
    'and 4 more starters · 1 questionable'
  );

  // Red-tell: bench and IR never leak into the section, whether as one of the
  // five visible rows or folded into the "more" count.
  expect(screen.queryByText('Bench Guy')).not.toBeInTheDocument();
  expect(screen.queryByText('IR Guy')).not.toBeInTheDocument();
});

test('"and 1 more starter" is singular, with zero questionable stated plainly', async () => {
  mountWith({ [LINEUP_URL]: lineupResponse(nineStarters().slice(0, 6).map((s) => ({ ...s, injury_status: null }))) });

  expect(await screen.findByTestId('my-team-starters-more')).toHaveTextContent(
    'and 1 more starter · 0 questionable'
  );
});

test('footer reads "Lineup set · 9 of 9" for a full nine-starter lineup against a nine-slot league', async () => {
  mountWith({
    league: { roster_slots: NINE_SLOT_LEAGUE },
    [LINEUP_URL]: lineupResponse(nineStarters()),
  });

  expect(await screen.findByTestId('my-team-lineup-status')).toHaveTextContent('Lineup set · 9 of 9');
});

test('footer reads "Lineup incomplete · 7 of 9" for a seven-starter fixture against a nine-slot league', async () => {
  mountWith({
    league: { roster_slots: NINE_SLOT_LEAGUE },
    [LINEUP_URL]: lineupResponse(nineStarters().slice(0, 7)),
  });

  expect(await screen.findByTestId('my-team-lineup-status')).toHaveTextContent('Lineup incomplete · 7 of 9');
});

// The 2026-09-10 ruling: null means absence (a bye or an unsynced slate),
// never "unknown", so the second line renders the team code alone with no
// invented label.
test('a null opponent renders the team code alone, with no "vs" clause', async () => {
  mountWith({
    [LINEUP_URL]: lineupResponse([
      lineupRow({ id: 1, name: 'Bye Guy', slot: 'QB', nfl_team: 'BUF', opponent: null, projected_points: 0 }),
    ]),
  });

  const row = await screen.findByTestId('starter-row');
  expect(within(row).getByTestId('starter-opponent-line')).toHaveTextContent('BUF');
  expect(within(row).queryByText(/vs/)).not.toBeInTheDocument();
});

test('a questionable starter carries a warning Badge reading the wire abbreviation', async () => {
  mountWith({
    [LINEUP_URL]: lineupResponse([lineupRow({ id: 1, name: 'Hurt Guy', slot: 'QB', injury_status: 'Q' })]),
  });

  const row = await screen.findByTestId('starter-row');
  const badge = within(row).getByTestId('starter-injury-badge');
  expect(badge).toHaveAttribute('data-variant', 'warning');
  expect(badge).toHaveTextContent('Q');
});

test('a healthy starter carries no injury Badge', async () => {
  mountWith({ [LINEUP_URL]: lineupResponse([lineupRow({ id: 1, injury_status: null })]) });

  const row = await screen.findByTestId('starter-row');
  expect(within(row).queryByTestId('starter-injury-badge')).not.toBeInTheDocument();
});

test('loading holds five skeleton rows', async () => {
  mountWith({ [LINEUP_URL]: { pending: true } });

  await screen.findByTestId('my-team-starters');
  expect(screen.getAllByTestId('my-team-starters-skeleton')).toHaveLength(5);
  expect(screen.queryByTestId('starter-row')).not.toBeInTheDocument();
});

test('a failed lineup read hides the starters section while the tiles still render', async () => {
  mountWith({ [LINEUP_URL]: { reject: { response: { status: 500 } } } });

  await screen.findByTestId('stat-draft-grade');
  expect(screen.queryByTestId('my-team-starters')).not.toBeInTheDocument();
});

test('a pick-em-only viewer never mounts the starters section, and the lineup is never fetched', async () => {
  mountWith({ league: { pickem_only: true } });

  await screen.findByTestId('my-team-summary');
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/team/lineup'));
  expect(screen.queryByTestId('my-team-starters')).not.toBeInTheDocument();
});

test('the Set Lineup control links to /league/42/lineup', async () => {
  setResource(['league', 42], leagueDetail({}));
  mockGetByUrl({
    '/api/scoring/league/42/standings': standingsResponse(),
    '/api/league/42/draft-grades': draftGradesResponse(),
    '/api/scoring/league/42/power-rankings': powerRankingsResponse(),
    '/api/team/lineup?leagueId=42&week=3': lineupResponse(nineStarters()),
  });
  renderWithProviders(<MyTeamSummary leagueId={42} />);

  const link = await screen.findByRole('link', { name: 'Set Lineup' });
  expect(link.getAttribute('href')).toBe('/league/42/lineup');
});
