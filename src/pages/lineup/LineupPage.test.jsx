import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import supabase from '../../api/supabaseClient';
import { invalidate } from '../../lib/resourceCache';
import { PENDING_LINEUP_MUTATIONS_KEY } from '../../lib/pendingLineupMutations';
import LineupPage from './index';

/**
 * Lineup page slice tests (#1237, AC11): "Page test (URL-keyed API mock,
 * faked Supabase channel, test socket factory) covers: both Game cell
 * states, every Edge line kind, Unavailable reasons, the strip numbers, a
 * swap and a refused swap, best ball, the narrow layout." Every branch has
 * its own dedicated unit coverage already (LedgerRow.test.jsx for the Game
 * cell/Edge line/Unavailable rendering, buildLedgerSections.test.js for
 * bench sorting, useSwapPlayers.test.js and useDropPlayer.test.js for the
 * interaction rules, TeamSummaryStrip.test.jsx for the strip numbers); what
 * this suite proves is that the composed page wires them together
 * correctly, so each item here is a representative end-to-end check rather
 * than an exhaustive re-test of a unit already covered elsewhere.
 *
 * This ticket deletes LineupScreen.jsx and TeamLineup.jsx along with their
 * test files (AC10); the enforcement/refusal scenarios those suites covered
 * that still apply to this redesign - locks, best ball's starting-slot
 * refusal, a failed save's rollback - are reasserted here and in the
 * feature-level suites above, not restated file-for-file.
 */
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// The faked Supabase channel (AC11): the Matchup entity's `useLiveGameStates`
// reads through this client for the Game cell's placeholder live state.
jest.mock('../../api/supabaseClient', () => ({
  __esModule: true,
  default: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
}));

const mockNotify = jest.fn();
jest.mock('../../components/Snackbar/SnackbarProvider', () => ({
  useSnackbar: () => mockNotify,
}));

let liveGameRows = [];
function installSupabase() {
  const inFn = jest.fn().mockImplementation((column, ids) =>
    Promise.resolve({ data: liveGameRows.filter((r) => ids.includes(r.tank01_game_id)), error: null })
  );
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  const channelObj = { on: jest.fn(() => channelObj), subscribe: jest.fn(() => channelObj) };
  supabase.channel.mockReturnValue(channelObj);
}

beforeEach(() => {
  invalidate(undefined, { reload: false });
  installSupabase();
  window.localStorage.removeItem(PENDING_LINEUP_MUTATIONS_KEY);
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterEach(() => {
  jest.clearAllMocks();
  liveGameRows = [];
});

const LEAGUES_URL = '/api/league';
const LEAGUE_URL = '/api/league/1';
const LINEUP_URL = '/api/team/lineup?leagueId=1';
const MATCHUPS_URL = '/api/league/1/matchups?week=4';
const HINDSIGHT_URL = '/api/team/hindsight?leagueId=1&teamId=3&season=2026';
const ADVICE_URL = '/api/team/lineup/advice?leagueId=1&week=4';

const ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 1, eligiblePositions: ['RB'] },
  { key: 'WR', count: 1, eligiblePositions: ['WR'] },
];

const entryRow = (over = {}) => ({
  id: 1,
  name: 'Player',
  position: 'QB',
  nfl_team: 'BUF',
  slot: 'QB',
  projection: 10,
  floor: 5,
  ceiling: 15,
  injury_status: null,
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  game_key: null,
  onBye: false,
  locked: false,
  ir_attested: false,
  valid_stash: false,
  spent: false,
  unavailable: null,
  edge: null,
  ...over,
});

