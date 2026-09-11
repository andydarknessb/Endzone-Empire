import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import LeagueHistoryPage from './LeagueHistoryPage';
import { teamStandingFromRow } from '../../entities/standings';
import { publishTeamProfileUpdate } from '../../lib/teamProfileEvents';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// Wraps the REAL implementation so every test's Record output is the genuine
// standings-entity rule unless a test explicitly overrides it once (the
// binding red-tell below) - the body's 3-1-2 / 3-1 cases stay unmocked.
// react-scripts' Jest preset sets `resetMocks: true`, which strips a mock
// function's implementation before every test - including one supplied to
// `jest.fn(impl)` at module-mock-factory time - so the real implementation is
// reinstated in `beforeEach` (which runs AFTER that reset) rather than once,
// up front, in the factory.
jest.mock('../../entities/standings', () => {
  const actual = jest.requireActual('../../entities/standings');
  return { __esModule: true, ...actual, teamStandingFromRow: jest.fn() };
});

beforeEach(() => {
  const actual = jest.requireActual('../../entities/standings');
  teamStandingFromRow.mockImplementation(actual.teamStandingFromRow);
});

afterEach(() => {
  jest.clearAllMocks();
});

const renderHistory = (leagueId = 1) =>
  renderWithProviders(<LeagueHistoryPage />, {
    path: '/league/:leagueId/history',
    route: `/league/${leagueId}/history`,
  });

const openAllTimeTab = () => fireEvent.click(screen.getByRole('radio', { name: 'All-Time' }));

// jsdom lays nothing out, but emotion inserts every sx rule into
// `document.styleSheets` under the element's generated class, so a declared
// size can be read back. Same helper the legacy LeagueHistory.test.jsx used.
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

// seasonArchive() (server/services/seasonArchive.service.js) decides
// champions and outcome server-side for both League types: `champions` is
// always an array of canonical { teamId, name, avatarUrl, avatarStaticUrl }
// entries (empty when there is none), and a fantasy season's outcome is the
// explicit 'champion' | 'no_champion' this fixture exercises.
const historyResponse = () => ({
  data: {
    seasons: [
      {
        season: 2026,
        outcome: 'champion',
        champions: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null }],
        standings: [
          { teamId: 1, name: 'Sunday Ballers', rank: 1, wins: 12, losses: 2, pf: 1502.4 },
        ],
        trophies: [
          { id: 1, type: 'champion', label: 'League Champion', team_name: 'Sunday Ballers' },
        ],
        draftGrades: [
          { teamId: 1, name: 'Sunday Ballers', grade: 'A', rosterValue: 250.1, rank: 1 },
        ],
      },
      {
        season: 2025,
        outcome: 'no_champion',
        champions: [],
        standings: [
          { teamId: 2, name: "Bob's Team", rank: 1, wins: 10, losses: 4, pf: 1400.0 },
        ],
        trophies: [],
        draftGrades: null,
      },
    ],
    allTime: [],
  },
});

test('announces the loading region to assistive tech while the history read is in flight', async () => {
  let resolveGet;
  apiClient.get.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));

  renderHistory();

  expect(screen.getByTestId('page-skeleton')).toHaveAttribute('aria-busy', 'true');
  resolveGet(historyResponse());
  await screen.findByText('Season 2026');
});

test('renders past seasons with champion, standings, trophies, and draft grades', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  expect(await screen.findByText('Season 2026')).toBeInTheDocument();
  expect(screen.getByTestId('champion-2026')).toHaveTextContent('Sunday Ballers');
  expect(screen.getByText('Season 2025')).toBeInTheDocument();
  expect(screen.getByText('No champion')).toBeInTheDocument();
  expect(screen.getAllByText('Sunday Ballers').length).toBeGreaterThan(0);
  expect(screen.getByText("Bob's Team")).toBeInTheDocument();
});

test("caps the season's section headings at h3 under the season's own h2", async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  expect(within(panel).getByRole('heading', { level: 2, name: 'Season 2026' })).toBeInTheDocument();
  expect(within(panel).getByRole('heading', { level: 3, name: 'Final Standings' })).toBeInTheDocument();
  expect(within(panel).getByRole('heading', { level: 3, name: 'Trophies' })).toBeInTheDocument();
  expect(within(panel).getByRole('heading', { level: 3, name: 'Draft Grades' })).toBeInTheDocument();
  // No sub-section heading escapes to the season's own level.
  expect(within(panel).getAllByRole('heading', { level: 2 })).toHaveLength(1);
});

