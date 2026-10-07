import React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
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
let liveGameHandler = null;
function installSupabase() {
  const inFn = jest.fn().mockImplementation((column, ids) =>
    Promise.resolve({ data: liveGameRows.filter((r) => ids.includes(r.tank01_game_id)), error: null })
  );
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  const channelObj = {
    on: jest.fn((_event, _filter, cb) => { liveGameHandler = cb; return channelObj; }),
    subscribe: jest.fn((cb) => { cb?.('SUBSCRIBED'); return channelObj; }),
  };
  supabase.channel.mockReturnValue(channelObj);
}
// Delivers one realtime UPDATE payload to the live_game_states channel (AC1,
// AC6: "a Realtime row update moving a cell from pre to live").
const pushLiveGameRow = (row) => act(() => { liveGameHandler?.({ new: row }); });

// The test socket factory (AC11/#1241 AC6: "a socket score update changing
// points and the strip"): the app's own seam (src/api/socket.js's
// window.__ENDZONE_TEST_SOCKET_FACTORY__), driven directly rather than a
// real socket.io-client connection - the same pattern useMatchup.test.js and
// the Game Center page test use.
function makeFakeSocket() {
  const handlers = {};
  return {
    emit: jest.fn(),
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    io: { on: jest.fn(), off: jest.fn() },
    disconnect: jest.fn(),
    fire: (event, payload) => act(() => { handlers[event]?.(payload); }),
  };
}
let socket;