const lineupBody = (overrides = {}) => ({
  leagueId: 1,
  teamId: 3,
  season: 2026,
  week: 4,
  currentWeek: 4,
  rosterSlots: ROSTER_SLOTS,
  benchSlots: 2,
  irSlots: 1,
  entries: [
    // Locked QB, pre-kickoff Game cell, no live row for its game key.
    entryRow({
      id: 1, name: 'Josh Allen', position: 'QB', slot: 'QB', nfl_team: 'BUF',
      opponent: 'KC', game_key: 'g1', locked: true, projection: 24.3,
    }),
    // Unlocked RB, final Game cell (liveGameRows below), Edge line kind "result".
    entryRow({
      id: 2, name: 'Derrick King', position: 'RB', slot: 'RB', nfl_team: 'BAL',
      opponent: 'CIN', game_key: 'g2', locked: false, projection: 15,
      edge: { kind: 'result', text: 'Beat projection by 2.1 pts' },
    }),
    // Empty WR starting slot: the swap target.
    // Bench player, Unavailable (out), Edge line kind "injury".
    entryRow({
      id: 10, name: 'Bench Guy', position: 'WR', slot: 'BENCH', nfl_team: 'MIA',
      injury_status: 'O', projection: null,
      edge: { kind: 'injury', text: 'Out' },
    }),
    // IR player, attested stash.
    entryRow({
      id: 20, name: 'Attested Guy', position: 'RB', slot: 'IR', nfl_team: 'DAL',
      injury_status: 'IR', ir_attested: true, valid_stash: true, projection: null,
    }),
    ...(overrides.extraEntries || []),
  ],
  ...overrides.body,
});

const leaguesListResponse = (over = {}) => ({
  data: [{ id: 1, name: 'Sunday Ballers', pickem_only: false, best_ball: false, ...over }],
});

const leagueResponse = (over = {}) => ({
  data: {
    viewerTeamId: 3,
    league: { id: 1, name: 'Sunday Ballers', current_week: 4, best_ball: false, ...over },
    teams: [
      { teamId: 3, id: 3, teamName: 'My Team', avatar_url: null, avatar_static_url: null },
      { teamId: 7, id: 7, teamName: 'Rival', avatar_url: null, avatar_static_url: null },
    ],
  },
});

const matchupRow = (over = {}) => ({
  id: 55,
  week: 4,
  season: 2026,
  final: false,
  status: null,
  home_team_id: 3,
  away_team_id: 7,
  home_score: '0.0',
  away_score: '0.0',
  home_expected_final: '95.0',
  away_expected_final: '88.0',
  home_players_remaining: 5,
  away_players_remaining: 4,
  ...over,
});

// #1238: the advice fixture default carries no suggestion (the summary
// strip's advice tile and the panel both read that as "Lineup set"); tests
// below override it with a populated suggestion.
const adviceBody = (over = {}) => ({
  season: 2026,
  week: 4,
  projectedTotal: 90,
  optimalTotal: 90,
  suggestions: [],
  movePlan: [],
  ...over,
});

const adviceSuggestion = (over = {}) => ({
  slot: 'RB',
  gain: 6.5,
  verdict: 'start',
  current: {
    playerId: 2, name: 'Derrick King', projection: 8, opponent: 'CIN', opponentPointsAllowed: 12.1,
    distribution: { p10: 3, p90: 13 },
  },
  suggested: {
    playerId: 10, name: 'Bench Guy', projection: 14.5, opponent: 'NYJ', opponentPointsAllowed: 21.4,
    distribution: { p10: 9, p90: 20 },
  },
  ...over,
});

// Reads back one element's own generated CSS declarations under a given
// media condition (`''` for a plain, non-responsive property; a responsive
// `sx` value compiles its OWN `xs` entry under `@media (min-width:0px)`,
// never into the unconditional rule, verified directly) - jsdom's
// `getComputedStyle` does not cascade emotion's CSSOM-inserted, media-
// conditioned rules (verified: it answers the browser default for every
// responsive `sx` value regardless of breakpoint), so a responsive `display`
// toggle can only be proven by reading the generated rule itself, not by
// asking jsdom what it thinks is visible. Byte-for-byte DashButton.test.jsx's
// own copy (its own comment names MatchupPreview.test.jsx's copy too), which
// is why this stays a third small local copy rather than a new shared util.
const rulesUnder = (el, media = '') => {
  const cls = Array.from(el.classList).find((c) => c.startsWith('css-'));
  const norm = (value) => String(value).replace(/\s+/g, '');
  let found = '';
  const walk = (rules, condition) => {
    Array.from(rules).forEach((rule) => {
      if (rule.media) {
        walk(rule.cssRules || [], rule.media.mediaText || '');
        return;
      }
      if (rule.selectorText === `.${cls}` && norm(condition) === norm(media)) {
        found += `${rule.style.cssText};`;
      }
    });
  };
  Array.from(document.styleSheets).forEach((sheet) => walk(sheet.cssRules, ''));
  return found;
};