test('paints the trophy glyphs from the shared trophy icon, not emoji', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  expect(within(panel).getByText('League Champion · Sunday Ballers')).toBeInTheDocument();
  // The champion banner and the trophy chip both carry the cup.
  // eslint-disable-next-line testing-library/no-node-access -- the glyphs are aria-hidden by design, so no Testing Library query can reach them
  expect(panel.querySelectorAll('svg[data-icon="trophy"]')).toHaveLength(2);
  expect(panel.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
});

test('renders a champion banner with team name and record inside the expanded panel', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  const banner = await screen.findByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('Season Champion');
  expect(banner).toHaveTextContent('Sunday Ballers');
  expect(banner).toHaveTextContent('12-2 record');

  expect(screen.queryByTestId('champion-banner-2025')).not.toBeInTheDocument();
});

test('shows medal indicators for podium ranks in Final Standings', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          outcome: 'champion',
          champions: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null }],
          standings: [
            { teamId: 1, name: 'Sunday Ballers', rank: 1, wins: 12, losses: 2, pf: 1502.4 },
            { teamId: 2, name: 'Runner Up', rank: 2, wins: 10, losses: 4, pf: 1400.0 },
            { teamId: 3, name: 'Third Place', rank: 3, wins: 9, losses: 5, pf: 1350.0 },
            { teamId: 4, name: 'Also Ran', rank: 4, wins: 5, losses: 9, pf: 1200.0 },
          ],
          trophies: [],
          draftGrades: null,
        },
      ],
      allTime: [],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  // eslint-disable-next-line testing-library/no-node-access -- the medals are aria-hidden by design, so no Testing Library query can reach them
  const medals = panel.querySelectorAll('svg[data-medal]');
  expect(Array.from(medals).map((el) => el.getAttribute('data-medal'))).toEqual(['1', '2', '3']);
  medals.forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
  medals.forEach((el) => {
    const rule = rulesUnder(el)[''] || '';
    expect(rule).toMatch(/width:\s*16px/);
    expect(rule).toMatch(/height:\s*16px/);
  });
  expect(panel.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('4')).toBeInTheDocument();
});

// #1246: the legacy LeagueHistory component (replaced by this page at
// #1213) wrapped the PF header in AbbreviationTooltip, exposing the PF
// definition to keyboard and screen-reader users. The island page lost that
// when it shipped, since AbbreviationTooltip hadn't yet earned a shared/ui
// home (ADR 0031's #1146 amendment) - this issue is its second island
// consumer, closing that edge.
test('exposes the Final Standings PF header with its shared definition, focusable for keyboard users', async () => {
  apiClient.get.mockResolvedValue(historyResponse());

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const pfHeader = within(panel).getByLabelText('PF: Points for: total fantasy points scored by this team.');
  expect(pfHeader.tabIndex).toBe(0);
});

test('the Team cell is the row header in Final Standings, Draft Grades, and All-Time, so a cell reads with its Team', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [historyResponse().data.seasons[0]],
      allTime: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, championships: 1, wins: 12, losses: 2, ties: 0 }],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const standingsTable = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(standingsTable).getByRole('rowheader', { name: 'Sunday Ballers' })).toBeInTheDocument();

  openAllTimeTab();
  const allTimeTable = await screen.findByRole('table', { name: 'All-Time Records' });
  expect(within(allTimeTable).getByRole('rowheader', { name: 'Sunday Ballers' })).toBeInTheDocument();
});

test('renders an inline note when trophies failed to load for a season', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          champion: null,
          standings: [],
          trophies: [],
          trophiesErrored: true,
          draftGrades: null,
        },
      ],
      allTime: [],
    },
  });

  renderHistory();

  expect(await screen.findByText("Couldn't load trophies for this season")).toBeInTheDocument();
});

test('renders an inline note when draft grades failed to load for a season', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          champion: null,
          standings: [],
          trophies: [],
          draftGrades: null,
          draftGradesErrored: true,
        },
      ],
      allTime: [],
    },
  });

  renderHistory();

  expect(await screen.findByText("Couldn't load draft grades for this season")).toBeInTheDocument();
});