beforeEach(() => {
  invalidate(undefined, { reload: false });
  installSupabase();
  liveGameHandler = null;
  socket = undefined;
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
    socket = makeFakeSocket();
    return socket;
  };
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
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
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
  // #1482: `projected_points` is the wire's own Point estimate (CONTEXT.md,
  // The projection engine) - the Ledger row's headline number, and (formal
  // review round 2) the Decision card's Proj text/RangeBar marker and Bench
  // options number/sort, since this ticket. `projection` is a separate
  // field, the distribution's bare mean, that nothing on the Lineup page
  // reads for display any more. Defaulted equal to `projection` here since
  // this fixture isn't testing the two statistics diverging (LedgerRow.test
  // .jsx and PlayerDecisionCard.test.jsx own that case); a caller that
  // overrides `projection` overrides this alongside it.
  projected_points: 10,
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
    // Formal review round 3 finding s4: floor/ceiling bracket the
    // projection explicitly (the fixture's own default floor/ceiling, 5/15,
    // sit below Josh Allen's 24.3 projection - a shape the domain cannot
    // produce, since Floor and Ceiling are the same distribution's 10th and
    // 90th percentile as the mean).
    entryRow({
      id: 1, name: 'Josh Allen', position: 'QB', slot: 'QB', nfl_team: 'BUF',
      opponent: 'KC', game_key: 'g1', locked: true, projected_points: 24.3, projection: 24.3, floor: 18, ceiling: 30,
    }),
    // Unlocked RB, final Game cell (liveGameRows below), Edge line kind "result".
    entryRow({
      id: 2, name: 'Derrick King', position: 'RB', slot: 'RB', nfl_team: 'BAL',
      opponent: 'CIN', game_key: 'g2', locked: false, projected_points: 15, projection: 15,
      edge: { kind: 'result', text: 'Beat projection by 2.1 pts' },
    }),
    // Empty WR starting slot: the swap target.
    // Bench player, Unavailable (out), Edge line kind "injury".
    entryRow({
      id: 10, name: 'Bench Guy', position: 'WR', slot: 'BENCH', nfl_team: 'MIA',
      injury_status: 'O', startVerdict: { outcome: 'unavailable', reason: 'out', numberTrusted: true }, projected_points: null, projection: null,
      edge: { kind: 'injury', text: 'Out' },
    }),
    // IR player, attested stash.
    entryRow({
      id: 20, name: 'Attested Guy', position: 'RB', slot: 'IR', nfl_team: 'DAL',
      injury_status: 'IR', ir_attested: true, valid_stash: true, projected_points: null, projection: null,
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

// #1241 AC1/AC2/AC3/AC6 (ADR 0037 ticket 9): the Realtime live wiring - a
// row moving from pre to live with Situation, a null Situation, a red zone
// flag, a socket score update moving points and the strip, and the
// transition to final.

// `liveGameHandler` is only set once useLiveGameStates' own initial fetch
// resolves and it opens the channel; waiting for it before pushing avoids a
// race against that fetch (the "Josh Allen" text depends only on the
// separate lineup fetch resolving, not this one).
const waitForLiveGameChannel = () => waitFor(() => expect(liveGameHandler).not.toBeNull());
// The chip's DOM node itself is replaced (not just re-attributed) between
// "pre" and "live" - the live state wraps the chip and the Situation line in
// one extra Box - so every assertion after a push re-queries fresh rather
// than holding a reference captured before it.
const firstGameCell = () => screen.getAllByTestId('ledger-game-cell')[0];

test('a Realtime row update moves a cell from pre to live with the Situation line', async () => {
  // Seeded as a non-final row so useLiveGameStates' own channel subscribes
  // to it (open = every non-final row from the initial read); the Game
  // cell itself still reads "pre" until the push below.
  liveGameRows = [{ tank01_game_id: 'g1', game_status: 'scheduled' }];
  renderPage();
  await screen.findByText('Josh Allen');
  expect(firstGameCell()).toHaveAttribute('data-game-state', 'pre');
  await waitForLiveGameChannel();

  pushLiveGameRow({
    tank01_game_id: 'g1', game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
    current_score_home: 3, current_score_away: 7, quarter: 'Q1', time_remaining: '9:00',
    possession: 'BUF', down_distance: '1st & 10',
  });

  await waitFor(() => expect(firstGameCell()).toHaveAttribute('data-game-state', 'live'));
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('BUF ball');
  expect(situation).toHaveTextContent('1st & 10');
});

test('a null Situation renders no Situation line and no "null" text anywhere on the page', async () => {
  liveGameRows = [{ tank01_game_id: 'g1', game_status: 'scheduled' }];
  const { container } = renderPage();
  await screen.findByText('Josh Allen');
  await waitForLiveGameChannel();

  pushLiveGameRow({
    tank01_game_id: 'g1', game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
    current_score_home: 0, current_score_away: 0, quarter: null, time_remaining: null,
  });

  await waitFor(() => expect(firstGameCell()).toHaveAttribute('data-game-state', 'live'));
  expect(screen.queryByTestId('ledger-situation-line')).toBeNull();
  expect(container.textContent).not.toMatch(/null/);
});

// #1292: a Realtime row update carrying `last_play` shows it on the
// Situation line; a null `last_play` omits it.
test('a Realtime row update carrying last_play shows it on the Situation line', async () => {
  liveGameRows = [{ tank01_game_id: 'g1', game_status: 'scheduled' }];
  renderPage();
  await screen.findByText('Josh Allen');
  await waitForLiveGameChannel();

  pushLiveGameRow({
    tank01_game_id: 'g1', game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
    current_score_home: 3, current_score_away: 7, quarter: 'Q1', time_remaining: '9:00',
    possession: 'BUF', down_distance: '1st & 10', last_play: 'Allen pass complete to Diggs for 12 yards',
  });

  await waitFor(() => expect(firstGameCell()).toHaveAttribute('data-game-state', 'live'));
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('Allen pass complete to Diggs for 12 yards');
});

test('a Realtime row update with a null last_play omits it from the Situation line', async () => {
  liveGameRows = [{ tank01_game_id: 'g1', game_status: 'scheduled' }];
  const { container } = renderPage();
  await screen.findByText('Josh Allen');
  await waitForLiveGameChannel();

  pushLiveGameRow({
    tank01_game_id: 'g1', game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
    current_score_home: 3, current_score_away: 7, quarter: 'Q1', time_remaining: '9:00',
    possession: 'BUF', down_distance: '1st & 10', last_play: null,
  });

  await waitFor(() => expect(firstGameCell()).toHaveAttribute('data-game-state', 'live'));
  const situation = screen.getByTestId('ledger-situation-line');
  expect(situation).toHaveTextContent('BUF ball');
  expect(situation).toHaveTextContent('1st & 10');
  expect(container.textContent).not.toMatch(/null/);
});

test('a red zone flag shows the marker on the live row', async () => {
  liveGameRows = [{ tank01_game_id: 'g1', game_status: 'scheduled' }];
  renderPage();
  await screen.findByText('Josh Allen');
  await waitForLiveGameChannel();

  pushLiveGameRow({
    tank01_game_id: 'g1', game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
    current_score_home: 3, current_score_away: 7, quarter: 'Q1', time_remaining: '2:14',
    possession: 'BUF', down_distance: '2nd & Goal', is_red_zone: true,
  });

  expect(await screen.findByTestId('ledger-red-zone-marker')).toBeInTheDocument();
});

test('a socket score update changes the points cell and the summary strip (the existing scores socket)', async () => {
  // Derrick King's own game (g2) live, so the points cell's live colour
  // assertion below is meaningful (AC2's live colour is driven by the Game
  // cell's own state, not the scores socket alone).
  liveGameRows = [
    { tank01_game_id: 'g2', game_status: 'in_progress', home_team: 'BAL', away_team: 'CIN', current_score_home: 20, current_score_away: 10 },
  ];
  renderPage({
    [MATCHUPS_URL]: { data: [matchupRow({ status: 'live', home_score: '20', away_score: '10', home_expected_final: '95.0' })] },
  });
  const kingRow = await screen.findByTestId('slot-row-RB-0');
  await waitFor(() => expect(within(kingRow).getByTestId('ledger-game-cell')).toHaveAttribute('data-game-state', 'live'));
  expect(await screen.findByTestId('strip-score')).toHaveTextContent('20.0 / 95.0');

  socket.fire('scores:updated', {
    week: 4,
    scored: [{ matchupId: 55, homeScore: 26.5, awayScore: 10 }],
    plays: [{ playerId: 2, pointsDelta: 6.5, isTouchdown: true }],
  });

  await waitFor(() => expect(within(kingRow).getByTestId('ledger-points')).toHaveTextContent('6.5'));
  expect(within(kingRow).getByTestId('ledger-points')).toHaveStyle({ color: 'var(--dash-danger)' });
  await waitFor(() => expect(screen.getByTestId('strip-score')).toHaveTextContent('26.5 / 95.0'));
});

// #1546: extends the transition-to-final test with the silent refetch the
// ticket adds - the stale "pace" sentence under the new "result" icon is
// exactly the bug (#1546's defect 1). A second, different `LINEUP_URL`
// response proves the refetch actually happened (not just the instant Edge
// kind flip, which #1241 already covered) and that it landed silently: no
// skeleton renders between the push and the new sentence appearing.
test('the transition to final: a stale "pace" Edge line flips instantly to "result", and a silent refetch replaces its stale sentence', async () => {
  liveGameRows = [{ tank01_game_id: 'g3', game_status: 'in_progress' }];
  const paceEntries = {
    extraEntries: [
      entryRow({
        id: 60, name: 'Pace Guy', position: 'RB', slot: 'BENCH', nfl_team: 'MIA',
        game_key: 'g3', edge: { kind: 'pace', text: '62% of projection so far' },
      }),
    ],
  };
  const resultEntries = {
    extraEntries: [
      entryRow({
        id: 60, name: 'Pace Guy', position: 'RB', slot: 'BENCH', nfl_team: 'MIA',
        game_key: 'g3', edge: { kind: 'result', text: 'Final: won by 7' },
      }),
    ],
  };
  const lineupResponses = [{ data: lineupBody(paceEntries) }, { data: lineupBody(resultEntries) }];
  const otherUrls = baseUrls();
  delete otherUrls[LINEUP_URL];
  apiClient.get.mockImplementation((url) => {
    if (url === LINEUP_URL) {
      return Promise.resolve(lineupResponses.length > 1 ? lineupResponses.shift() : lineupResponses[0]);
    }
    return Object.prototype.hasOwnProperty.call(otherUrls, url)
      ? Promise.resolve(otherUrls[url])
      : Promise.reject(new Error(`unexpected GET ${url}`));
  });
  renderWithProviders(<LineupPage />, { route: '/team?leagueId=1', path: '/team' });

  const row = await screen.findByTestId('slot-row-BENCH-60');
  expect(within(row).getByTestId('ledger-edge-line')).toHaveAttribute('data-edge-kind', 'pace');
  await waitForLiveGameChannel();
  const lineupCallsBefore = apiClient.get.mock.calls.filter((c) => c[0] === LINEUP_URL).length;

  pushLiveGameRow({
    tank01_game_id: 'g3', game_status: 'final', home_team: 'MIA', away_team: 'NYJ',
    current_score_home: 24, current_score_away: 17,
  });

  // The kind flips instantly (#1241 AC3, unchanged by this ticket).
  await waitFor(() => expect(within(row).getByTestId('ledger-edge-line')).toHaveAttribute('data-edge-kind', 'result'));
  // The silent refetch's second response replaces the stale sentence -
  // and no skeleton ever rendered in between (the whole point of `silent`).
  await waitFor(() => expect(within(row).getByText('Final: won by 7')).toBeInTheDocument());
  await waitFor(() =>
    expect(apiClient.get.mock.calls.filter((c) => c[0] === LINEUP_URL)).toHaveLength(lineupCallsBefore + 1)
  );
  expect(screen.queryByTestId('lineup-skeleton')).not.toBeInTheDocument();
});

// #1546: a Realtime row update that leaves the Game cell's own kind
// unchanged (`pre`/`live`/`final`) must not trigger the finished-game
// refetch - only a game whose kind actually transitions does.
test('a Realtime row update that keeps the same Game cell kind triggers no extra lineup fetch', async () => {
  liveGameRows = [{ tank01_game_id: 'g1', game_status: 'in_progress' }];
  renderPage();
  await screen.findByText('Josh Allen');
  expect(firstGameCell()).toHaveAttribute('data-game-state', 'live');
  await waitForLiveGameChannel();
  const lineupCallsBefore = apiClient.get.mock.calls.filter((c) => c[0] === LINEUP_URL).length;

  pushLiveGameRow({
    tank01_game_id: 'g1', game_status: 'in_progress', home_team: 'KC', away_team: 'BUF',
    current_score_home: 10, current_score_away: 7, quarter: 'Q2', time_remaining: '5:00',
  });

  await waitFor(() => expect(firstGameCell()).toHaveTextContent('Q2 5:00'));
  expect(apiClient.get.mock.calls.filter((c) => c[0] === LINEUP_URL)).toHaveLength(lineupCallsBefore);
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

// #1881: a save that lands (the lineup-write feature) clears the week's cached
// Matchups list, so the page re-reads it (the list carries the Expected final
// the lean line and the strip show).
test("a swap whose PUT resolves re-reads the week's matchups list (#1881)", async () => {
  const user = userEvent.setup();
  apiClient.put.mockResolvedValue({ data: {} });
  renderPage();
  const matchupsReads = () =>
    apiClient.get.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.startsWith('/api/league/') && url.includes('/matchups?week=')
    ).length;

  await user.click(await screen.findByTestId('slot-row-BENCH-10-select'));
  const before = matchupsReads();
  expect(before).toBeGreaterThan(0);
  await user.click(screen.getByTestId('slot-row-WR-0-select'));

  await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
  await waitFor(() => expect(matchupsReads()).toBeGreaterThan(before));
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

test('#1965: below sm there is one bottom bar, Starters | Bench | Outlook, with 44px targets and no top view control', async () => {
  renderPage();
  await screen.findByText('Josh Allen');
  expect(screen.queryByTestId('lineup-mobile-view')).not.toBeInTheDocument();
  const tabs = screen.getByTestId('lineup-mobile-tabs');
  expect(tabs).toHaveAttribute('role', 'group');
  expect(tabs).toHaveAttribute('aria-label', 'Lineup section');
  const buttons = within(tabs).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual(['Starters 2/3', 'Bench 2', 'Outlook']);
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Starters, 2 of 3 filled', 'Bench, 2 players', 'Outlook']);
  expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  buttons.forEach((b) => expect(rulesUnder(b)).toMatch(/min-height: 44px/));
  // The bar is page-owned and hidden from `sm`.
  expect(rulesUnder(tabs, '(min-width:0px)')).toContain('display: flex');
  expect(rulesUnder(tabs, '(min-width:600px)')).toContain('display: none');
});

// The phone bar drives which Ledger section shows (the Ledger is controlled,
// #1965): Starters by default, Bench on its press.
test('#1965: pressing Bench shows the Bench card below sm and hides Starters', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Josh Allen');
  const startersSection = screen.getByTestId('ledger-starters-section');
  const benchSection = screen.getByTestId('ledger-bench-section');
  expect(rulesUnder(startersSection)).toContain('display: block');
  expect(rulesUnder(benchSection, '(min-width:0px)')).toContain('display: none');

  const [startersTab, benchTab] = within(screen.getByTestId('lineup-mobile-tabs')).getAllByRole('button');
  await user.click(benchTab);

  expect(benchTab).toHaveAttribute('aria-pressed', 'true');
  expect(startersTab).toHaveAttribute('aria-pressed', 'false');
  expect(rulesUnder(benchSection)).toContain('display: block');
  expect(rulesUnder(startersSection, '(min-width:0px)')).toContain('display: none');
});

// #1425: selecting a starter switches the mobile tab to Bench when Bench
// holds an eligible target, and the move strip's copy names both routes to
// a target (a highlighted player on the current tab, or the other tab).
// `matchMedia` is forced to `true` here (the default `beforeEach` mock
// answers `false` to everything, pinning `useMediaQuery` to "not mobile" -
// deliberately, so the unrelated tests above never exercise this flip).
test('#1425: selecting a starter with an eligible bench target auto-switches the mobile tab to Bench', async () => {
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
  await screen.findByText('Josh Allen');
  const tabs = screen.getByTestId('lineup-mobile-tabs');
  const [startersTab, benchTab] = within(tabs).getAllByRole('button');
  expect(startersTab).toHaveAttribute('aria-pressed', 'true');

  // Derrick King (RB, unlocked): the one empty BENCH row (benchSlots: 2,
  // only Bench Guy occupies one) is an eligible target for him.
  await user.click(screen.getByTestId('slot-row-RB-0-select'));

  expect(benchTab).toHaveAttribute('aria-pressed', 'true');
  expect(startersTab).toHaveAttribute('aria-pressed', 'false');
  // Accessibility risk review finding (#1425): the activated row is now in a
  // hidden section, so the page (which owns the bar since #1965) moves focus
  // to the button the auto-switch landed on.
  expect(benchTab).toHaveFocus();
  expect(screen.getByTestId('lineup-move-strip')).toHaveTextContent(
    'Moving Derrick King. Pick a highlighted player.'
  );
});

// #1425 focus rule, page side (#1965): only an auto-switch moves focus to a bar
// button. A manager who picked Bench by hand and then selects a row that
// causes no flip keeps focus on that row.
test('#1965: selecting a row that causes no flip leaves focus on the row, not a bar button', async () => {
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
  await screen.findByText('Josh Allen');
  const [startersTab, benchTab] = within(screen.getByTestId('lineup-mobile-tabs')).getAllByRole('button');
  await user.click(benchTab);
  expect(benchTab).toHaveFocus();

  // Attested Guy (IR): the only legal targets are on the Bench view already.
  const row = screen.getByTestId('slot-row-IR-0-select');
  await user.click(row);

  expect(screen.getByTestId('lineup-move-strip')).toHaveTextContent('Moving Attested Guy.');
  expect(benchTab).toHaveAttribute('aria-pressed', 'true');
  expect(startersTab).toHaveAttribute('aria-pressed', 'false');
  expect(row).toHaveFocus();
});

// #1958 (L8), #1965: the swap strip rides the page's sticky footer, stacked
// above the phone bar, so selecting a row lower on the page neither pushes the
// list down under the finger nor leaves the strip off screen or overlapping
// the bar.
test('#1958: selecting a row shows the move strip in the sticky footer, above the bar and after the Ledger rows', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Josh Allen');

  await user.click(screen.getByTestId('slot-row-RB-0-select'));

  const strip = screen.getByTestId('lineup-move-strip');
  expect(strip).toHaveTextContent('Moving Derrick King. Pick a highlighted player.');
  const footer = screen.getByTestId('lineup-sticky-footer');
  expect(within(footer).getByTestId('lineup-move-strip')).toBe(strip);
  expect(strip.compareDocumentPosition(within(footer).getByTestId('lineup-mobile-tabs')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const lastLedgerCard = screen.getByTestId('ledger-bench');
  expect(lastLedgerCard.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(strip).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

// #1963: Escape cancels a pending move; the strip's Cancel button advertises it.
test('#1963: Escape cancels a pending move', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Josh Allen');
  await user.click(screen.getByTestId('slot-row-RB-0-select'));
  expect(screen.getByTestId('slot-row-RB-0-select')).toHaveAttribute('aria-pressed', 'true');

  await user.keyboard('{Escape}');

  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(screen.getByTestId('slot-row-RB-0-select')).toHaveAttribute('aria-pressed', 'false');
  expect(apiClient.put).not.toHaveBeenCalled();
});

test('#1963: Escape with no selection changes nothing', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Josh Allen');

  await user.keyboard('{Escape}');

  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(screen.getByTestId('slot-row-RB-0-select')).toHaveAttribute('aria-pressed', 'false');
});

test('#1963: the move strip Cancel button carries aria-keyshortcuts="Escape"', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Josh Allen');
  await user.click(screen.getByTestId('slot-row-RB-0-select'));
  expect(
    within(screen.getByTestId('lineup-move-strip')).getByRole('button', { name: 'Cancel' })
  ).toHaveAttribute('aria-keyshortcuts', 'Escape');
});

test('#1965: without a selection the sticky footer holds only the bar and is hidden from sm', async () => {
  renderPage();
  await screen.findByText('Josh Allen');
  const footer = screen.getByTestId('lineup-sticky-footer');
  expect(within(footer).queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(within(footer).getByTestId('lineup-mobile-tabs')).toBeInTheDocument();
  expect(rulesUnder(footer, '(min-width:600px)')).toContain('display: none');
});

test('#1965: pressing Outlook while a move is pending cancels the selection and shows the outlook column', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Josh Allen');
  await user.click(screen.getByTestId('slot-row-RB-0-select'));
  expect(screen.getByTestId('lineup-move-strip')).toBeInTheDocument();

  await user.click(within(screen.getByTestId('lineup-mobile-tabs')).getByRole('button', { name: 'Outlook' }));

  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(rulesUnder(screen.getByTestId('lineup-outlook-column'), '(min-width:0px)')).toContain('display: grid');
});

// #1958 (L9): below `sm` the header gives up height so the first starter sits
// higher; from `sm` up it is unchanged.
describe('#1958: team header size', () => {
  const setNarrow = (narrow) => {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: narrow,
      media: query,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  };

  test('below sm the avatar is 40px and the title 22px', async () => {
    setNarrow(true);
    renderPage();
    const heading = await screen.findByRole('heading', { level: 1, name: 'My Team' });
    expect(screen.getByTestId('lineup-team-avatar')).toHaveStyle({ width: '40px', height: '40px' });
    expect(heading).toHaveStyle({ fontSize: '22px' });
  });

  test('from sm up the avatar is 56px and the title 26px', async () => {
    setNarrow(false);
    renderPage();
    const heading = await screen.findByRole('heading', { level: 1, name: 'My Team' });
    expect(screen.getByTestId('lineup-team-avatar')).toHaveStyle({ width: '56px', height: '56px' });
    expect(heading).toHaveStyle({ fontSize: '26px' });
  });
});

// #1425 AC4: a selection with no legal target anywhere in the lineup - no
// other occupied row and no empty slot of any kind - refuses instead of
// leaving a live selection with nothing to highlight.
test('#1425: a selection with no eligible target anywhere refuses with a Snackbar and selects nothing', async () => {
  const user = userEvent.setup();
  renderPage({
    [LINEUP_URL]: {
      data: lineupBody({
        body: {
          rosterSlots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }],
          benchSlots: 0,
          irSlots: 0,
          entries: [entryRow({ id: 1, name: 'Solo QB', position: 'QB', slot: 'QB' })],
        },
      }),
    },
  });

  await user.click(await screen.findByTestId('slot-row-QB-0-select'));

  expect(mockNotify).toHaveBeenCalledWith('No eligible players for Solo QB', { severity: 'warning' });
  expect(screen.queryByTestId('lineup-move-strip')).not.toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
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
const decisionContextUrl = (playerId) => `/api/players/${playerId}/card?leagueId=1&week=4`;

test('the player name opens the Decision card with the row\'s own fields, and every section fills in once its context resolves', async () => {
  const user = userEvent.setup();
  renderPage({
    [decisionContextUrl(1)]: {
      data: {
        line: { spread: -3, total: 47, impliedTeamTotal: 22, observedAt: '2026-09-14T00:00:00Z' },
        weather: { indoor: false, temperatureF: 45, windSpeedMph: 10, windGustMph: 18, precipitationProbability: 20, shortForecast: 'Cloudy' },
        decision: {
          usage: {
            weeks: [{ season: 2026, week: 3, targets: 8, carries: 0, airYards: 90, targetShare: 0.23, fantasyPoints: 12.4 }],
            seasonAverage: { targets: 6.5, carries: 0.5, airYards: 65, targetShare: 0.21, fantasyPoints: 10.2 },
          },
        },
      },
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Josh Allen' }));

  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByRole('heading', { name: 'Josh Allen' })).toBeInTheDocument();
  // The row's own fields (AC1: paints immediately, before the extras load).
  // Formal review round 2 finding r6: this is the one page-level case that
  // must carry a genuinely populated Point estimate (Josh Allen's fixture
  // projectedPoints is 24.3), not just prove the RangeBar mounted - a
  // null-estimate subject would pass this assertion even with the number
  // broken. (#1482, formal-002-f1: the RangeBar marker reads projectedPoints,
  // not projection; this fixture keeps both equal, so the value is unchanged.)
  expect(within(card).getByTestId('decision-card-range-bar')).toHaveAttribute(
    'aria-label',
    'Josh Allen, Floor 18.0, Projection 24.3, Ceiling 30.0'
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

// ADR 0056, spec #2042: the Decision card opened from the Lineup page shows "No
// practice this week" from its own card payload's Start verdict, for the player
// whose payload says no_practice and for no one else.
test('the Decision card shows "No practice this week" for the player whose card payload reads no_practice', async () => {
  const user = userEvent.setup();
  renderPage({
    [LINEUP_URL]: {
      data: lineupBody({
        extraEntries: [entryRow({
          id: 30, name: 'Practice Guy', position: 'WR', slot: 'BENCH', nfl_team: 'NYG',
          injury_status: 'Q', projected_points: 9, projection: 9,
        })],
      }),
    },
    [decisionContextUrl(30)]: {
      data: { line: null, weather: null, usage: null, startVerdict: { outcome: 'not_recommended', reason: 'no_practice', numberTrusted: true } },
    },
    [decisionContextUrl(1)]: { data: { line: null, weather: null, usage: null } },
  });
  await user.click(await screen.findByRole('button', { name: 'Practice Guy' }));
  const card = await screen.findByTestId('decision-card');
  expect(await within(card).findByTestId('decision-card-no-practice')).toHaveTextContent('No practice this week');
  await user.click(within(card).getByTestId('decision-card-close'));
  await user.click(await screen.findByRole('button', { name: 'Josh Allen' }));
  const other = await screen.findByTestId('decision-card');
  expect(within(other).queryByTestId('decision-card-no-practice')).not.toBeInTheDocument();
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
            factorExplanation: 'Matchup +3.5',
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

test('with no Line, weather or usage from the card, those tiles are hidden - AC3\'s null-source rule', async () => {
  const user = userEvent.setup();
  renderPage(); // no decisionContextUrl mock: the card GET rejects, leaving line/weather/usage null
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
          entryRow({ id: 40, name: 'Bench RB Fast', slot: 'BENCH', position: 'RB', nfl_team: 'MIA', projected_points: 9, projection: 9 }),
          entryRow({ id: 41, name: 'Bench RB Locked', slot: 'BENCH', position: 'RB', nfl_team: 'NYJ', projected_points: 20, projection: 20, locked: true }),
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

test('Call your shot posts the pair, then the re-read advice shows the standing line (#1856)', async () => {
  const user = userEvent.setup();
  apiClient.post.mockResolvedValue({ data: { calledShot: {} } });
  renderPage({
    [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion({ probabilityBetter: 0.92 })] }) },
    [`${ADVICE_URL}&reload=1`]: {
      data: adviceBody({
        suggestions: [],
        calledShot: {
          status: 'pending', outcome: null, canWithdraw: true, probability: 0.92,
          starter: { playerId: 2, name: 'Derrick King', projection: 8, points: null },
          benched: { playerId: 10, name: 'Bench Guy', projection: 14.5, points: null },
        },
      }),
    },
  });

  await user.click(await screen.findByTestId('suggestion-call-shot'));

  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith('/api/team/lineup/called-shot', {
      leagueId: 1, week: 4, starterId: 2, benchedId: 10,
    })
  );
  const line = await screen.findByTestId('called-shot-line');
  expect(line).toHaveTextContent('Derrick King over Bench Guy');
  expect(screen.queryByTestId('suggestion-card')).not.toBeInTheDocument();
});

test('Withdraw deletes the open shot and the re-read advice drops the line (#1856)', async () => {
  const user = userEvent.setup();
  apiClient.delete.mockResolvedValue({ data: { withdrawn: true } });
  const calledShot = {
    status: 'pending', outcome: null, canWithdraw: true, probability: 0.92,
    starter: { playerId: 2, name: 'Derrick King', projection: 8, points: null },
    benched: { playerId: 10, name: 'Bench Guy', projection: 14.5, points: null },
  };
  renderPage({
    [ADVICE_URL]: { data: adviceBody({ suggestions: [], calledShot }) },
    [`${ADVICE_URL}&reload=1`]: { data: adviceBody({ suggestions: [], calledShot: null }) },
  });

  await user.click(await screen.findByTestId('called-shot-withdraw'));

  await waitFor(() =>
    expect(apiClient.delete).toHaveBeenCalledWith('/api/team/lineup/called-shot?leagueId=1&week=4')
  );
  await waitFor(() => expect(screen.queryByTestId('called-shot-line')).not.toBeInTheDocument());
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

test('the Outlook tab: the phone bar toggles which column is hidden below `sm`, both columns show from `sm` up', async () => {
  const user = userEvent.setup();
  renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) } });
  await screen.findByText('Josh Allen');

  const bar = within(screen.getByTestId('lineup-mobile-tabs'));
  const startersTab = bar.getByRole('button', { name: /^Starters/ });
  const outlookTab = bar.getByRole('button', { name: 'Outlook' });
  expect(startersTab).toHaveAttribute('aria-pressed', 'true');

  const rosterColumn = screen.getByTestId('lineup-roster-column');
  const outlookColumn = screen.getByTestId('lineup-outlook-column');

  // Starters selected by default (AC5): the Ledger shows below `sm`, the rail
  // (start-sit-panel, matchup-preview) doesn't; both already show side by
  // side from `sm` up regardless (the phone bar itself is hidden at `sm` and
  // up, so both columns must default to visible there - a real bug found in
  // mobile review left the outlook column gated on `md` instead, stranding it
  // with no way to reach it between `sm` and `md`). MUI compiles the `xs`
  // value of a responsive `sx` into `@media (min-width:0px)` rather than an
  // unconditional base rule (verified directly), so `xs` is read back under
  // that condition, not `''`.
  expect(rulesUnder(rosterColumn, '(min-width:0px)')).toContain('display: grid');
  expect(rulesUnder(outlookColumn, '(min-width:0px)')).toContain('display: none');
  expect(rulesUnder(rosterColumn, '(min-width:600px)')).toContain('display: grid');
  expect(rulesUnder(outlookColumn, '(min-width:600px)')).toContain('display: grid');

  await user.click(outlookTab);

  expect(outlookTab).toHaveAttribute('aria-pressed', 'true');
  expect(startersTab).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('start-sit-panel')).toBeInTheDocument();
  expect(rulesUnder(rosterColumn, '(min-width:0px)')).toContain('display: none');
  expect(rulesUnder(outlookColumn, '(min-width:0px)')).toContain('display: grid');

  // Back to Bench: the roster column returns and the rail hides again.
  await user.click(bar.getByRole('button', { name: /^Bench/ }));
  expect(rulesUnder(rosterColumn, '(min-width:0px)')).toContain('display: grid');
  expect(rulesUnder(outlookColumn, '(min-width:0px)')).toContain('display: none');
});

// Red-tell (measured on device, PR #1323): the page root is a flex item of
// the app shell's column flexbox with auto cross-axis margins, which turns
// off `stretch` and sizes it to its content's min-content width - the
// scrollable week strip's full 18-week run, ~1100px on a phone. Only an
// explicit `width: 100%` pins it to the viewport; jsdom lays nothing out, so
// this reads the rule itself. Dropping `width` from the root turns this red.
test('the page root is pinned to 100% width so the week strip cannot widen it inside the shell flexbox', async () => {
  renderPage();
  await screen.findByText('Josh Allen');
  const own = rulesUnder(screen.getByTestId('lineup-page'));
  expect(own).toMatch(/(^|[^-])width: 100%/);
  expect(own).toMatch(/max-width: 1180px/);
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

// #1852: the start/sit card's Game status tag, names that open the Decision
// card, and the underdog-or-favorite line off the Matchup data the page reads.
test('a Questionable player in a suggestion shows the injury tag; a healthy one shows none', async () => {
  const sug = adviceSuggestion();
  sug.suggested.availability = { available: true, status: 'Q' };
  sug.current.availability = { available: true, status: null };
  renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [sug] }) } });
  const panel = await screen.findByTestId('start-sit-panel');
  await within(panel).findByText('Bench Guy');
  const tags = within(panel).getAllByTestId('injury-tag');
  expect(tags).toHaveLength(1);
  expect(tags[0]).toHaveAttribute('data-status', 'Q');
});

test('tapping a name in the start/sit card opens the Decision card, from the Outlook tab on a phone', async () => {
  const user = userEvent.setup();
  renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) } });
  await screen.findByText('Josh Allen');
  await user.click(within(screen.getByTestId('lineup-mobile-tabs')).getByRole('button', { name: 'Outlook' }));

  const panel = screen.getByTestId('start-sit-panel');
  await user.click(await within(panel).findByRole('button', { name: 'Bench Guy' }));

  const card = await screen.findByTestId('decision-card');
  expect(within(card).getByRole('heading', { name: 'Bench Guy' })).toBeInTheDocument();
});

test('the lean line appears when the Expected finals are 10 or more apart, from the Matchup data the page loads', async () => {
  renderPage({
    [MATCHUPS_URL]: { data: [matchupRow({ home_expected_final: '88.0', away_expected_final: '100.4' })] },
    [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) },
  });
  const line = await screen.findByTestId('start-sit-lean-line');
  expect(line).toHaveTextContent('Projected to trail by 12: lean toward Ceiling');
  expect(line.textContent).not.toMatch(/range|—/i);
});