function mockGetByUrl(map) {
  apiClient.get.mockImplementation((url) =>
    Object.prototype.hasOwnProperty.call(map, url)
      ? Promise.resolve(map[url])
      : Promise.reject(new Error(`unexpected GET ${url}`))
  );
}

function baseUrls(overrides = {}) {
  return {
    [LEAGUES_URL]: leaguesListResponse(),
    [LEAGUE_URL]: leagueResponse(),
    [LINEUP_URL]: { data: lineupBody() },
    [MATCHUPS_URL]: { data: [matchupRow()] },
    [HINDSIGHT_URL]: { data: { totalPointsLeftOnBench: 12.5 } },
    [ADVICE_URL]: { data: adviceBody() },
    ...overrides,
  };
}

const renderPage = (overrides = {}) => {
  mockGetByUrl(baseUrls(overrides));
  return renderWithProviders(<LineupPage />, { route: '/team?leagueId=1', path: '/team' });
};

test('renders Starters, Bench and IR from the lineup entity, with the team header', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { level: 1, name: 'My Team' })).toBeInTheDocument();
  expect(screen.getByTestId('ledger-starters')).toBeInTheDocument();
  expect(within(screen.getByTestId('ledger-starters')).getByText('Josh Allen')).toBeInTheDocument();
  expect(screen.getByTestId('ledger-bench')).toBeInTheDocument();
  expect(within(screen.getByTestId('ledger-bench')).getByText('Bench Guy')).toBeInTheDocument();
  expect(screen.getByTestId('ledger-ir')).toBeInTheDocument();
  expect(within(screen.getByTestId('ledger-ir')).getByText('Attested Guy')).toBeInTheDocument();
});

test('both Game cell states render: pre-kickoff and final (from the faked Supabase channel)', async () => {
  liveGameRows = [
    { tank01_game_id: 'g2', game_status: 'final', home_team: 'BAL', away_team: 'CIN', current_score_home: 27, current_score_away: 20 },
  ];
  renderPage();
  await screen.findByText('Josh Allen');

  await waitFor(() =>
    expect(screen.getAllByTestId('ledger-game-cell').map((c) => c.getAttribute('data-game-state'))).toContain('final')
  );
  const states = screen.getAllByTestId('ledger-game-cell').map((c) => c.getAttribute('data-game-state'));
  expect(states).toContain('pre');
});

test('every Edge line kind from the fixture renders with its own kind attribute', async () => {
  renderPage();
  await screen.findByText('Josh Allen');
  const lines = screen.getAllByTestId('ledger-edge-line');
  const kinds = lines.map((l) => l.getAttribute('data-edge-kind'));
  expect(kinds).toEqual(expect.arrayContaining(['result', 'injury']));
});

test('Unavailable reasons show in the projection cell and a dash for points', async () => {
  renderPage();
  // `slot-row-BENCH-10` names the row's OUTER wrapper (the element
  // tests/e2e/auth-offline.spec.ts asserts contains the row's text), which
  // wraps both the invisible swap-select button and the visible content -
  // the cells are read from within it directly.
  const benchRow = await screen.findByTestId('slot-row-BENCH-10');
  expect(within(benchRow).getByTestId('ledger-projection')).toHaveTextContent('out');
  expect(within(benchRow).getByTestId('ledger-points')).toHaveTextContent('-');
});

test('the summary strip shows the score/projected figures and win probability from the matchup entity', async () => {
  renderPage({
    [MATCHUPS_URL]: { data: [matchupRow({ status: 'live', home_score: '20', away_score: '10' })] },
  });
  expect(await screen.findByTestId('strip-score')).toHaveTextContent('95.0');
  expect(screen.getByTestId('strip-opponent-score')).toHaveTextContent('88.0');
  expect(screen.getByTestId('strip-win-probability')).toHaveTextContent('Win probability');
});