test('shows a thematic empty state when there are no completed seasons', async () => {
  apiClient.get.mockResolvedValue({ data: { seasons: [], allTime: [] } });

  renderHistory();

  const empty = await screen.findByTestId('history-empty');
  expect(empty).toHaveTextContent('The Hall of Fame is empty.');
  expect(empty).toHaveTextContent('Complete your first season to cement your legacy.');
  expect(screen.queryByTestId('league-history-tabs')).not.toBeInTheDocument();
});

test('shows an error alert when the history fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'history unavailable' } } });

  renderHistory();

  expect(await screen.findByText('history unavailable')).toBeInTheDocument();
});

test("a pick'em season's standings render points and correct picks instead of a W-L record", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          outcome: 'champions',
          champions: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null }],
          standings: [
            { teamId: 1, name: 'Sunday Ballers', rank: 1, points: 171, correct: 120, incorrect: 5, pushes: 2, pending: 0, made: 125, weekly: {} },
            { teamId: 2, name: "Bob's Team", rank: 2, points: 160, correct: 115, incorrect: 8, pushes: 2, pending: 0, made: 123, weekly: {} },
          ],
          trophies: [
            { id: 1, type: 'pickem_champion', label: "2026 Pick'em Champion", team_name: 'Sunday Ballers' },
          ],
          draftGrades: null,
        },
      ],
      allTime: [],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('Points')).toBeInTheDocument();
  expect(within(table).getByText('Correct')).toBeInTheDocument();
  expect(within(table).queryByText('Record')).not.toBeInTheDocument();
  expect(within(table).getByText('171')).toBeInTheDocument();
  expect(within(table).getByText('160')).toBeInTheDocument();
  expect(within(table).getByText('120')).toBeInTheDocument();
  expect(panel).not.toHaveTextContent('undefined');

  const banner = within(panel).getByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('171 points');
  expect(banner).not.toHaveTextContent('record');
});

test("a stripped pick'em standings renders by Team name, and a gone-Team row as Former manager", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'champions',
        champions: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null }],
        standings: [
          { teamId: 1, name: 'Sunday Ballers', rank: 1, points: 171, correct: 120, incorrect: 5, pushes: 2, pending: 0, made: 125, weekly: {} },
          { teamId: null, name: null, rank: 2, points: 160, correct: 115, incorrect: 8, pushes: 2, pending: 0, made: 123, weekly: {} },
        ],
        trophies: [],
        draftGrades: null,
      }],
      allTime: [],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('Sunday Ballers')).toBeInTheDocument();
  expect(within(table).getByText('Former manager')).toBeInTheDocument();
  expect(within(table).getByText('171')).toBeInTheDocument();
  expect(within(table).getByText('160')).toBeInTheDocument();
  expect(table).not.toHaveTextContent('undefined');
  expect(table).not.toHaveTextContent('null');
});

test("a Pick'em history panel displays every archived co-champion instead of the singular compatibility field", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'champions',
        champions: [
          { teamId: 10, name: 'Archived Aces', avatarUrl: null, avatarStaticUrl: null },
          { teamId: 99, name: 'Departed Champs', avatarUrl: null, avatarStaticUrl: null },
        ],
        champion: { teamId: 777, name: 'Deprecated Wrong Winner' },
        standings: [
          { teamId: 11, name: 'Drifted Leader', rank: 1, points: 180, correct: 121, pushes: 0 },
          { teamId: 10, name: 'Archived Aces', rank: 2, points: 171, correct: 120, pushes: 0 },
        ],
        trophies: [],
        draftGrades: null,
      }],
      allTime: [],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const banner = within(panel).getByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('Co-Champions');
  expect(banner).toHaveTextContent('Archived Aces');
  expect(banner).toHaveTextContent('Departed Champs');
  expect(banner).toHaveTextContent('171 points');
  expect(panel).not.toHaveTextContent('Deprecated Wrong Winner');

  act(() => publishTeamProfileUpdate({ leagueId: 1, teamId: 10, name: 'Anonymized Current Team' }));
  expect(panel).not.toHaveTextContent('Anonymized Current Team');
  expect(panel).toHaveTextContent('Archived Aces');
});

test("a declared Pick'em no-champion season is explicit rather than reported as missing", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'no_champion',
        champions: [],
        champion: null,
        standings: [],
        trophies: [],
        draftGrades: null,
      }],
      allTime: [],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  expect(panel).toHaveTextContent('No champion');
  expect(panel).not.toHaveTextContent('No champion recorded');
  expect(within(panel).queryByTestId('champion-banner-2026')).not.toBeInTheDocument();
});