test.each(['played', 'final'])('a %s week shows no Expected final line, though the server still sends one (#2048)', async (status) => {
  renderPage({
    [MATCHUPS_URL]: { data: [matchupRow({ status, final: status === 'final', home_expected_final: '88.0', away_expected_final: '100.4' })] },
    [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) },
  });
  await screen.findByText('Bench Guy');
  expect(screen.queryByTestId('start-sit-lean-line')).not.toBeInTheDocument();
  expect(screen.queryByText(/Exp(ected)? final/i)).not.toBeInTheDocument();
});

test('the lean line favors Floor when the viewer leads by 10 or more, whichever side he is on', async () => {
  renderPage({
    [MATCHUPS_URL]: { data: [matchupRow({ home_team_id: 7, away_team_id: 3, home_expected_final: '80.0', away_expected_final: '95.0' })] },
    [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) },
  });
  expect(await screen.findByTestId('start-sit-lean-line')).toHaveTextContent('Projected to lead by 15: lean toward Floor');
});

test('no lean line in a closer Matchup, and none when the Matchup data has not loaded', async () => {
  const { unmount } = renderPage({ [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) } });
  await screen.findByText('Bench Guy');
  expect(screen.queryByTestId('start-sit-lean-line')).not.toBeInTheDocument();
  unmount();

  renderPage({
    [MATCHUPS_URL]: { data: [matchupRow({ home_expected_final: null, away_expected_final: null })] },
    [ADVICE_URL]: { data: adviceBody({ suggestions: [adviceSuggestion()] }) },
  });
  await screen.findByText('Bench Guy');
  expect(screen.queryByTestId('start-sit-lean-line')).not.toBeInTheDocument();
});

test("the week's matchups list is read once for the page, not once per surface (#1872)", async () => {
  // Order-independent: the lineup GET (which carries the week the page reads) is
  // held on a deferred promise until the widgets' matchups GET has settled, so the
  // page's own read mounts after the settle and is served by the TTL, not a reload.
  mockGetByUrl(baseUrls());
  const answer = apiClient.get.getMockImplementation();
  let releaseLineup;
  const lineupGate = new Promise((resolve) => {
    releaseLineup = resolve;
  });
  let matchupsSettled = null;
  apiClient.get.mockImplementation((url) => {
    if (url === LINEUP_URL) return lineupGate.then(() => answer(url));
    const result = answer(url);
    if (url === MATCHUPS_URL && !matchupsSettled) matchupsSettled = result.then(() => undefined);
    return result;
  });
  renderWithProviders(<LineupPage />, { route: '/team?leagueId=1', path: '/team' });

  await waitFor(() => expect(matchupsSettled).not.toBeNull());
  await matchupsSettled;
  await act(async () => {
    await Promise.resolve();
  });
  releaseLineup();

  await screen.findByTestId('ledger-starters');
  expect(apiClient.get.mock.calls.filter(([url]) => url === MATCHUPS_URL)).toHaveLength(1);
});