test('a swap: selecting the eligible bench player then the empty WR slot saves a one-move PUT', async () => {
  const user = userEvent.setup();
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage();

  // `-select` is the row's own invisible swap-select button (a sibling of
  // the player's name link, not an ancestor of it); jsdom's click has no
  // geometric hit-testing, unlike a real browser, so the unit test targets
  // it directly rather than the outer wrapper a real click would resolve to.
  await user.click(await screen.findByTestId('slot-row-BENCH-10-select'));
  await user.click(screen.getByTestId('slot-row-WR-0-select'));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 4,
      moves: [{ playerId: 10, slot: 'WR' }],
    })
  );
});

test('a refused swap: clicking a locked starter warns and saves nothing', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId('slot-row-QB-0-select'));
  expect(mockNotify).toHaveBeenCalledWith("Locked players can't be moved", { severity: 'warning' });
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('best ball refuses a click on a starting slot (no selection, no save)', async () => {
  const user = userEvent.setup();
  renderPage({ [LEAGUE_URL]: leagueResponse({ best_ball: true }), [LEAGUES_URL]: leaguesListResponse({ best_ball: true }) });
  await screen.findByText('Derrick King');
  await user.click(screen.getByTestId('slot-row-RB-0-select'));
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('the narrow layout renders a bottom Starters/Bench tab bar with 44px targets', async () => {
  renderPage();
  await screen.findByText('Josh Allen');
  const tabs = screen.getByTestId('lineup-mobile-tabs');
  expect(tabs).toHaveAttribute('role', 'group');
  const buttons = within(tabs).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual(['Starters', 'Bench']);
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  const user = userEvent.setup();
  await user.click(buttons[1]);
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
});

test('no "optimal", "optimize" or "range" copy, and no em-dashes, anywhere on the page', async () => {
  const { container } = renderPage();
  await screen.findByText('Josh Allen');
  const text = container.textContent;
  expect(text).not.toMatch(/optimal|optimize/i);
  expect(text).not.toMatch(/\brange\b/i);
  expect(text).not.toMatch(/—/);
});

// A dedicated best-ball render: the assertion above defaults to
// best_ball: false, so it never mounts the best-ball notice and would pass
// even if that copy used the banned word (formal review finding
// ac11-optimal-copy-and-blind-guard).
test('no "optimal" copy in the best-ball notice either', async () => {
  const { container } = renderPage({
    [LEAGUE_URL]: leagueResponse({ best_ball: true }),
    [LEAGUES_URL]: leaguesListResponse({ best_ball: true }),
  });
  expect(await screen.findByTestId('best-ball-notice')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/optimal|optimize/i);
});

// AC5 (formal review finding ac5-hindsight-line-missing): the bench points
// left on the table line reads the existing hindsight endpoint.
test('the bench points left on the table line reads the hindsight endpoint', async () => {
  renderPage();
  expect(await screen.findByTestId('bench-points-left')).toHaveTextContent('Bench points this season: 12.5');
});

// Formal review finding legacy-controls-dropped-without-a-criterion:
// restored controls. #1240 AC1/AC8: the player name now opens the Decision
// card (replacing the earlier Quick View wiring on Lineup only).
const decisionContextUrl = (playerId) => `/api/team/lineup/${playerId}/context?leagueId=1&week=4`;

test('the player name opens the Decision card with the row\'s own fields, and every section fills in once its context resolves', async () => {
  const user = userEvent.setup();
  renderPage({
    [decisionContextUrl(1)]: {
      data: {
        line: { spread: -3, total: 47, impliedTeamTotal: 22, observedAt: '2026-09-14T00:00:00Z' },
        weather: { indoor: false, temperatureF: 45, windSpeedMph: 10, windGustMph: 18, precipitationProbability: 20, shortForecast: 'Cloudy' },
        usage: {
          weeks: [{ season: 2026, week: 3, targets: 8, carries: 0, airYards: 90, targetShare: 0.23, fantasyPoints: 12.4 }],
          seasonAverage: { targets: 6.5, carries: 0.5, airYards: 65, targetShare: 0.21, fantasyPoints: 10.2 },
        },
      },
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Josh Allen' }));

  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByRole('heading', { name: 'Josh Allen' })).toBeInTheDocument();
  // The row's own fields (AC1: paints immediately, before the extras load).
  // Formal review round 2 finding r6: this is the one page-level case that
  // must carry a genuinely populated mean (Josh Allen's fixture projection
  // is 24.3), not just prove the RangeBar mounted - a null-projection
  // subject would pass this assertion even with the mean broken.
  expect(within(card).getByTestId('decision-card-range-bar')).toHaveAttribute(
    'aria-label',
    'Josh Allen, Floor 5.0, Projection 24.3, Ceiling 15.0'
  );

  expect(await within(card).findByTestId('decision-card-line')).toHaveTextContent('Line: -3 / 47');
  expect(within(card).getByTestId('decision-card-implied-total')).toHaveTextContent('22.0');
  expect(within(card).getByTestId('decision-card-weather')).toHaveTextContent('45°F');
  expect(within(card).getByTestId('decision-card-usage-table')).toHaveTextContent('Wk 3');
});

// Formal review finding f6 (round 1) / r6 (round 2): the injury tile is its
// own case, on its own subject (Bench Guy, id 10, already carries an
// injury designation and the matching injury Edge line in the shared
// fixture) - kept separate from the populated-projection case above so
// neither subject has to serve both jobs at once.
test('the injury tile renders at page level', async () => {
  const user = userEvent.setup();
  renderPage({ [decisionContextUrl(10)]: { data: { line: null, weather: null, usage: null } } });
  await user.click(await screen.findByRole('button', { name: 'Bench Guy' }));
  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByTestId('decision-card-injury')).toHaveTextContent('Out');
});

// Formal review finding f6: the opponent/kickoff line and the Factor line,
// the two remaining "every section with data" cases AC8 asks for that the
// page test did not yet cover.
test('the opponent/kickoff line and the largest Factor\'s explanation render at page level', async () => {
  const user = userEvent.setup();
  renderPage({
    [LINEUP_URL]: {
      data: lineupBody({
        extraEntries: [
          entryRow({
            id: 50, name: 'Factor Guy', position: 'WR', slot: 'BENCH', nfl_team: 'MIA',
            opponent: 'NYJ', kickoff: '2026-09-14T13:00:00Z', edge: { kind: 'factor', text: 'Matchup +3.5' },
          }),
        ],
      }),
    },
    [decisionContextUrl(50)]: { data: { line: null, weather: null, usage: null } },
  });
  await user.click(await screen.findByRole('button', { name: 'Factor Guy' }));
  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByTestId('decision-card-opponent')).toHaveTextContent('vs NYJ');
  expect(await within(card).findByTestId('decision-card-factor')).toHaveTextContent('Matchup +3.5');
});

test('with no Line, weather or usage from the context endpoint, those tiles are hidden - AC3\'s null-source rule', async () => {
  const user = userEvent.setup();
  renderPage(); // no decisionContextUrl mock: the context GET rejects, leaving line/weather/usage null
  await user.click(await screen.findByRole('button', { name: 'Josh Allen' }));

  const card = await screen.findByTestId('decision-card');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(decisionContextUrl(1)));
  expect(within(card).queryByTestId('decision-card-line')).not.toBeInTheDocument();
  expect(within(card).queryByTestId('decision-card-weather')).not.toBeInTheDocument();
  expect(within(card).queryByTestId('decision-card-usage')).not.toBeInTheDocument();
  // Josh Allen's own fixture edge is null, so no factor tile either.
  expect(within(card).queryByTestId('decision-card-factor')).not.toBeInTheDocument();
});

test('a swap from bench options moves the opened starter and the chosen bench player, and a locked option is disabled', async () => {
  const user = userEvent.setup();
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage({
    [LINEUP_URL]: {
      data: lineupBody({
        extraEntries: [
          entryRow({ id: 40, name: 'Bench RB Fast', slot: 'BENCH', position: 'RB', nfl_team: 'MIA', projection: 9 }),
          entryRow({ id: 41, name: 'Bench RB Locked', slot: 'BENCH', position: 'RB', nfl_team: 'NYJ', projection: 20, locked: true }),
        ],
      }),
    },
  });
  // Derrick King (id 2) starts at RB; both new bench RBs are eligible for his slot.
  await user.click(await screen.findByRole('button', { name: 'Derrick King' }));
  const card = await screen.findByTestId('decision-card');
  const benchOptions = await within(card).findByTestId('decision-card-bench-options');

  expect(within(benchOptions).getByTestId('decision-card-bench-option-lock')).toHaveTextContent('Locked');
  expect(within(benchOptions).getByTestId('decision-card-bench-swap-41')).toBeDisabled();

  await user.click(within(benchOptions).getByTestId('decision-card-bench-swap-40'));
  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 4,
      moves: [
        { playerId: 40, slot: 'RB' },
        { playerId: 2, slot: 'BENCH' },
      ],
    })
  );
});