test("a live profile update never rewrites a declared Pick'em no-champion season's standings, but still patches a fantasy season's", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [
        {
          season: 2026,
          outcome: 'no_champion',
          champions: [],
          standings: [
            { teamId: 10, name: 'Archived Aces', rank: 1, points: 171, correct: 120, incorrect: 5, pushes: 2, pending: 0, made: 125, weekly: {} },
          ],
          trophies: [],
          draftGrades: null,
        },
        {
          season: 2025,
          outcome: 'no_champion',
          champions: [],
          standings: [
            { teamId: 20, name: 'Fantasy Runner', rank: 1, wins: 5, losses: 5, ties: 0, pf: 1000, pa: 1000 },
          ],
          trophies: [],
          draftGrades: null,
        },
      ],
      allTime: [],
    },
  });

  renderHistory();

  const pickemPanel = await screen.findByTestId('season-panel-2026');
  const fantasyPanel = await screen.findByTestId('season-panel-2025');
  expect(within(pickemPanel).getByText('Archived Aces')).toBeInTheDocument();
  expect(within(fantasyPanel).getByText('Fantasy Runner')).toBeInTheDocument();

  act(() => publishTeamProfileUpdate({ leagueId: 1, teamId: 10, name: 'Anonymized Pickem Team' }));
  act(() => publishTeamProfileUpdate({ leagueId: 1, teamId: 20, name: 'Anonymized Fantasy Team' }));

  expect(within(pickemPanel).getByText('Archived Aces')).toBeInTheDocument();
  expect(within(pickemPanel).queryByText('Anonymized Pickem Team')).not.toBeInTheDocument();
  expect(within(fantasyPanel).getByText('Anonymized Fantasy Team')).toBeInTheDocument();
  expect(within(fantasyPanel).queryByText('Fantasy Runner')).not.toBeInTheDocument();
});

test("a declared Pick'em champions season with no archived standings still renders the Points/Correct headers", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'champions',
        champions: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null }],
        standings: [],
        trophies: [],
        draftGrades: null,
      }],
      allTime: [],
    },
  });

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('Points')).toBeInTheDocument();
  expect(within(table).getByText('Correct')).toBeInTheDocument();
  expect(within(table).queryByText('Record')).not.toBeInTheDocument();
});

// Issue #1009 (ported from LeagueHistory.test.jsx): pins the Record rule in
// both directions - a tied Team and a tie-less one - rather than just the
// tie case, which a formatter that always printed three parts would satisfy
// while regressing every tie-less season to 12-2-0. Real teamStandingFromRow,
// unmocked (the red-tell binding test below is the only mocked case).
const seasonWithTies = (ties) => ({
  data: {
    seasons: [
      {
        season: 2026,
        outcome: 'champion',
        champions: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null }],
        standings: [
          { teamId: 1, name: 'Sunday Ballers', rank: 1, wins: 8, losses: 4, ties, pf: 1502.4 },
        ],
        trophies: [],
        draftGrades: null,
      },
    ],
    allTime: [],
  },
});

test('a Team that has tied shows the three-part record in the champion line and the standings cell', async () => {
  apiClient.get.mockResolvedValue(seasonWithTies(2));

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  expect(within(panel).getByTestId('champion-banner-2026')).toHaveTextContent('8-4-2 record');
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('8-4-2')).toBeInTheDocument();
  expect(within(table).getByText('Record')).toBeInTheDocument();
});

test('a tie-less Team shows the two-part record in the champion line and the standings cell', async () => {
  apiClient.get.mockResolvedValue(seasonWithTies(0));

  renderHistory();

  const panel = await screen.findByTestId('season-panel-2026');
  const banner = within(panel).getByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('8-4 record');
  expect(banner).not.toHaveTextContent('8-4-0');
  const table = within(panel).getByRole('table', { name: 'Final Standings' });
  expect(within(table).getByText('8-4')).toBeInTheDocument();
  expect(within(table).queryByText('8-4-0')).not.toBeInTheDocument();
});

// --- All-Time tab (#1212 / this ticket) ---

test("binds the All-Time Record to the standings entity's teamStandingFromRow, not a local formatter", async () => {
  teamStandingFromRow.mockReturnValueOnce({ record: 'REC-SENTINEL' });
  apiClient.get.mockResolvedValue({
    data: {
      // A pick'em-shaped season, so nothing here calls teamStandingFromRow
      // before the All-Time tab does - the mocked-once return is spent on
      // exactly the call this test is pinning.
      seasons: [{ season: 2026, outcome: 'no_champion', champions: [], standings: [{ teamId: 1, points: 10 }], trophies: [], draftGrades: null }],
      allTime: [{ teamId: 1, name: 'Sunday Ballers', avatarUrl: null, championships: 1, wins: 12, losses: 2, ties: 0 }],
    },
  });

  renderHistory();
  await screen.findByText('Season 2026');
  openAllTimeTab();

  expect(await screen.findByText('REC-SENTINEL')).toBeInTheDocument();
});

test("a pick'em-only League's All-Time tab renders no Record column and no wins-losses text", async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{ season: 2026, outcome: 'no_champion', champions: [], standings: [{ teamId: 1, points: 10 }], trophies: [], draftGrades: null }],
      allTime: [
        { teamId: 1, name: 'Sunday Ballers', avatarUrl: null, championships: 0, wins: null, losses: null, ties: null },
        { teamId: 2, name: "Bob's Team", avatarUrl: null, championships: 1, wins: null, losses: null, ties: null },
      ],
    },
  });

  renderHistory();
  await screen.findByText('Season 2026');
  openAllTimeTab();

  const table = await screen.findByRole('table', { name: 'All-Time Records' });
  expect(within(table).queryByText('Record')).not.toBeInTheDocument();
  expect(table.textContent).not.toMatch(/\d+-\d+/);
});

test('a mixed All-Time roster shows a Record for a fantasy Team and an empty cell for a pick\'em Team', async () => {
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{ season: 2026, outcome: 'champion', champions: [], standings: [{ teamId: 1, wins: 8, losses: 4, ties: 0 }], trophies: [], draftGrades: null }],
      allTime: [
        { teamId: 1, name: 'Fantasy Team', avatarUrl: null, championships: 1, wins: 20, losses: 10, ties: 1 },
        { teamId: 2, name: 'Pickem Team', avatarUrl: null, championships: 0, wins: null, losses: null, ties: null },
      ],
    },
  });

  renderHistory();
  await screen.findByText('Season 2026');
  openAllTimeTab();

  const table = await screen.findByRole('table', { name: 'All-Time Records' });
  expect(within(table).getByText('20-10-1')).toBeInTheDocument();
  // eslint-disable-next-line testing-library/no-node-access -- walking up to the row is the only way to scope "this Team's own Record cell"
  const pickemRow = within(table).getByText('Pickem Team').closest('tr');
  const pickemCells = within(pickemRow).getAllByRole('cell');
  // A blank cell announces nothing to a screen reader, so the empty Record
  // cell carries the same aria-hidden dash / visually-hidden "Not available"
  // pair the missing-rosterValue cell uses, never bare emptiness.
  expect(pickemCells[pickemCells.length - 1]).toHaveTextContent('Not available');
});

// Cory's 2026-09-11 ruling on this ticket, settling the note #1211/PR #1222
// left open: a co-champion removed before rollover (so its Team never
// archived a standings row) loses the points/correct caption; the other
// co-champion's still renders. No per-champion caption field is added to
// champions[].
test("a co-champion missing its own season's archived standings row renders its name alone and logs the defect, while the other co-champion's caption still renders", async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  apiClient.get.mockResolvedValue({
    data: {
      seasons: [{
        season: 2026,
        outcome: 'champion',
        champions: [
          { teamId: 1, name: 'Has Standing', avatarUrl: null, avatarStaticUrl: null },
          { teamId: 2, name: 'Missing Standing', avatarUrl: null, avatarStaticUrl: null },
        ],
        standings: [{ teamId: 1, name: 'Has Standing', rank: 1, wins: 10, losses: 4, ties: 0 }],
        trophies: [],
        draftGrades: null,
      }],
      allTime: [],
    },
  });

  renderHistory();

  const banner = await screen.findByTestId('champion-banner-2026');
  expect(banner).toHaveTextContent('Has Standing');
  expect(banner).toHaveTextContent('10-4 record');
  expect(banner).toHaveTextContent('Missing Standing');
  expect(banner).not.toHaveTextContent('Missing Standing record');
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('champion 2'));

  errorSpy.mockRestore();
});