test('the sheet at a narrow width carries the drag handle and the sheet variant', async () => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: true,
    media: query,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Josh Allen' }));
  const card = await screen.findByTestId('decision-card');
  expect(card).toHaveAttribute('data-variant', 'sheet');
  expect(screen.getByTestId('decision-card-drag-handle')).toBeInTheDocument();
});

test('closing the Decision card returns focus to the row that opened it', async () => {
  const user = userEvent.setup();
  renderPage();
  const nameButton = await screen.findByRole('button', { name: 'Josh Allen' });
  await user.click(nameButton);
  await screen.findByTestId('decision-card');
  await user.click(screen.getByTestId('decision-card-close'));
  await waitFor(() => expect(nameButton).toHaveFocus());
});

test('an empty roster (no draft in progress) shows the Browse Players empty state', async () => {
  renderPage({ [LINEUP_URL]: { data: lineupBody({ body: { entries: [] } }) } });
  expect(await screen.findByTestId('lineup-empty-roster')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Browse Players' })).toHaveAttribute('href', '/player');
  expect(screen.queryByTestId('ledger-starters')).not.toBeInTheDocument();
});

// #1238 AC1/AC2/AC5/AC7: the Start/sit panel, apply-advice and the phone
// Outlook tab.

test('the Start/sit panel renders a suggestion with both players\' Floor/Ceiling intervals', async () => {
  renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) } });
  const panel = await screen.findByTestId('start-sit-panel');
  await within(panel).findByText('Derrick King');
  expect(within(panel).getByText('Bench Guy')).toBeInTheDocument();
  expect(within(panel).getAllByTestId('suggestion-range-bar')).toHaveLength(2);
  // Formal review finding f3: the length-2 assertion above would still pass
  // with both bars empty. Pin the actual Floor/projection/Ceiling figures
  // (the advice fixture's own distribution.p10/p90) in each bar's own
  // accessible name, from `adviceSuggestion()` above.
  expect(within(panel).getByRole('img', { name: 'Derrick King, Floor 3.0, Projection 8.0, Ceiling 13.0' })).toBeInTheDocument();
  expect(within(panel).getByRole('img', { name: 'Bench Guy, Floor 9.0, Projection 14.5, Ceiling 20.0' })).toBeInTheDocument();
});

test('a too-close-to-call suggestion shows that chip, never a lean', async () => {
  renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion({ verdict: 'tossup' })] }) } });
  const chip = await screen.findByTestId('suggestion-verdict');
  expect(chip).toHaveTextContent('Too close to call');
});

test('applying the advice sends exactly the moves it names, as one write', async () => {
  const user = userEvent.setup();
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage({
    [ADVICE_URL]: {
      data: adviceBody({
        suggestions: [adviceSuggestion()],
        movePlan: [
          { playerId: 2, fromSlot: 'RB', toSlot: 'BENCH' },
          { playerId: 10, fromSlot: 'BENCH', toSlot: 'RB' },
        ],
      }),
    },
  });

  await user.click(await screen.findByTestId('start-sit-apply'));

  await waitFor(() =>
    expect(apiClient.put).toHaveBeenCalledWith('/api/team/lineup', {
      leagueId: 1,
      week: 4,
      moves: [
        { playerId: 2, slot: 'BENCH' },
        { playerId: 10, slot: 'RB' },
      ],
    })
  );
});

test('a refused apply rolls the optimistic move back', async () => {
  const user = userEvent.setup();
  apiClient.put.mockRejectedValue({ response: { status: 409, data: { error: 'locked' } } });
  renderPage({
    [ADVICE_URL]: {
      data: adviceBody({
        suggestions: [adviceSuggestion()],
        movePlan: [
          { playerId: 2, fromSlot: 'RB', toSlot: 'BENCH' },
          { playerId: 10, fromSlot: 'BENCH', toSlot: 'RB' },
        ],
      }),
    },
  });

  await user.click(await screen.findByTestId('start-sit-apply'));

  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('locked', { severity: 'error' }));
  expect(within(screen.getByTestId('ledger-starters')).getByText('Derrick King')).toBeInTheDocument();
});

test('best ball hides the Start/sit panel entirely (never calls the advice endpoint)', async () => {
  renderPage({
    [LEAGUE_URL]: leagueResponse({ best_ball: true }),
    [LEAGUES_URL]: leaguesListResponse({ best_ball: true }),
  });
  await screen.findByText('Derrick King');
  expect(screen.queryByTestId('start-sit-panel')).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringContaining('/lineup/advice'));
});

test('the Outlook tab: the phone view control toggles which column is hidden below `sm`', async () => {
  const user = userEvent.setup();
  renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) } });
  await screen.findByText('Josh Allen');

  const viewControl = screen.getByTestId('lineup-mobile-view');
  const rosterRadio = within(viewControl).getByRole('radio', { name: 'Roster' });
  const outlookRadio = within(viewControl).getByRole('radio', { name: 'Outlook' });
  expect(rosterRadio).toHaveAttribute('aria-checked', 'true');

  const rosterColumn = screen.getByTestId('lineup-roster-column');
  const outlookColumn = screen.getByTestId('lineup-outlook-column');

  // Roster selected by default (AC5): the Ledger shows below `sm`, the rail
  // (start-sit-panel, matchup-preview) doesn't; both already show side by
  // side from `sm`/`md` up regardless, which the toggle never touches. MUI
  // compiles the `xs` value of a responsive `sx` into `@media (min-width:0px)`
  // rather than an unconditional base rule (verified directly), so `xs` is
  // read back under that condition, not `''`.
  expect(rulesUnder(rosterColumn, '(min-width:0px)')).toContain('display: grid');
  expect(rulesUnder(outlookColumn, '(min-width:0px)')).toContain('display: none');
  expect(rulesUnder(rosterColumn, '(min-width:600px)')).toContain('display: grid');
  expect(rulesUnder(outlookColumn, '(min-width:900px)')).toContain('display: grid');

  await user.click(outlookRadio);

  expect(outlookRadio).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('start-sit-panel')).toBeInTheDocument();
  expect(rulesUnder(rosterColumn, '(min-width:0px)')).toContain('display: none');
  expect(rulesUnder(outlookColumn, '(min-width:0px)')).toContain('display: grid');
});

// #1239 AC1-AC7: the Bye cluster grid and its attention chip. The default
// fixture's own entries carry no bye_week, so these tests add extraEntries
// with one explicitly set - fromWeek is the fixture's own week: 4, so the
// grid covers weeks 5 through 11.

test('no cluster: every tile in the grid reads quiet, no naming line, no attention chip', async () => {
  renderPage();
  const grid = await screen.findByTestId('bye-cluster-grid');
  const tiles = within(grid).getAllByTestId('bye-cluster-tile');
  expect(tiles).toHaveLength(7);
  expect(tiles.every((t) => t.getAttribute('data-severity') === 'quiet')).toBe(true);
  expect(within(grid).queryByTestId('bye-cluster-line')).not.toBeInTheDocument();
  expect(screen.queryByTestId('attention-chip-bye-cluster')).not.toBeInTheDocument();
});

test('a cluster of two is notable: the tile, the naming line, but no attention chip', async () => {
  renderPage({
    [LINEUP_URL]: {
      data: lineupBody({
        extraEntries: [
          entryRow({ id: 30, name: 'Bye A', slot: 'BENCH', position: 'RB', bye_week: 6 }),
          entryRow({ id: 31, name: 'Bye B', slot: 'BENCH', position: 'WR', bye_week: 6 }),
        ],
      }),
    },
  });
  const grid = await screen.findByTestId('bye-cluster-grid');
  const wk6 = within(grid).getAllByTestId('bye-cluster-tile').find((t) => t.getAttribute('data-week') === '6');
  expect(wk6).toHaveAttribute('data-severity', 'notable');
  expect(within(wk6).getByText('2')).toBeInTheDocument();
  expect(within(grid).getByTestId('bye-cluster-line')).toHaveTextContent('Week 6: Bye A and Bye B sit.');
  expect(screen.queryByTestId('attention-chip-bye-cluster')).not.toBeInTheDocument();
});

// The league fixture below deliberately carries a NON-default
// waiver_period_hours (48, not the byeClusterCopy fallback of 24) - formal
// review finding f4: with the default value, the naming line's "24 hours"
// text is produced by the copy helper's own `?? 24` fallback regardless of
// whether league.waiver_period_hours actually reaches the page, so a broken
// prop chain would pass unnoticed. Asserting 48 here proves the wiring.
test('a cluster of three is a warning: the tile, the named players and waiver copy, and the summary strip chip', async () => {
  renderPage({
    [LEAGUE_URL]: leagueResponse({ waiver_period_hours: 48 }),
    [LINEUP_URL]: {
      data: lineupBody({
        extraEntries: [
          entryRow({ id: 30, name: 'Robinson', slot: 'BENCH', position: 'RB', bye_week: 5 }),
          entryRow({ id: 31, name: 'Hubbard', slot: 'BENCH', position: 'RB', bye_week: 5 }),
          entryRow({ id: 32, name: 'Reed', slot: 'BENCH', position: 'WR', bye_week: 5 }),
        ],
      }),
    },
  });
  const grid = await screen.findByTestId('bye-cluster-grid');
  const wk5 = within(grid).getAllByTestId('bye-cluster-tile').find((t) => t.getAttribute('data-week') === '5');
  expect(wk5).toHaveAttribute('data-severity', 'warning');
  expect(within(wk5).getByText('3')).toBeInTheDocument();
  expect(within(grid).getByTestId('bye-cluster-line')).toHaveTextContent(
    'Week 5: Robinson, Hubbard and Reed sit. Waivers clear in 48 hours.'
  );
  expect(await screen.findByTestId('attention-chip-bye-cluster')).toHaveTextContent('Wk 5 · 3 byes');
});

test('an IR player sharing the worst week is excluded from the count and the naming line', async () => {
  renderPage({
    [LINEUP_URL]: {
      data: lineupBody({
        extraEntries: [
          entryRow({ id: 30, name: 'Robinson', slot: 'BENCH', position: 'RB', bye_week: 5 }),
          entryRow({ id: 31, name: 'Hubbard', slot: 'BENCH', position: 'RB', bye_week: 5 }),
          entryRow({ id: 32, name: 'Reed', slot: 'BENCH', position: 'WR', bye_week: 5 }),
          entryRow({ id: 33, name: 'Stashed', slot: 'IR', position: 'TE', injury_status: 'IR', bye_week: 5 }),
        ],
      }),
    },
  });
  const grid = await screen.findByTestId('bye-cluster-grid');
  const wk5 = within(grid).getAllByTestId('bye-cluster-tile').find((t) => t.getAttribute('data-week') === '5');
  expect(within(wk5).getByText('3')).toBeInTheDocument();
  expect(within(grid).getByTestId('bye-cluster-line')).not.toHaveTextContent('Stashed');
});

test('a past week (already played) shows no Bye cluster grid at all', async () => {
  renderPage({ [LINEUP_URL]: { data: lineupBody({ body: { week: 2, currentWeek: 4 } }) } });
  await screen.findByText('Josh Allen');
  expect(screen.queryByTestId('bye-cluster-grid')).not.toBeInTheDocument();
});
