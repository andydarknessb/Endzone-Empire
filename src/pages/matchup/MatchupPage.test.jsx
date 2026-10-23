/* eslint-disable testing-library/no-node-access -- reads emotion rules, the position tag and the checked segment glyph, none of which has a role or a name */
import React from 'react';
import { screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import supabase from '../../api/supabaseClient';
import { useLeague } from '../../hooks/useLeague';
import { invalidate } from '../../lib/resourceCache';
import { matchupViewStorageKey } from '../../features/toggle-matchup-view';
import MatchupPage from './index';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The anon Supabase client the entity hook reads live game states through
// (#885). Its initial read answers from `liveGameRows`; the channel is inert.
jest.mock('../../api/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

jest.mock('../../hooks/useLeague', () => ({
  useLeague: jest.fn(),
}));

// The rows each lineup view is handed (#2147): the two wrappers record the
// `rows` prop of every render and render the real widget, so a test reads what
// the page gave each view without changing what either draws.
const mockHandedRows = { retro: [], comparison: [] };
jest.mock('../../widgets/retro-scoreboard', () => {
  const actual = jest.requireActual('../../widgets/retro-scoreboard');
  const Actual = actual.default;
  const Spy = (props) => {
    mockHandedRows.retro.push(props.rows);
    return <Actual {...props} />;
  };
  return { __esModule: true, ...actual, default: Spy };
});
jest.mock('../../widgets/slot-comparison', () => {
  const actual = jest.requireActual('../../widgets/slot-comparison');
  const Actual = actual.default;
  const Spy = (props) => {
    mockHandedRows.comparison.push(props.rows);
    return <Actual {...props} />;
  };
  return { __esModule: true, ...actual, default: Spy };
});

let liveGameRows = [];
function installSupabase() {
  const inFn = jest.fn().mockImplementation((column, ids) => Promise.resolve({
    data: liveGameRows.filter((r) => ids.includes(r.tank01_game_id)),
    error: null,
  }));
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  const channelObj = { on: jest.fn(() => channelObj), subscribe: jest.fn((cb) => { cb?.('SUBSCRIBED'); return channelObj; }) };
  supabase.channel.mockReturnValue(channelObj);
}

const renderPage = (leagueId = 1, matchupId = 9, options = {}) =>
  renderWithProviders(<MatchupPage />, {
    path: '/league/:leagueId/matchups/:matchupId',
    route: `/league/${leagueId}/matchups/${matchupId}`,
    ...options,
  });

const starter = (overrides = {}) => ({
  id: 5,
  name: 'P. Mahomes',
  position: 'QB',
  nfl_team: 'KC',
  injury_status: null,
  slot: 'QB',
  points: 24.1,
  ...overrides,
});

// The detail body GET /api/league/:id/matchups/:matchupId delivers: { matchup,
// home, away }, the score on the matchup and each side's identity/figures on
// the per-side object (the shape the entity's matchupFromDetailBody reads).
// `status` is the server's status fact (ADR 0030): it defaults to 'live' (an
// in-progress matchup) and to 'final' when `final` is overridden true, so a
// fixture reads truthfully without every test spelling it out. The viewer is
// Team 1 (the home side) unless a test says otherwise.
const matchupResponse = (overrides = {}) => {
  const m = overrides.matchup || {};
  const final = m.final ?? false;
  // `'status' in m` (not `??`) so a test can force `status: null` - the exact
  // "server could not compute it" case (ADR 0030) - without the default
  // reclaiming it.
  const status = 'status' in m ? m.status : (final ? 'final' : 'live');
  return {
    data: {
      viewerTeamId: 'viewerTeamId' in overrides ? overrides.viewerTeamId : 1,
      viewerWhatIf: overrides.viewerWhatIf,
      nflGameIds: overrides.nflGameIds || [],
      matchup: {
        id: 9,
        week: 3,
        season: 2026,
        home_score: '101.5',
        away_score: '88',
        is_playoff: false,
        home_team_name: 'Team A',
        away_team_name: 'Team B',
        ...m,
        final,
        status,
      },
      home: {
        teamId: 1,
        name: 'Team A',
        starters: overrides.homeStarters || [starter()],
        bench: overrides.homeBench || [],
        ...overrides.home,
      },
      away: {
        teamId: 2,
        name: 'Team B',
        starters: overrides.awayStarters || [starter({ id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', points: 15.4 })],
        bench: overrides.awayBench || [],
        ...overrides.away,
      },
    },
  };
};

const MATCHUP_URL = '/api/league/1/matchups/9';

// Every GET the page issues, answered by URL: the detail body, the touchdown
// celebration preference, the standings (records) and, when a test hands one
// in, the hindsight read. A player's Decision card read
// (`/api/players/:id/card`) falls through to the empty-object default, same
// as any other unlisted URL - PlayerDecisionCard's own suite covers its
// payload handling; this page's tests only need the request to resolve.
function mockApi({
  matchup = matchupResponse(), prefs = { touchdownCelebrations: true }, standings = [], hindsight, advice = {}, actionItems = [],
} = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/user/action-items')) return Promise.resolve({ data: { items: actionItems } });
    if (url.startsWith('/api/team/lineup/advice')) return Promise.resolve({ data: advice });
    if (url.startsWith('/api/league/') && url.includes('/matchups/')) return Promise.resolve(matchup);
    if (url === '/api/notifications/prefs') return Promise.resolve({ data: prefs });
    if (url.endsWith('/standings')) return Promise.resolve({ data: { standings } });
    if (url.includes('/api/team/hindsight')) {
      if (typeof hindsight === 'function') return hindsight(url);
      return Promise.reject({ response: { status: 404 } });
    }
    return Promise.resolve({ data: {} });
  });
}

// Drive live updates through the app's own socket factory hook
// (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js): the entity
// hook's score feed builds its socket through createDraftSocket, so installing
// this factory hands the feed a controllable fake, exactly as the legacy page
// test did.
function makeFakeSocket() {
  const handlers = {};
  const ioHandlers = {};
  return {
    emit: jest.fn(),
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    io: {
      on: jest.fn((event, cb) => { ioHandlers[event] = cb; }),
      off: jest.fn(),
    },
    disconnect: jest.fn(),
    fire: (event, payload) => handlers[event]?.(payload),
    reconnect: () => ioHandlers.reconnect?.(),
  };
}

let socket;
let mobile;
let reducedMotion;

const emitScores = (payload) => act(() => { socket.fire('scores:updated', payload); });

const LEAGUE = {
  id: 1,
  name: 'Sunday Ballers',
  draft_status: 'complete',
  season_status: 'regular',
  current_season: 2026,
  current_week: 3,
  // The league's roster_slots are the pairing order the entity needs; without
  // them the lineup views render no rows (pairing refuses an empty order).
  roster_slots: [
    { key: 'QB' }, { key: 'RB' }, { key: 'WR' }, { key: 'TE' },
    { key: 'FLEX' }, { key: 'K' }, { key: 'DEF' },
  ],
};

beforeEach(() => {
  // Clear every shared resource cache (ADR 0004): the week-keyed standings
  // are module state and outlive a test.
  invalidate(undefined, { reload: false });
  window.localStorage.clear();
  mobile = false;
  reducedMotion = false;
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
    socket = makeFakeSocket();
    return socket;
  };
  // Every media query the page and its slices read goes through matchMedia:
  // the theme's `sm` breakpoint (a max-width) reads `mobile`, reduced motion
  // reads `reducedMotion`, and the rest read false.
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query) ? mobile : /reduced-motion/.test(query) ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  liveGameRows = [];
  installSupabase();
  useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: 1, loading: false, error: null });
  mockApi();
});

afterEach(() => {
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
  jest.clearAllMocks();
});

const strip = () => screen.getByTestId('scoreboard-strip');
const stripScores = () => within(strip()).getAllByTestId('scoreboard-score').map((el) => el.textContent);
const statusChip = () => screen.queryByTestId('matchup-status-chip');
const slotOrder = () => screen.getAllByTestId('slot-row').map((row) => row.querySelector('[data-position]').textContent);
const toScoreboard = () => userEvent.click(screen.getByRole('radio', { name: 'Scoreboard' }));
const toStandard = () => userEvent.click(screen.getByRole('radio', { name: 'Standard' }));
const matchupFetches = () => apiClient.get.mock.calls.filter(([url]) => url === MATCHUP_URL);
const hindsightFetches = () => apiClient.get.mock.calls.filter(([url]) => url.includes('/api/team/hindsight'));
// Document order, the one layout fact jsdom can read.
const precedes = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class
// (the retro-scoreboard widget's test reads its breakpoint rules the same
// way). This gathers the declarations of every rule whose selector starts
// with that class, keyed by the selector's tail with its whitespace removed
// ('' for the element's own rule, '[role="radio"]' or '>:first-of-type' for
// a descendant rule).
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

// --- loading, error, structure ---------------------------------------------

test('shows an aria-busy loading region before data arrives', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderPage();
  const region = screen.getByTestId('matchup-loading');
  expect(region).toHaveAttribute('aria-busy', 'true');
  expect(within(region).getAllByTestId('skeleton').length).toBeGreaterThan(0);
});

test('shows an error alert when the fetch fails', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { error: 'matchup not found' } } });
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('We could not load this matchup right now.');
});

// #2009: the error state is no dead end - Retry re-runs the detail read through
// the entity's refetch, and a link leads back to the league's Game Center.
test('a 500 on the detail read offers Retry, and Retry with a good read renders the Starters table', async () => {
  const ok = matchupResponse();
  let calls = 0;
  mockApi();
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation((url) => {
    if (url !== MATCHUP_URL) return base(url);
    calls += 1;
    return calls === 1 ? Promise.reject({ response: { status: 500, data: { error: 'boom' } } }) : Promise.resolve(ok);
  });
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('We could not load this matchup right now.');
  expect(screen.queryByRole('heading', { level: 2, name: 'Starters' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { level: 2, name: 'Starters' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Week 3 Matchup' })).toHaveFocus();
});

test("the error state links back to the league's Game Center", async () => {
  apiClient.get.mockRejectedValue({ response: { status: 500, data: { error: 'boom' } } });
  renderPage();

  await screen.findByRole('alert');
  expect(screen.getByRole('link', { name: 'Back to Game Center' })).toHaveAttribute('href', '/league/1/game-center');
});

// A failed resync leaves the box score on screen with the alert above it:
// Retry then refreshes without swapping the page for the skeleton, and a good
// read hands focus to the h1 (the Retry button unmounts under the pointer).
test('Retry on a failed resync keeps the box score on screen and focuses the h1 once the read succeeds', async () => {
  renderPage();
  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation((url) => (
    url === MATCHUP_URL ? Promise.reject({ response: { status: 500, data: { error: 'boom' } } }) : base(url)
  ));
  act(() => { socket.reconnect(); });
  const alert = await screen.findByRole('alert');
  expect(screen.getByTestId('slot-comparison')).toBeInTheDocument();

  let release;
  const held = new Promise((resolve) => { release = () => resolve(matchupResponse()); });
  apiClient.get.mockImplementation((url) => (url === MATCHUP_URL ? held : base(url)));
  await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

  // Mid-read: the box score is still there, no skeleton.
  expect(screen.queryByTestId('matchup-loading')).not.toBeInTheDocument();
  expect(screen.getByTestId('slot-comparison')).toBeInTheDocument();
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Week 3 Matchup' })).toHaveFocus());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// A code+message envelope with no `error` key (the shape the global express error handler and the rate
// limiter emit) still shows the alert, in the page's own words ("We could not load ...", never a raw server
// sentence), with a ghost Retry.
test('a code+message envelope failure shows the same alert, in the page\'s own words, with a ghost Retry', async () => {
  apiClient.get.mockRejectedValue({ response: { data: { code: 'MATCHUP_DOWN', message: 'the box score is briefly unavailable' } } });
  renderPage();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('We could not load this matchup right now.');
  expect(alert).not.toHaveTextContent('briefly unavailable');
  const retryButton = within(alert).getByRole('button', { name: 'Retry' });
  expect(rulesUnder(retryButton)['']).toMatch(/border:\s*2px solid/);
  expect(filledActions()).toBe(0);
});

test('renders the header, both teams\' starters with points, and the strip\'s scores', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: 'Starters' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Bench' })).toBeInTheDocument();

  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const breadcrumbList = within(nav).getByRole('list');
  expect(breadcrumbList).toHaveAttribute('role', 'list');
  expect(within(nav).getByRole('link', { name: 'Sunday Ballers' })).toHaveAttribute('href', '/league/1');
  expect(within(nav).getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/1/game-center');
  // The current page ends the trail, as the Game Center breadcrumb ends on
  // its own page (#903 review). Red-tell: dropping the crumb, or its
  // aria-current, turns this red.
  expect(within(nav).getByText('Matchup')).toHaveAttribute('aria-current', 'page');
  expect(within(nav).queryByRole('link', { name: 'Matchup' })).not.toBeInTheDocument();

  // The column is the boards' 1280px (Matchup.dc.html).
  expect(rulesUnder(screen.getByTestId('matchup-column'))['']).toMatch(/max-width:\s*1280px/);

  expect(stripScores()).toEqual(['101.5', '88.0']);
  expect(within(strip()).getByTestId('scoreboard-side-home')).toHaveTextContent('Team A');
  expect(within(strip()).getByTestId('scoreboard-side-away')).toHaveTextContent('Team B');
  // The viewer (Team 1) is the home side.
  expect(within(strip()).getByTestId('scoreboard-side-home')).toHaveAttribute('data-viewer-team', 'true');

  const table = screen.getByTestId('slot-comparison');
  expect(within(table).getByRole('button', { name: 'P. Mahomes' })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: 'D. Adams' })).toBeInTheDocument();
  const points = within(table).getAllByTestId('slot-points').map((el) => el.textContent);
  expect(points).toEqual(['24.1 pts', '15.4 pts']);

  // Set lineup links to the Lineup page (ADR 0019) from the header on desktop (by test id: the
  // viewer's open WR slot in the table carries its own Set lineup link, #2008).
  expect(screen.getByTestId('set-lineup')).toHaveAttribute('href', '/league/1/lineup');
  expect(screen.getByTestId('set-lineup')).toHaveAttribute('data-placement', 'header');
  expect(screen.queryByTestId('matchup-playoff-chip')).not.toBeInTheDocument();

  // House style: no em dash and no emoji anywhere on the page.
  expect(document.body.textContent).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
});

test('a playoff matchup carries the Playoff chip, and the record comes from the standings read', async () => {
  mockApi({
    matchup: matchupResponse({ matchup: { is_playoff: true } }),
    standings: [
      { teamId: 1, wins: 3, losses: 1, ties: 0 },
      { teamId: 2, wins: 2, losses: 2, ties: 0 },
    ],
  });
  renderPage();

  expect(await screen.findByTestId('matchup-playoff-chip')).toHaveTextContent('Playoff');
  await waitFor(() => expect(within(strip()).getByTestId('scoreboard-side-home')).toHaveTextContent('3-1'));
  expect(within(strip()).getByTestId('scoreboard-side-away')).toHaveTextContent('2-2');
  expect(apiClient.get.mock.calls.filter(([url]) => url.endsWith('/standings'))).toHaveLength(1);
});

// --- the status chip: the server's fact, from the fetch alone (ADR 0030) -----

test('a scheduled matchup reads Scheduled, and the Scoreboard view shows no WIN digits', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: 'scheduled', home_score: '0', away_score: '0' } }) });
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Scheduled');
  expect(statusChip()).toHaveAttribute('data-variant', 'neutral');
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();

  // The Scoreboard view follows the same started state (#903 review): no WIN
  // row on the board, and the field's image says the probability is not yet
  // available. Red-tell: feeding the board the page's probability regardless
  // of status turns this red.
  await toScoreboard();
  expect(screen.queryByTestId('led-win')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('led-board')).queryByText('WIN')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /^Field position/ })).toHaveAccessibleName('Field position: win probability not yet available');
});

// A final matchup states the result on both views (#2007), from the viewer's
// side: the page hands the strip and the board the same viewer Team id.
test('a final matchup reads the result line on the strip and on the LED board', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { final: true, home_score: '115.9', away_score: '109.7' } }) });
  renderPage();

  expect(await screen.findByTestId('scoreboard-result')).toHaveTextContent('You won by 6.2');
  expect(screen.queryByRole('img', { name: /win probability$/ })).not.toBeInTheDocument();

  await toScoreboard();
  expect(screen.getByTestId('led-result')).toHaveTextContent('You won by 6.2');
  expect(screen.queryByTestId('led-win')).not.toBeInTheDocument();
});

// The LIVE chip comes from the fetched status alone: no socket event is fired
// here. Red-tell: forcing the predicate to return Scheduled for `live` turns
// this case red and no other.
test('a live matchup reads LIVE from the fetch alone, with no socket event', async () => {
  renderPage();

  // The live state is the LiveChip on the h1 row, and the page says Live once.
  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Live');
  expect(statusChip()).toHaveAttribute('data-variant', 'danger');
  expect(screen.getAllByText('Live')).toHaveLength(1);
  expect(screen.queryByText('Awaiting final')).not.toBeInTheDocument();
  // One announced win probability image, naming both teams, and the one Forecast credit.
  expect(screen.getAllByRole('img', { name: /win probability$/ })).toHaveLength(1);
  expect(screen.getAllByText('Endzone Forecast')).toHaveLength(1);
  expect(screen.queryByText(/Live win probability/)).not.toBeInTheDocument();
});

// Triage #872/#887's page-level promise: on the composed page ONE announced
// Win probability image and the plain "Win probability" caption (never "Live
// win probability"). The retro field's image is named "Field position: ...",
// so nothing else can double it. A settled matchup (played or final) states
// the result instead (#2007), so it exposes no Win probability at all.
test.each(['played', 'final'])('a %s matchup exposes no Win probability image or caption, only the result line', async (status) => {
  mockApi({ matchup: matchupResponse({ matchup: { status, final: status === 'final', home_score: '99', away_score: '92' } }) });
  renderPage();

  await screen.findByTestId('matchup-status-chip');
  expect(screen.queryByRole('img', { name: /win probability$/ })).not.toBeInTheDocument();
  expect(within(strip()).queryByText(/Win probability/)).not.toBeInTheDocument();
  expect(screen.getByTestId('scoreboard-result')).toHaveTextContent(status === 'played' ? 'Unofficial: You won by 7.0' : 'You won by 7.0');
});

// A played (games done, not finalised) matchup reads "Awaiting final", never a
// guessed LIVE, and the strip says the SAME thing as the header.
test('a played matchup reads Awaiting final in the header, never Not started or LIVE', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: 'played', home_score: '99', away_score: '92' } }) });
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Awaiting final');
  expect(screen.getAllByText('Awaiting final')).toHaveLength(1);
  expect(statusChip()).toHaveAttribute('data-variant', 'warning');
  expect(screen.queryByText('Not started')).not.toBeInTheDocument();
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
});

test('a final matchup reads Final', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { final: true } }) });
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Final');
  expect(statusChip()).toHaveAttribute('data-variant', 'success');
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
});

// A status the server could not compute is null: no chip anywhere (not the
// header's, not the strip's), and never a false "Not started".
test('a null-status matchup shows no chip anywhere and never Not started', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: null } }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
  expect(statusChip()).not.toBeInTheDocument();
  expect(screen.queryByText('Not started')).not.toBeInTheDocument();
  expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /win probability$/ })).not.toBeInTheDocument();
});

// --- the live feed: one model update reaches the DOM ----------------------

test('a scores:updated event moves the strip\'s score, Expected final, players remaining and chip with no refetch', async () => {
  const response = matchupResponse({ matchup: { status: 'scheduled' } });
  response.data.home.expectedFinal = 120.5;
  response.data.home.playersRemaining = 4;
  response.data.away.expectedFinal = 97.25;
  response.data.away.playersRemaining = 2;
  mockApi({ matchup: response });
  renderPage();

  await screen.findByTestId('scoreboard-strip');
  // Before kickoff the big figures are the Proj (the Expected final), not a 0.0 score.
  expect(stripScores()).toEqual(['120.5', '97.3']);
  expect(statusChip()).toHaveTextContent('Scheduled');
  expect(screen.getByText('4 starters set to play')).toBeInTheDocument();
  expect(screen.getByText('2 starters set to play')).toBeInTheDocument();

  emitScores({
    scored: [{
      matchupId: 9, homeScore: 110, awayScore: 90, status: 'played',
      homeExpectedFinal: 130.2, awayExpectedFinal: 96.4, homePlayersRemaining: 3, awayPlayersRemaining: 1,
    }],
  });

  expect(stripScores()).toEqual(['110.0', '90.0']);
  // Played settles the strip (#2007): the figures give way to the result line.
  expect(within(strip()).queryByText(/starters set to play|players remaining/)).not.toBeInTheDocument();
  expect(screen.getByTestId('scoreboard-result')).toHaveTextContent('Unofficial: You won by 20.0');
  expect(statusChip()).toHaveTextContent('Awaiting final');
  expect(matchupFetches()).toHaveLength(1);
});

test('a scores:updated for a different matchupId leaves the displayed scores unchanged', async () => {
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  emitScores({ scored: [{ matchupId: 999, homeScore: 200, awayScore: 200 }] });

  expect(stripScores()).toEqual(['101.5', '88.0']);
});

test('joins the league room on mount and disconnects on unmount', async () => {
  const { unmount } = renderPage(42, 9);
  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });

  expect(socket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });

  unmount();
  expect(socket.disconnect).toHaveBeenCalled();
});

test('re-joins the league room and refetches the matchup when the manager reconnects, without blanking the page', async () => {
  renderPage(42, 9);
  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
  socket.emit.mockClear();
  const callsBeforeReconnect = apiClient.get.mock.calls.length;

  act(() => { socket.reconnect(); });

  expect(socket.emit).toHaveBeenCalledWith('league:join', { leagueId: 42 });
  // A dropped connection means missed play deltas never reached the client, so
  // rows can drift from the authoritative total: reconnect refetches.
  await waitFor(() =>
    expect(apiClient.get.mock.calls.length).toBeGreaterThan(callsBeforeReconnect)
  );
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/42/matchups/9');
  expect(screen.queryByTestId('matchup-loading')).not.toBeInTheDocument();
  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
});

// --- the view toggle -------------------------------------------------------

test('the toggle swaps the views: Scoreboard mounts the retro board, Standard restores the Starters table', async () => {
  renderPage();
  await screen.findByTestId('slot-comparison');
  expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
  expect(screen.queryByTestId('retro-scoreboard')).not.toBeInTheDocument();

  await toScoreboard();
  expect(screen.getByRole('radio', { name: 'Scoreboard' })).toBeChecked();
  expect(screen.getByTestId('retro-scoreboard')).toBeInTheDocument();
  expect(screen.queryByTestId('slot-comparison')).not.toBeInTheDocument();
  // The retro view's cards sit one level under the h1, and the board and the
  // field's end zone both carry the Team names uppercased.
  expect(screen.getByRole('heading', { level: 2, name: 'Lineups' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Games' })).toBeInTheDocument();
  expect(screen.getAllByText('TEAM A').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('TEAM B').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('P. Mahomes')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'P. Mahomes' })).not.toBeInTheDocument();
  // The home win probability reaches the accessibility tree once in this view
  // (#903 review): the field image names it, and the board's WIN row is its
  // aria-hidden visible duplicate.
  expect(screen.getByTestId('led-win')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getAllByRole('img', { name: /likely to win|Win probability/ })).toHaveLength(1);
  // The field's caption tail carries the celebrate-touchdown feature's
  // read-only line, on by default.
  expect(within(screen.getByTestId('field-caption')).getByTestId('celebrations-caption')).toHaveTextContent('Celebrations on');

  // The Lineups card's Full comparison action switches back too, and moves
  // keyboard focus onto the toggle's checked Standard option: its own button
  // unmounts with the view. Red-tell: dropping the focus move leaves
  // document.activeElement on the body and turns this red.
  await userEvent.click(screen.getByRole('button', { name: 'Full comparison' }));
  expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
  expect(screen.getByTestId('slot-comparison')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Standard' })).toHaveFocus();

  await toScoreboard();
  await toStandard();
  expect(screen.getByRole('button', { name: 'P. Mahomes' })).toBeInTheDocument();
  expect(screen.queryByTestId('retro-scoreboard')).not.toBeInTheDocument();
});

// #2147: the retro scoreboard reads the Matchup entity's normalised player rows
// (`playerFromDetailRow`), while the Slot comparison, the Decision card lookup
// and the live deltas stay on the wire shape `useMatchup` returns. Red-tell:
// handing the raw rows to RetroScoreboard turns the first block red (no
// `playerId`, `photoUrl`); normalising where `useMatchup` returns them turns
// the second red (the Slot comparison loses `id` and `photo_url`).
test('the scoreboard gets normalised player rows while the Slot comparison keeps the wire rows', async () => {
  mockHandedRows.retro.length = 0;
  mockHandedRows.comparison.length = 0;
  mockApi({
    matchup: matchupResponse({
      homeStarters: [starter({
        id: 5, photo_url: 'https://cdn.example/mahomes.png', game_state: 'in_progress', game_clock: 'Q3 7:22',
        projected: 21.5, injury_status: 'Q',
      })],
      awayStarters: [starter({
        id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', nfl_team: 'LV', points: 0, projected: 12,
        game_state: 'scheduled', game_clock: null, photo_url: null,
      })],
    }),
  });
  renderPage();
  await screen.findByTestId('slot-comparison');
  await toScoreboard();
  await screen.findByTestId('retro-scoreboard');

  const handed = (list) => list[list.length - 1];
  const standardRows = handed(mockHandedRows.comparison);
  expect(standardRows).toHaveLength(2);
  expect(standardRows[0].first).toMatchObject({
    id: 5, nfl_team: 'KC', photo_url: 'https://cdn.example/mahomes.png', injury_status: 'Q', points: 24.1,
  });
  expect(standardRows[0].first).not.toHaveProperty('playerId');
  expect(standardRows[1].second).toMatchObject({ id: 6, game_state: 'scheduled', points: 0 });

  const retroRows = handed(mockHandedRows.retro);
  expect(retroRows).toHaveLength(2);
  expect(retroRows[0].first).toMatchObject({
    playerId: 5, nflTeam: 'KC', photoUrl: 'https://cdn.example/mahomes.png', injuryStatus: 'Q',
    gameState: 'in_progress', gameClock: 'Q3 7:22', projectedPoints: 21.5, points: 24.1,
  });
  expect(retroRows[0].first).not.toHaveProperty('photo_url');
  expect(retroRows[0].first).not.toHaveProperty('id');
  // A side nobody filled stays null, and a scheduled player has no points yet.
  expect(retroRows[0].second).toBeNull();
  expect(retroRows[1].first).toBeNull();
  expect(retroRows[1].second).toMatchObject({ playerId: 6, gameState: 'scheduled', points: null });
});

// The choice is remembered per VIEWER under the signed-in user's id: a second
// signed-in manager on the same browser starts on Standard, and the first
// finds Scoreboard again on remount. Red-tell: READING the remembered view
// from a key other than the user's turns this case red (the second manager
// would inherit Scoreboard, or the first would lose it) and no other.
test('the toggle\'s choice survives a remount for the same signed-in viewer and never leaks to another', async () => {
  const first = { state: { user: { id: 77, username: 'first' } } };
  const { unmount } = renderPage(1, 9, first);
  await screen.findByTestId('slot-comparison');
  await toScoreboard();
  expect(screen.getByTestId('retro-scoreboard')).toBeInTheDocument();
  expect(window.localStorage.getItem(matchupViewStorageKey(77))).toBe('scoreboard');
  unmount();

  // Another signed-in manager (Team 2, user 88) on the same browser.
  mockApi({ matchup: matchupResponse({ viewerTeamId: 2 }) });
  useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: 2, loading: false, error: null });
  const { unmount: unmountSecond } = renderPage(1, 9, { state: { user: { id: 88, username: 'second' } } });
  await screen.findByTestId('scoreboard-strip');
  expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
  expect(screen.getByTestId('slot-comparison')).toBeInTheDocument();
  expect(screen.queryByTestId('retro-scoreboard')).not.toBeInTheDocument();
  unmountSecond();

  // The first manager again.
  mockApi();
  useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: 1, loading: false, error: null });
  renderPage(1, 9, first);
  expect(await screen.findByTestId('retro-scoreboard')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Scoreboard' })).toBeChecked();
});

// The cold-load case (#903 review): the key is the user id, on hand at first
// paint, so a remembered Scoreboard view is read on the first paint and holds
// once the detail body (and with it the viewer's Team id) lands. Red-tell:
// keying off the Team id (the detail body's viewerTeamId, or the league
// read's) turns this red: the choice stored under the user key is never
// read, so the page starts on Standard, and a key that lands later flips the
// view after first paint. The Team id never names a storage entry.
test('a remembered Scoreboard view is read on the first paint under the user key and never flips once the Team id lands', async () => {
  window.localStorage.setItem(matchupViewStorageKey(77), 'scoreboard');
  renderPage(1, 9, { state: { user: { id: 77, username: 'viewer' } } });

  expect(await screen.findByTestId('retro-scoreboard')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Scoreboard' })).toBeChecked();
  // The detail body has landed (the viewer is Team 1, the home side) and the
  // view has not flipped.
  await screen.findByTestId('lineups-card');
  expect(screen.getByTestId('retro-scoreboard')).toBeInTheDocument();
  expect(screen.queryByTestId('slot-comparison')).not.toBeInTheDocument();
  expect(Object.keys(window.localStorage).filter((k) => /team/.test(k))).toEqual([]);
});

test('a viewer with no Team in the league keys the remembered view by the signed-in user too', async () => {
  mockApi({ matchup: matchupResponse({ viewerTeamId: null }) });
  useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: null, loading: false, error: null });
  renderPage(1, 9, { state: { user: { id: 77, username: 'viewer' } } });
  await screen.findByTestId('slot-comparison');
  await toScoreboard();
  expect(window.localStorage.getItem(matchupViewStorageKey(77))).toBe('scoreboard');
  expect(Object.keys(window.localStorage)).toEqual([matchupViewStorageKey(77)]);
});

test('with no signed-in user id the choice is remembered under the per-browser anon key, never the Team id', async () => {
  renderPage();
  await screen.findByTestId('slot-comparison');
  await toScoreboard();
  expect(window.localStorage.getItem(matchupViewStorageKey(null))).toBe('scoreboard');
  expect(Object.keys(window.localStorage)).toEqual(['endzone.matchupView.anon']);
});

// --- the same paired rows in both views (IDP) ------------------------------

// The Starters table and the retro view's Lineups card are two renderings of
// the ONE paired row list the entity produces, so under an IDP slot order they
// show the same slots in the same order. The starters are fed in a
// deliberately non-slot order; consuming the paired rows yields the league
// order, while sorting a rendering by array index would yield the input order.
// Red-tell: index-sorting either rendering breaks this test and no other.
test('the Starters table and the retro Lineups card render the same paired rows in the same order (IDP)', async () => {
  reducedMotion = true;
  useLeague.mockReturnValue({
    league: {
      ...LEAGUE,
      name: 'IDP League',
      roster_slots: [
        { key: 'QB' }, { key: 'RB' }, { key: 'WR' }, { key: 'DL' }, { key: 'LB' }, { key: 'DB' },
      ],
    },
    viewerTeamId: 1,
    loading: false,
    error: null,
  });
  mockApi({
    matchup: matchupResponse({
      // Input order (DB, QB, DL, LB) is NOT the slot order: pairing must reorder.
      homeStarters: [
        starter({ id: 1, name: 'Derwin James', slot: 'DB', position: 'DB' }),
        starter({ id: 2, name: 'Josh Allen', slot: 'QB', position: 'QB' }),
        starter({ id: 3, name: 'Myles Garrett', slot: 'DL', position: 'DL' }),
        starter({ id: 4, name: 'Fred Warner', slot: 'LB', position: 'LB' }),
      ],
      awayStarters: [
        starter({ id: 5, name: 'Micah Parsons', slot: 'DL', position: 'DL' }),
      ],
    }),
  });
  renderPage();

  await screen.findByTestId('slot-comparison');
  const standardOrder = slotOrder();
  expect(standardOrder).toEqual(['QB', 'DL', 'LB', 'DB']);

  await toScoreboard();
  await screen.findByTestId('lineups-card');
  expect(slotOrder()).toEqual(standardOrder);
});

// --- injury designations and row expansion -----------------------------------

// The legacy suite's "renders an injury badge for a flagged starter": the code
// beside the name in the Starters table, the retro Lineups card and the Bench
// card, with the designation as its spoken text; a healthy player shows none.
test('a flagged starter carries his injury designation in both views, and a flagged bench player on the bench', async () => {
  reducedMotion = true;
  mockApi({
    matchup: matchupResponse({
      homeStarters: [starter({ injury_status: 'Q' })],
      homeBench: [{ id: 20, name: 'Bench Runner', position: 'RB', points: 0, projected: 4.1, injury_status: 'IR' }],
    }),
  });
  renderPage();

  const table = await screen.findByTestId('slot-comparison');
  expect(within(table).getByText('Q')).toBeInTheDocument();
  expect(within(table).getByTestId('injury-tag')).toHaveAttribute('data-status', 'Q');
  expect(within(table).getByText('Injury status: Questionable')).toBeInTheDocument();
  // The healthy away starter carries none.
  expect(within(table).getAllByTestId('injury-tag')).toHaveLength(1);

  await toScoreboard();
  const lineups = await screen.findByTestId('lineups-card');
  expect(within(lineups).getByTestId('injury-tag')).toHaveAttribute('data-status', 'Q');
  expect(within(lineups).getByText('Q')).toBeInTheDocument();
  await toStandard();

  await userEvent.click(within(screen.getByTestId('bench-card')).getByRole('button', { name: 'Show benches' }));
  const bench = within(screen.getByTestId('bench-home'));
  expect(bench.getByTestId('injury-tag')).toHaveAttribute('data-status', 'IR');
  expect(bench.getByText('IR')).toBeInTheDocument();
  expect(bench.getByText('Injury status: Injured reserve')).toBeInTheDocument();
});

// The page owns the expanded row (#883's page-level cases): a starter's
// control opens his stat line with the pace bar and projection, an
// Unavailable starter's shows his reason and no bar, and the same control
// closes it again.
test('expanding a starter row shows his stat line and pace, an Unavailable one his reason without a bar, and expanding again collapses', async () => {
  mockApi({
    matchup: matchupResponse({
      homeStarters: [starter({ projected: 21.4, stats: { passingYards: 289, passingTDs: 2 } })],
      awayStarters: [starter({
        id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', points: 0, projected: 12.2,
        availability: { available: false, reason: 'bye' },
      })],
    }),
  });
  renderPage();

  const table = await screen.findByTestId('slot-comparison');
  expect(screen.queryByTestId('slot-expanded')).not.toBeInTheDocument();

  await userEvent.click(within(table).getByRole('button', { name: 'Stats for P. Mahomes' }));
  const strip = screen.getByTestId('slot-expanded');
  expect(strip).toHaveTextContent('289 pass yds · 2 pass TD');
  expect(strip).toHaveTextContent('24.1 / 21.4 proj');
  expect(within(table).getByRole('button', { name: 'Stats for P. Mahomes' })).toHaveAttribute('aria-expanded', 'true');

  // The other starter's control opens his row and closes the first.
  await userEvent.click(within(table).getByRole('button', { name: 'Stats for D. Adams' }));
  expect(screen.getAllByTestId('slot-expanded')).toHaveLength(1);
  const byeStrip = screen.getByTestId('slot-expanded');
  expect(within(byeStrip).getByTestId('unavailable-reason')).toHaveTextContent('on bye');
  expect(byeStrip).not.toHaveTextContent('proj');
  expect(within(table).getByRole('button', { name: 'Stats for P. Mahomes' })).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(within(table).getByRole('button', { name: 'Stats for D. Adams' }));
  expect(screen.queryByTestId('slot-expanded')).not.toBeInTheDocument();
});

// --- touchdowns: the celebrate-touchdown feature -----------------------------

test("a touchdown by the viewer's starter queues a cutscene, and an opponent's is a toast", async () => {
  reducedMotion = true;
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  emitScores({
    week: 3,
    scored: [{ matchupId: 9, homeScore: 107.5, awayScore: 88 }],
    plays: [{
      playerId: 5, name: 'P. Mahomes', position: 'QB', nflTeam: 'KC', opponent: 'BUF',
      type: 'passing', isTouchdown: true, pointsDelta: 6,
    }],
  });

  expect(screen.getByRole('alertdialog', { name: 'Touchdown, P. Mahomes, +6 points' })).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  // The optimistic per-starter bump reaches the Starters table too.
  expect(within(screen.getByTestId('slot-comparison')).getAllByTestId('slot-points')[0]).toHaveTextContent('30.1');

  emitScores({
    week: 3,
    scored: [{ matchupId: 9, homeScore: 107.5, awayScore: 94.4 }],
    plays: [{
      playerId: 6, name: 'D. Adams', position: 'WR', nflTeam: 'LV', opponent: 'DEN',
      type: 'receiving', isTouchdown: true, pointsDelta: 6.4,
    }],
  });

  const toast = screen.getByRole('status');
  expect(toast).toHaveTextContent('D. Adams · receiving TD (+6.4)');
  expect(toast).toHaveAttribute('data-tone', 'negative');
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
});

// #1683: a later week's touchdown by a player who started this week too must
// not celebrate on this (settled) week's Matchup Detail.
test("a touchdown stamped for a later week fires no cutscene or toast; the same play for this week does", async () => {
  reducedMotion = true;
  renderPage();
  await screen.findByTestId('scoreboard-strip');
  const play = {
    playerId: 5, name: 'P. Mahomes', position: 'QB', nflTeam: 'KC', opponent: 'BUF',
    type: 'passing', isTouchdown: true, pointsDelta: 6,
  };

  emitScores({ week: 4, scored: [{ matchupId: 9, homeScore: 107.5, awayScore: 88 }], plays: [play] });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  emitScores({ week: 3, scored: [{ matchupId: 9, homeScore: 107.5, awayScore: 88 }], plays: [play] });
  expect(screen.getByRole('alertdialog', { name: 'Touchdown, P. Mahomes, +6 points' })).toBeInTheDocument();
});

test("with celebrations off, the viewer's touchdown fires no cutscene while the opponent's toast still shows", async () => {
  reducedMotion = true;
  mockApi({ prefs: { touchdownCelebrations: false } });
  renderPage();
  await screen.findByTestId('scoreboard-strip');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/prefs'));

  emitScores({
    week: 3,
    scored: [],
    plays: [
      { playerId: 5, name: 'P. Mahomes', nflTeam: 'KC', opponent: 'BUF', type: 'passing', isTouchdown: true, pointsDelta: 6 },
      { playerId: 6, name: 'D. Adams', nflTeam: 'LV', opponent: 'DEN', type: 'receiving', isTouchdown: true, pointsDelta: 6 },
    ],
  });

  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('D. Adams');
});

// The retro field's caption tail reflects the preference the feature read
// (#903 review): a read-only line, never a control. Red-tell: feeding the
// caption a constant (or the ref instead of the state) leaves it "on" after
// an "off" read and turns this red.
test('the Scoreboard view\'s field caption reads Celebrations off once the preference read says off', async () => {
  reducedMotion = true;
  mockApi({ prefs: { touchdownCelebrations: false } });
  renderPage();
  await screen.findByTestId('slot-comparison');
  await toScoreboard();

  const caption = within(screen.getByTestId('field-caption'));
  await waitFor(() => expect(caption.getByTestId('celebrations-caption')).toHaveTextContent('Celebrations off'));
  expect(caption.getByTestId('celebrations-caption')).toHaveAttribute('data-enabled', 'false');
  expect(caption.queryByRole('button')).not.toBeInTheDocument();
});

test('a non-touchdown moment play (a sack) flashes the retro callout in Scoreboard view, not a cutscene or toast', async () => {
  reducedMotion = true;
  renderPage();
  await screen.findByTestId('slot-comparison');
  await toScoreboard();

  emitScores({
    week: 3,
    scored: [{ matchupId: 9, homeScore: 101.5, awayScore: 88 }],
    plays: [{
      playerId: 5, name: 'P. Mahomes', position: 'QB', nflTeam: 'KC', opponent: 'BUF',
      type: 'sack', isTouchdown: false, pointsDelta: 0,
    }],
  });

  expect(await screen.findByRole('status')).toHaveTextContent('KC · SACK');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.queryByTestId('matchup-toast')).not.toBeInTheDocument();
});

test('the Scoreboard view lists the last touchdown plays by either side, newest first, while live', async () => {
  reducedMotion = true;
  renderPage();
  await screen.findByTestId('slot-comparison');
  await toScoreboard();
  expect(screen.queryByTestId('last-plays')).not.toBeInTheDocument();

  emitScores({
    week: 3,
    scored: [],
    plays: [
      { playerId: 6, name: 'D. Adams', nflTeam: 'LV', type: 'receiving', isTouchdown: true, pointsDelta: 6.4 },
      { playerId: 5, name: 'P. Mahomes', nflTeam: 'KC', type: 'passing', isTouchdown: true, pointsDelta: 4 },
      { playerId: 999, name: 'Stranger', nflTeam: 'NE', type: 'rushing', isTouchdown: true, pointsDelta: 6 },
    ],
  });

  const plays = screen.getAllByTestId('last-play');
  expect(plays.map((el) => el.getAttribute('data-side'))).toEqual(['first', 'second']);
  // The row's three spans are separated by whitespace, so copied or announced
  // text does not run together, and the points print to one decimal ("+4.0",
  // #903 review). Red-tell: dropping the whitespace nodes reads
  // "P. Mahomespassing TD+4.0" and turns the first assertion red; rounding to
  // a tenth without fixing the decimal prints "+4" and turns the second red.
  expect(plays[0]).toHaveTextContent('P. Mahomes KC passing TD +4.0');
  expect(plays[0]).not.toHaveTextContent(/\+4(?!\.)/);
  expect(plays[1]).toHaveTextContent('D. Adams LV receiving TD +6.4');
  expect(screen.getByTestId('last-plays')).not.toHaveTextContent('Stranger');

  // The ticker sits full width between the field and the Lineups card, as the
  // canvas draws it (matchupScoreboardDesktop()), never inside the 340px
  // column where its four-play row would clip.
  const tickerCard = screen.getByTestId('last-plays');
  expect(precedes(screen.getByTestId('retro-field'), tickerCard)).toBe(true);
  expect(precedes(tickerCard, screen.getByTestId('lineups-card'))).toBe(true);
});

// The mobile artboard (matchupScoreboardMobile()): the bench what-if rides in
// the widget's aside slot, whose CSS order below md (Games, Lineups, then the
// aside) the retro-scoreboard widget's own test binds; the page's part is to
// put the what-if in that slot.
test('below the sm breakpoint the Scoreboard view carries the bench what-if in the aside slot beside the Games and Lineups', async () => {
  mobile = true;
  reducedMotion = true;
  mockApi({ matchup: matchupResponse({ viewerWhatIf: { delta: 3.2, swaps: [] } }) });
  renderPage();
  await screen.findByTestId('slot-comparison');
  await toScoreboard();

  expect(screen.getByTestId('games-tile')).toBeInTheDocument();
  expect(screen.getByTestId('lineups-card')).toBeInTheDocument();
  expect(within(screen.getByTestId('aside-slot')).getByTestId('bench-what-if')).toBeInTheDocument();
});

// --- the NFL game strip: the entity's rows, no second fetch ------------------

// The game ids come from the detail body the page already fetched, and their
// rows from the entity's one subscription: the page issues no second fetch
// for games. Red-tell: reading game ids from anywhere but the detail body
// turns this case red.
test('a detail body carrying two game ids mounts two game tiles with no second fetch', async () => {
  liveGameRows = [
    { tank01_game_id: '20260910_BUF@KC', game_status: 'in_progress', quarter: 'Q2', time_remaining: '3:10', home_team: 'KC', away_team: 'BUF', current_score_home: 14, current_score_away: 7 },
    { tank01_game_id: '20260913_SF@LAR', game_status: 'scheduled', home_team: 'LAR', away_team: 'SF', current_score_home: 0, current_score_away: 0 },
  ];
  mockApi({ matchup: matchupResponse({ nflGameIds: ['20260910_BUF@KC', '20260913_SF@LAR'] }) });
  renderPage();

  await screen.findByTestId('scoreboard-strip');
  const tiles = await screen.findAllByTestId('nfl-game-tile');
  expect(tiles).toHaveLength(2);
  expect(tiles[0]).toHaveAttribute('data-state', 'live');
  expect(tiles[0]).toHaveTextContent('BUF 7');
  expect(tiles[0]).toHaveTextContent('KC 14');
  expect(tiles[1]).toHaveAttribute('data-state', 'scheduled');
  expect(tiles[1]).toHaveTextContent('SF');
  expect(tiles[1]).toHaveTextContent('LAR');
  // The games came with the detail body: no request names a games resource.
  expect(apiClient.get).toHaveBeenCalledWith(MATCHUP_URL);
  expect(apiClient.get.mock.calls.filter(([url]) => /game/i.test(url))).toEqual([]);
});

test('does not render the NFL game strip once the matchup is final', async () => {
  liveGameRows = [
    { tank01_game_id: '20260910_BUF@KC', game_status: 'final', home_team: 'KC', away_team: 'BUF', current_score_home: 24, current_score_away: 20 },
  ];
  mockApi({ matchup: matchupResponse({ matchup: { final: true }, nflGameIds: ['20260910_BUF@KC'] }) });
  renderPage();

  await screen.findByTestId('scoreboard-strip');
  expect(screen.queryByTestId('nfl-game-strip')).not.toBeInTheDocument();
});

// --- the bench what-if (live only) -----------------------------------------

test('the bench what-if shows while live for a viewer with a roster, and links the swap to the Lineup page', async () => {
  mockApi({
    matchup: matchupResponse({
      viewerWhatIf: {
        delta: 11.3,
        swaps: [{ out: { playerId: 6, name: 'D. Adams', points: 0 }, in: { playerId: 20, name: 'J. Waddle', points: 11.3 }, gain: 11.3 }],
      },
    }),
  });
  renderPage();

  const card = await screen.findByTestId('bench-what-if');
  expect(within(card).getByText('Bench what-if.')).toBeInTheDocument();
  expect(card).toHaveAccessibleName('Bench what-if.');
  expect(within(card).getByRole('link', { name: 'Swap in lineup' }))
    .toHaveAttribute('href', '/league/1/lineup?swapOut=6&swapIn=20');
});

test('does not render dangling bench what-if copy when the viewer has no roster', async () => {
  mockApi({ matchup: matchupResponse({ homeStarters: [], homeBench: [], viewerWhatIf: { delta: 0, swaps: [] } }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
  expect(screen.queryByText('Bench what-if')).not.toBeInTheDocument();
  expect(screen.queryByText(/Your best legal lineup/i)).not.toBeInTheDocument();
});

test('the bench what-if is not shown for a matchup that is not live', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: 'played' }, viewerWhatIf: { delta: 4.2, swaps: [] } }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
  expect(screen.queryByTestId('bench-what-if')).not.toBeInTheDocument();
});

// --- the benches -------------------------------------------------------------

test('the Bench card is collapsed by default and Show reveals both benches with name, position, points and the Unavailable reason', async () => {
  mockApi({
    matchup: matchupResponse({
      homeBench: [
        { id: 20, name: 'Bench Runner', position: 'RB', points: 0, projected: 0, availability: { available: false, reason: 'out' } },
        { id: 21, name: 'Bye Receiver', position: 'WR', points: 0, projected: 0, availability: { available: false, reason: 'bye' } },
        { id: 22, name: 'Healthy Tight End', position: 'TE', points: 3.1, projected: 6.5, availability: { available: true, reason: null } },
      ],
      awayBench: [
        { id: 30, name: 'Away Backup', position: 'QB', points: 12.6, projected: 15 },
      ],
    }),
  });
  renderPage();

  const card = await screen.findByTestId('bench-card');
  expect(within(card).getByText('3 · 1 players')).toBeInTheDocument();
  expect(screen.queryByText('Bench Runner')).not.toBeInTheDocument();
  // The control's accessible name says what it shows ("Show benches"); its
  // visible word stays the canvas's "Show". Red-tell: dropping the aria-label
  // leaves the name "Show" and turns this red.
  expect(within(card).getByRole('button', { name: 'Show benches' })).toHaveAttribute('aria-expanded', 'false');
  expect(within(card).getByRole('button', { name: 'Show benches' })).toHaveTextContent('Show');
  // The Show / Hide control is a 44px ghost button (a 2px Ink edge), never a filled one.
  expect(rulesUnder(within(card).getByRole('button', { name: 'Show benches' }))['']).toMatch(/min-height:\s*44px/);

  await userEvent.click(within(card).getByRole('button', { name: 'Show benches' }));
  expect(within(card).getByRole('button', { name: 'Hide benches' })).toHaveAttribute('aria-expanded', 'true');

  const home = within(screen.getByTestId('bench-home'));
  expect(home.getAllByTestId('bench-row')).toHaveLength(3);
  expect(home.getAllByTestId('bench-row').map((row) => row.querySelector('[data-position]').textContent)).toEqual(['RB', 'WR', 'TE']);
  // The Out and bye rows say so in place of the figure; the healthy one shows points over its projection.
  expect(home.getAllByTestId('bench-points').map((el) => el.textContent)).toEqual(['3.1']);
  expect(home.getAllByTestId('unavailable-reason').map((el) => el.textContent)).toEqual(['out', 'on bye']);
  expect(home.getByText('proj 6.5')).toBeInTheDocument();
  expect(home.queryByText('proj 0.0')).not.toBeInTheDocument();

  const away = within(screen.getByTestId('bench-away'));
  expect(away.getByRole('button', { name: 'Away Backup' })).toBeInTheDocument();
  expect(away.getByText('proj 15.0')).toBeInTheDocument();

  await userEvent.click(within(card).getByRole('button', { name: 'Hide benches' }));
  expect(screen.queryByText('Bench Runner')).not.toBeInTheDocument();
});

// --- the bench-left line -------------------------------------------------------

test('shows points left on the bench for each team when the matchup is final', async () => {
  mockApi({
    matchup: matchupResponse({ matchup: { final: true } }),
    hindsight: (url) => {
      if (url.includes('teamId=1')) {
        return Promise.resolve({ data: { teamId: 1, week: 3, actualPoints: 101.5, optimalPoints: 113.9, pointsLeftOnBench: 12.4 } });
      }
      return Promise.resolve({ data: { teamId: 2, week: 3, actualPoints: 88, optimalPoints: 90.2, pointsLeftOnBench: 2.2 } });
    },
  });
  renderPage();

  expect(await screen.findByText('Left 12.4 on the bench')).toBeInTheDocument();
  expect(screen.getByText('Left 2.2 on the bench')).toBeInTheDocument();
  expect(screen.getByTestId('bench-left-home')).toHaveTextContent('Team A');
  expect(screen.getByTestId('bench-left-away')).toHaveTextContent('Team B');
  expect(hindsightFetches()).toHaveLength(2);
  expect(hindsightFetches()[0][0]).toBe('/api/team/hindsight?leagueId=1&teamId=1&season=2026&week=3');
});

test('does not read or show bench points when the matchup is not final', async () => {
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
  expect(hindsightFetches()).toEqual([]);
});

test('silently skips bench points on a 404 from the hindsight endpoint', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { final: true } }) });
  renderPage();
  await screen.findByTestId('scoreboard-strip');
  await waitFor(() => expect(hindsightFetches()).toHaveLength(2));

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

// Best ball sets no lineup, so nothing is ever left on a bench (ADR 0023): no
// line, and no hindsight read at all.
test('a final best-ball matchup shows no bench line and issues no hindsight read', async () => {
  useLeague.mockReturnValue({ league: { ...LEAGUE, best_ball: true }, viewerTeamId: 1, loading: false, error: null });
  mockApi({
    matchup: matchupResponse({ matchup: { final: true } }),
    hindsight: () => Promise.resolve({ data: { week: 3, actualPoints: 101.5, optimalPoints: 101.5, pointsLeftOnBench: 0 } }),
  });
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
  expect(hindsightFetches()).toEqual([]);
});

test('the bench line waits for the league to be known, so a best-ball zero never flashes', async () => {
  useLeague.mockReturnValue({ league: null, viewerTeamId: null, loading: true, error: null });
  mockApi({
    matchup: matchupResponse({ matchup: { final: true } }),
    hindsight: () => Promise.resolve({ data: { week: 3, actualPoints: 90, optimalPoints: 102.4, pointsLeftOnBench: 12.4 } }),
  });
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
  expect(hindsightFetches()).toEqual([]);
});

// The finality that triggers the read is the MODEL's, which the score feed
// moves (#912), not the fetched body's, which cannot move without a refetch.
// Red-tell: keying the read off `detail?.matchup?.final` (the pre-#912 code)
// turns this test red - the fetched body stays `final: false` here - and no
// other test in this file, whose final matchups are final in the body too.
test('a matchup that settles over the score feed reads the bench points and renders the line with no refetch', async () => {
  mockApi({
    matchup: matchupResponse({ matchup: { status: 'scheduled' } }),
    hindsight: (url) => Promise.resolve({
      data: url.includes('teamId=1')
        ? { teamId: 1, week: 3, actualPoints: 101.5, optimalPoints: 113.9, pointsLeftOnBench: 12.4 }
        : { teamId: 2, week: 3, actualPoints: 88, optimalPoints: 90.2, pointsLeftOnBench: 2.2 },
    }),
  });
  renderPage();
  await screen.findByTestId('scoreboard-strip');
  expect(hindsightFetches()).toEqual([]);

  emitScores({ scored: [{ matchupId: 9, homeScore: 101.5, awayScore: 88, status: 'final' }] });
  expect(statusChip()).toHaveTextContent('Final');

  expect(await screen.findByText('Left 12.4 on the bench')).toBeInTheDocument();
  expect(screen.getByText('Left 2.2 on the bench')).toBeInTheDocument();
  expect(hindsightFetches()).toHaveLength(2);
  expect(hindsightFetches()[0][0]).toBe('/api/team/hindsight?leagueId=1&teamId=1&season=2026&week=3');
  // The model carried the week home: no second fetch of the detail body.
  expect(matchupFetches()).toHaveLength(1);
});

// Best ball sets no lineup, so a week that settles over the feed leaves nothing
// on a bench either (ADR 0023). Red-tell: dropping the `!league.best_ball`
// conjunct from `benchLeftEligible` turns this red (two reads and a line).
test('a best-ball matchup that settles over the score feed issues no read and shows no line', async () => {
  useLeague.mockReturnValue({ league: { ...LEAGUE, best_ball: true }, viewerTeamId: 1, loading: false, error: null });
  mockApi({
    matchup: matchupResponse({ matchup: { status: 'scheduled' } }),
    hindsight: () => Promise.resolve({ data: { week: 3, actualPoints: 101.5, optimalPoints: 101.5, pointsLeftOnBench: 0 } }),
  });
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  emitScores({ scored: [{ matchupId: 9, homeScore: 101.5, awayScore: 88, status: 'final' }] });
  // The entry landed (the chip moved), so the absences below are the rule and
  // not a feed that never fired.
  expect(statusChip()).toHaveTextContent('Final');

  expect(hindsightFetches()).toEqual([]);
  expect(screen.queryByText(/on the bench/)).not.toBeInTheDocument();
});

// A settling week sends entry after entry, and a correction pass can move the
// status off final and back; hindsight for a settled week is one answer, so the
// read fires once per (team, season, week). The Matchup here is final in the
// fetched body, so the case is about the entries alone and stays green under
// the body-final mutation the test above binds. Red-tell: dropping the
// `benchLeftReadRef` guard turns this one red on the re-settle at the end (four
// fetches, not two); the repeated final entries leave the effect's dependencies
// untouched and would stay green without the guard, which is why the correction
// pass is here. Second red-tell, on the last two assertions: clearing the
// figures whenever the Matchup is not eligible (the pre-#912 branch) leaves no
// line to come back, since the guard rightly refuses the second read.
test('the hindsight read fires once per team however many score entries settle the week', async () => {
  mockApi({
    matchup: matchupResponse({ matchup: { final: true } }),
    hindsight: (url) => Promise.resolve({
      data: url.includes('teamId=1')
        ? { teamId: 1, week: 3, pointsLeftOnBench: 12.4 }
        : { teamId: 2, week: 3, pointsLeftOnBench: 2.2 },
    }),
  });
  renderPage();
  expect(await screen.findByText('Left 12.4 on the bench')).toBeInTheDocument();
  expect(hindsightFetches()).toHaveLength(2);

  emitScores({ scored: [{ matchupId: 9, homeScore: 101.5, awayScore: 88, status: 'final' }] });
  emitScores({ scored: [{ matchupId: 9, homeScore: 101.6, awayScore: 88, status: 'final' }] });
  // A correction pass re-opens the week and settles it again.
  emitScores({ scored: [{ matchupId: 9, homeScore: 101.6, awayScore: 88, status: 'live' }] });
  emitScores({ scored: [{ matchupId: 9, homeScore: 101.6, awayScore: 88, status: 'final' }] });

  expect(await screen.findByText('Left 12.4 on the bench')).toBeInTheDocument();
  expect(screen.getByText('Left 2.2 on the bench')).toBeInTheDocument();
  expect(hindsightFetches()).toHaveLength(2);
});

// --- the player quick view --------------------------------------------------

test('a starter\'s name opens the Decision card for that player in this league, in my_team context', async () => {
  mockApi();
  renderPage();
  await screen.findByTestId('slot-comparison');
  expect(screen.queryByTestId('decision-card')).not.toBeInTheDocument();

  // P. Mahomes (id 5) is the default home starter, and home is the viewer's
  // own team (viewerTeamId 1 === home.teamId 1) - the my_team context reads
  // as the Bench/Start bar being absent (no onSwap wired here) and instead
  // an Open lineup link (PlayerDecisionCard's own my_team-with-no-lineup-
  // wiring case).
  await userEvent.click(screen.getByRole('button', { name: 'P. Mahomes' }));

  expect(await screen.findByTestId('decision-card')).toBeInTheDocument();
  expect(screen.getByTestId('decision-card-open-lineup')).toHaveAttribute('href', '/league/1/lineup');
  // #1513: myTeam({ managed: false }) carries no onSwap, so lineupManaged
  // stays false and neither Bench/Start action nor Drop renders.
  expect(screen.queryByTestId('decision-card-bench-action')).not.toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-drop')).not.toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/5/card?leagueId=1');
});

// #1311, ADR 0040 ruling (d): the opponent's starter opens in 'rostered'
// context (a Propose trade link, not the viewer's own Open lineup link).
test('an opponent\'s starter name opens the Decision card in rostered context', async () => {
  mockApi();
  renderPage();
  await screen.findByTestId('slot-comparison');

  // D. Adams (id 6) is the default away starter; away (team 2) is not the
  // viewer's team (viewerTeamId 1).
  await userEvent.click(screen.getByRole('button', { name: 'D. Adams' }));

  expect(await screen.findByTestId('decision-card-propose-trade')).toHaveAttribute('href', '/league/1/trades');
  expect(screen.queryByTestId('decision-card-open-lineup')).not.toBeInTheDocument();
  // #1513: rostered({ availability: { teamName } }) - Matchup already knows
  // the other side's team name (Team B), so the card names the owner.
  expect(screen.getByText('Rostered by Team B')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/6/card?leagueId=1');
});

// --- mobile ------------------------------------------------------------------

test('below the sm breakpoint the toggle fills its row and Set lineup sits at the bottom of the page', async () => {
  mobile = true;
  renderPage();

  await screen.findByTestId('slot-comparison');
  const link = screen.getByTestId('set-lineup');
  expect(link).toHaveAttribute('href', '/league/1/lineup');
  expect(screen.getByTestId('set-lineup')).toHaveAttribute('data-placement', 'bottom');
  expect(screen.getAllByTestId('set-lineup')).toHaveLength(1);
  // The bench card precedes the action in document order.
  const bench = screen.getByTestId('bench-card');
  expect(bench.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The toggle's segments grow to the 44px touch target below sm (#903
  // review). Red-tell: rendering the toggle without `fill` on the phone
  // layout (or dropping the feature's fill rule) turns this red.
  const toggle = screen.getByRole('radiogroup', { name: 'Matchup view' });
  expect(rulesUnder(toggle)['']).toMatch(/width:\s*100%/);
  expect(rulesUnder(within(toggle).getByRole('radio', { name: 'Standard' }))['']).toMatch(/min-height:\s*44px/);
});

// --- the called shot (#1857) --------------------------------------------------

const calledShot = (over = {}) => ({
  starter: { playerId: 5, name: 'P. Mahomes', points: 24.1 },
  benched: { playerId: 20, name: 'Bench Runner', points: 6.2 },
  outcome: null,
  ...over,
});
const withShot = (shot, extra = {}) => matchupResponse({
  homeBench: [{ id: 20, name: 'Bench Runner', position: 'RB', points: 6.2, projected: 9 }],
  home: { calledShot: shot },
  ...extra,
});

test('a team with no called shot shows no called-shot line', async () => {
  mockApi({ matchup: withShot(null) });
  renderPage();
  await screen.findByTestId('bench-card');
  expect(screen.queryByTestId('called-shot-home')).not.toBeInTheDocument();
  expect(screen.queryByTestId('called-shot-away')).not.toBeInTheDocument();
});

test("a live called shot reads both players' points under the bench, collapsed or open, and moves with the score feed", async () => {
  mockApi({ matchup: withShot(calledShot()) });
  renderPage();

  const line = await screen.findByTestId('called-shot-home');
  expect(line).toHaveTextContent('Called shot: P. Mahomes over Bench Runner · 24.1 to 6.2');
  expect(screen.queryByTestId('called-shot-outcome-home')).not.toBeInTheDocument();
  // Visible with the bench collapsed; the other team has none.
  expect(screen.queryByTestId('bench-panel')).not.toBeInTheDocument();
  expect(screen.queryByTestId('called-shot-away')).not.toBeInTheDocument();

  emitScores({
    week: 3,
    scored: [{ matchupId: 9, homeScore: 105, awayScore: 88 }],
    plays: [
      { playerId: 5, type: 'passing', isTouchdown: false, pointsDelta: 3 },
      { playerId: 20, type: 'rushing', isTouchdown: false, pointsDelta: 2.5 },
    ],
  });
  expect(screen.getByTestId('called-shot-home')).toHaveTextContent('Called shot: P. Mahomes over Bench Runner · 27.1 to 8.7');
  // A play stamped for another week moves nothing.
  emitScores({ week: 4, plays: [{ playerId: 20, type: 'rushing', isTouchdown: false, pointsDelta: 9 }] });
  expect(screen.getByTestId('called-shot-home')).toHaveTextContent('27.1 to 8.7');
});

test.each([
  ['hit', 'Hit'],
  ['miss', 'Miss'],
])('a final called shot that %s reads the judged points and %s', async (outcome, label) => {
  mockApi({
    matchup: withShot(
      calledShot({ outcome, starter: { playerId: 5, name: 'P. Mahomes', points: 11.4 }, benched: { playerId: 20, name: 'Bench Runner', points: 6.2 } }),
      { matchup: { final: true } }
    ),
  });
  renderPage();
  expect(await screen.findByTestId('called-shot-home')).toHaveTextContent('Called shot: P. Mahomes over Bench Runner · 11.4 to 6.2');
  expect(screen.getByTestId('called-shot-outcome-home')).toHaveTextContent(label);
});

test('a final void called shot shows the line with no outcome word', async () => {
  mockApi({ matchup: withShot(calledShot({ outcome: 'void' }), { matchup: { final: true } }) });
  renderPage();
  expect(await screen.findByTestId('called-shot-home')).toHaveTextContent('Called shot: P. Mahomes over Bench Runner');
  expect(screen.queryByTestId('called-shot-outcome-home')).not.toBeInTheDocument();
});

test('an unknown number reads as a dash, never 0.0: a void shot whose benched player left the lineup', async () => {
  mockApi({
    matchup: withShot(
      calledShot({ outcome: 'void', benched: { playerId: 99, name: 'Dropped Guy', points: null } }),
      { matchup: { final: true } }
    ),
  });
  renderPage();
  expect(await screen.findByTestId('called-shot-home')).toHaveTextContent('Called shot: P. Mahomes over Dropped Guy · 24.1 to -');
});

test('a resync reads the fresh bench points and never adds the summed deltas on top of them', async () => {
  mockApi({ matchup: withShot(calledShot()) });
  renderPage();
  await screen.findByTestId('called-shot-home');
  emitScores({
    week: 3,
    scored: [{ matchupId: 9, homeScore: 105, awayScore: 88 }],
    plays: [{ playerId: 20, type: 'rushing', isTouchdown: false, pointsDelta: 2.5 }],
  });
  expect(screen.getByTestId('called-shot-home')).toHaveTextContent('24.1 to 8.7');

  // The reconnect's read already includes those 2.5 points.
  mockApi({
    matchup: matchupResponse({
      homeBench: [{ id: 20, name: 'Bench Runner', position: 'RB', points: 8.7, projected: 9 }],
      home: { calledShot: calledShot() },
    }),
  });
  act(() => { socket.reconnect(); });
  await waitFor(() => expect(matchupFetches()).toHaveLength(2));
  await waitFor(() => expect(screen.getByTestId('called-shot-home')).toHaveTextContent('24.1 to 8.7'));
  // A later play on the new read sums from zero again.
  emitScores({ week: 3, plays: [{ playerId: 20, type: 'rushing', isTouchdown: false, pointsDelta: 1 }] });
  expect(screen.getByTestId('called-shot-home')).toHaveTextContent('24.1 to 9.7');
});

test("the away team's called shot shows on the away side", async () => {
  mockApi({
    matchup: matchupResponse({
      awayBench: [{ id: 31, name: 'Away Bench', position: 'WR', points: 4, projected: 8 }],
      away: { calledShot: { starter: { playerId: 6, name: 'D. Adams', points: 15.4 }, benched: { playerId: 31, name: 'Away Bench', points: 4 }, outcome: null } },
    }),
  });
  renderPage();
  expect(await screen.findByTestId('called-shot-away')).toHaveTextContent('Called shot: D. Adams over Away Bench · 15.4 to 4.0');
  expect(screen.queryByTestId('called-shot-home')).not.toBeInTheDocument();
});

// The server still prices an Expected final on a played or final Matchup, and
// the strip and LED board hide it; so does the Starters footer (#2008 QA).
// Red-tell: dropping the status the page hands SlotComparison turns the
// played/final reads red.
test.each([
  ['live', true],
  ['played', false],
  ['final', false],
])('a %s matchup shows the Starters footer Exp final: %s', async (status, shown) => {
  mockApi({
    matchup: matchupResponse({
      matchup: { status, final: status === 'final' },
      home: { expectedFinal: 118.9 },
      away: { expectedFinal: 114.2 },
    }),
  });
  renderPage();
  const table = await screen.findByTestId('slot-comparison');

  const note = within(within(table).getByTestId('slot-totals')).queryAllByTestId('slot-exp-final').map((el) => el.textContent);
  expect(note.includes('Exp final 118.9')).toBe(shown);
});


// --- Play-select wave 2 (ADR 0067, spec #2334): the watching page, the lineup note, the live region ---

const inMinutes = (n) => new Date(Date.now() + n * 60 * 1000).toISOString();
const weekdayTime = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const nflGame = (over = {}) => ({
  tank01_game_id: 'G-LATE',
  game_status: 'scheduled',
  home_team: 'SF',
  away_team: 'ARI',
  current_score_home: 0,
  current_score_away: 0,
  ...over,
});
// The viewer (home) has an empty FLEX; the other side starts a WR there.
const emptyFlex = (extra = {}) => matchupResponse({
  homeStarters: [starter({ slot: 'QB', game_state: 'in_progress' })],
  awayStarters: [
    starter({ id: 6, name: 'D. Adams', slot: 'QB', position: 'QB', points: 15.4, game_state: 'in_progress' }),
    starter({ id: 7, name: 'T. Hill', slot: 'FLEX', position: 'WR', points: 9.8, game_state: 'in_progress' }),
  ],
  nflGameIds: ['G-LATE'],
  ...extra,
});
const benchPlayer = (over = {}) => ({
  id: 20, name: 'Bench Runner', position: 'RB', nfl_team: 'SF', points: 0, projected: 9, game_state: 'scheduled', availability: { available: true, reason: null }, ...over,
});
const noteCard = () => screen.getByTestId('lineup-note');
const asNonParticipant = () => useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: null, loading: false, error: null });
// Counts for AC 3: a cursor is `.cursor`; a filled action paints the Accent fill.
const cursors = () => document.querySelectorAll('.cursor').length;
const filledActions = () => Array.from(document.querySelectorAll('a, button'))
  .filter((el) => /background(-color)?:\s*var\(--ps-accent\)/.test(Object.values(rulesUnder(el)).join(';'))).length;

test('negative control: the filled-action counter sees a filled PsButton', () => {
  const { PsButton } = jest.requireActual('../../shared/ui/playselect');
  renderWithProviders(<PsButton variant="fill" onClick={() => {}}>Save</PsButton>);
  expect(filledActions()).toBe(1);
});

describe('cursor and filled-action counts are 0 on every Matchup fixture (AC 3)', () => {
  test('live, Standard view', async () => {
    liveGameRows = [
      nflGame({
        tank01_game_id: 'G-LIVE', game_status: 'in_progress', quarter: 'Q4', time_remaining: '4:21', current_score_home: 17, current_score_away: 20,
      }),
      nflGame({ start_time: inMinutes(120) }),
    ];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()], nflGameIds: ['G-LIVE', 'G-LATE'] }) });
    renderPage();
    await screen.findByTestId('lineup-note');
    expect(cursors()).toBe(0);
    expect(filledActions()).toBe(0);
  });

  test('live, Scoreboard view', async () => {
    reducedMotion = true;
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }) });
    renderPage();
    await screen.findByTestId('slot-comparison');
    await toScoreboard();
    await screen.findByTestId('retro-scoreboard');
    expect(cursors()).toBe(0);
    expect(filledActions()).toBe(0);
  });

  test('before kickoff', async () => {
    mockApi({
      matchup: matchupResponse({
        matchup: { status: 'scheduled', home_score: '0', away_score: '0' }, homeStarters: [], home: { expectedFinal: 100 }, away: { expectedFinal: 98 },
      }),
    });
    renderPage();
    await screen.findByTestId('scoreboard-strip');
    expect(cursors()).toBe(0);
    expect(filledActions()).toBe(0);
  });
});

describe('the lineup note (AC 6j)', () => {
  test('an empty unlocked FLEX a bench player can fill reads "FLEX is empty · next kickoff {lock}" with a ghost Set lineup, and no best-legal-lineup sentence', async () => {
    const kickoff = inMinutes(120);
    liveGameRows = [nflGame({ start_time: kickoff })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()], viewerWhatIf: { delta: 0, swaps: [] } }) });
    renderPage();

    const note = await screen.findByTestId('lineup-note');
    expect(note).toHaveTextContent(`FLEX is empty · next kickoff ${weekdayTime(kickoff)}`);
    expect(within(note).getByRole('link', { name: 'Set lineup' })).toHaveAttribute('href', '/league/1/lineup');
    expect(screen.queryByText(/best legal lineup/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('bench-what-if')).not.toBeInTheDocument();
    // The viewer's empty row says the same thing on its second line.
    expect(within(screen.getByTestId('slot-comparison')).getByText(`Empty · next kickoff ${weekdayTime(kickoff)}`)).toBeInTheDocument();
  });

  test('under an hour from the lock the text is "{SLOT} is empty · next kickoff in {n} min"', async () => {
    liveGameRows = [nflGame({ start_time: inMinutes(45) })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }) });
    renderPage();

    expect(await screen.findByTestId('lineup-note')).toHaveTextContent('FLEX is empty · next kickoff in 45 min');
    expect(noteCard()).toHaveAccessibleName('Lineup note: FLEX is empty · next kickoff in 45 min');
  });

  test('when no bench player can fill the slot the note says so and links Free agents instead', async () => {
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer({ game_state: 'in_progress', nfl_team: 'DAL' })] }) });
    renderPage();

    const note = await screen.findByTestId('lineup-note');
    expect(note).toHaveTextContent('FLEX is empty · no bench player can fill it · add a free agent playing at');
    expect(within(note).getByRole('link', { name: 'Free agents' })).toHaveAttribute('href', '/league/1/waivers');
    expect(within(note).queryByRole('link', { name: 'Set lineup' })).not.toBeInTheDocument();
  });

  test('before kickoff it names every move behind its gain, the projected outlook and the lock', async () => {
    const kickoff = inMinutes(600);
    liveGameRows = [nflGame({ start_time: kickoff })];
    mockApi({
      matchup: matchupResponse({
        matchup: { status: 'scheduled', home_score: '0', away_score: '0' },
        homeStarters: [starter({ injury_status: 'O', game_state: 'scheduled' })],
        awayStarters: [
          starter({ id: 6, name: 'D. Adams', slot: 'QB', game_state: 'scheduled' }),
          starter({ id: 7, name: 'T. Hill', slot: 'FLEX', position: 'WR', game_state: 'scheduled' }),
        ],
        home: { expectedFinal: 93.8 },
        away: { expectedFinal: 98.6 },
        nflGameIds: ['G-LATE'],
      }),
      advice: {
        suggestions: [{
          slot: 'QB',
          gain: 10.1,
          current: { playerId: 5, name: 'P. Mahomes', startVerdict: { outcome: 'unavailable', reason: 'out' } },
          suggested: { playerId: 20, name: 'Jordan Addison' },
        }],
        openSlotFills: [{
          slot: 'FLEX', playerId: 21, name: 'Tyjae Spears', projection: 12.9,
        }],
      },
    });
    renderPage();

    const note = await screen.findByTestId('lineup-note');
    await waitFor(() => expect(note).toHaveTextContent('Two moves · +23.0 pts: Addison in for P. Mahomes (Out) · Spears into the empty FLEX'));
    expect(note).toHaveTextContent("you'd project 116.8 to 98.6");
    expect(within(note).getByTestId('lineup-note-lock')).toHaveTextContent(`Locks ${weekdayTime(kickoff)}`);
    expect(within(note).getByRole('link', { name: 'Set lineup' })).toBeInTheDocument();
  });

  test('a non-participant sees no lineup note', async () => {
    asNonParticipant();
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    mockApi({ matchup: emptyFlex({ viewerTeamId: null, homeBench: [benchPlayer()] }) });
    renderPage();

    await screen.findByTestId('slot-comparison');
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
  });

  test('a best ball league sets no lineup, so there is no note', async () => {
    useLeague.mockReturnValue({ league: { ...LEAGUE, best_ball: true }, viewerTeamId: 1, loading: false, error: null });
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }) });
    renderPage();

    await screen.findByTestId('slot-comparison');
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
  });
});

describe('the scoreboard live region (AC 5)', () => {
  const region = () => screen.getByTestId('scoreboard-live-region');

  test('a scores:updated payload changes the visible score and the polite sentence; an identical one changes nothing', async () => {
    renderPage();
    await screen.findByTestId('scoreboard-strip');
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toHaveTextContent('Team A 101.5, Team B 88.0');
    expect(region()).not.toHaveTextContent(/as of|remaining/i);

    emitScores({ scored: [{ matchupId: 9, homeScore: 110, awayScore: 90 }] });
    expect(stripScores()).toEqual(['110.0', '90.0']);
    expect(region()).toHaveTextContent('Team A 110.0, Team B 90.0');

    // Over time: watch every text the region takes. An identical payload adds nothing; only a moved score does.
    const seen = [];
    const watcher = new MutationObserver(() => seen.push(region().textContent));
    watcher.observe(region(), { childList: true, characterData: true, subtree: true });
    emitScores({ scored: [{ matchupId: 9, homeScore: 110, awayScore: 90 }] });
    emitScores({ scored: [{ matchupId: 9, homeScore: 110, awayScore: 90 }] });
    await act(async () => { await Promise.resolve(); });
    expect(seen).toEqual([]);
    emitScores({ scored: [{ matchupId: 9, homeScore: 112, awayScore: 90 }] });
    await act(async () => { await Promise.resolve(); });
    watcher.disconnect();
    expect(seen).toEqual(['Team A 112.0, Team B 90.0']);
  });
});

test('the scoreboard speaks the margin, the two-sided odds label names both teams, and one h2 precedes the team names', async () => {
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  expect(within(strip()).getByTestId('scoreboard-margin')).toHaveTextContent('Team A by 13.5');
  expect(screen.getByRole('img', { name: /^Team A \d+%, Team B \d+% win probability$/ })).toBeInTheDocument();
  const heading = within(strip()).getByRole('heading', { level: 2, name: 'Week 3 scoreboard' });
  const names = within(strip()).getAllByRole('heading', { level: 3 });
  expect(names.map((h) => h.textContent)).toEqual(['Team A', 'Team B']);
  expect(precedes(heading, names[0])).toBe(true);
  // Standard view: no Last plays.
  expect(screen.queryByTestId('last-plays')).not.toBeInTheDocument();
});

test('the head is the shared Play-select head: "Times in" line, a closed numbers disclosure, a ghost Set lineup', async () => {
  renderPage();
  await screen.findByTestId('scoreboard-strip');

  expect(screen.getByText(/^Times in /)).toBeInTheDocument();
  const help = screen.getByText('What the numbers mean').closest('details');
  expect(help).not.toHaveAttribute('open');
  expect(within(help).getByText('Players remaining')).toBeInTheDocument();
  expect(rulesUnder(screen.getByTestId('set-lineup'))['']).toMatch(/border:\s*2px solid/);
  expect(filledActions()).toBe(0);
});

test('players remaining prints the server number; only when it is missing do both sides come from the client helper', async () => {
  const served = matchupResponse();
  served.data.home.playersRemaining = 7;
  served.data.away.playersRemaining = 9;
  mockApi({ matchup: served });
  const { unmount } = renderPage();
  await screen.findByTestId('scoreboard-strip');
  expect(within(strip()).getByText('7 players remaining')).toBeInTheDocument();
  expect(within(strip()).getByText('9 players remaining')).toBeInTheDocument();
  unmount();

  // The wire left one count out: both come from the helper over the starters (one starter each, neither final).
  const partial = matchupResponse();
  partial.data.home.playersRemaining = 7;
  mockApi({ matchup: partial });
  renderPage();
  await screen.findByTestId('scoreboard-strip');
  expect(within(strip()).getAllByText('1 player remaining')).toHaveLength(2);
});

describe('the compact scoreboard bar (RULINGS Critique 11)', () => {
  let observed;
  beforeEach(() => {
    observed = null;
    window.IntersectionObserver = jest.fn((callback) => {
      observed = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
  });
  afterEach(() => { delete window.IntersectionObserver; });

  test('the panel stays in flow; once it scrolls out a 56px bar names both scores and the margin, and scroll padding reserves it', async () => {
    renderPage();
    await screen.findByTestId('scoreboard-strip');
    expect(screen.queryByRole('group', { name: /Team A 101.5/ })).not.toBeInTheDocument();
    expect(document.documentElement.style.scrollPaddingTop).toBe('72px');

    act(() => { observed([{ isIntersecting: false, boundingClientRect: { bottom: -20 } }]); });
    const bar = screen.getByRole('group', { name: 'Team A 101.5, Team B 88.0, Team A by 13.5' });
    expect(rulesUnder(bar)['']).toMatch(/height:\s*56px/);
    expect(bar).toHaveTextContent('TA 101.5 · TB 88.0');
    expect(within(bar).queryByRole('button')).not.toBeInTheDocument();
    expect(within(bar).queryByRole('link')).not.toBeInTheDocument();

    act(() => { observed([{ isIntersecting: true, boundingClientRect: { bottom: 300 } }]); });
    expect(screen.queryByRole('group', { name: /Team A 101.5/ })).not.toBeInTheDocument();
  });
});

test('the bench shows live points over "proj x" like starters, final reads "pts · final", not-started shows proj alone, bye stays "on bye"', async () => {
  mockApi({
    matchup: matchupResponse({
      homeBench: [
        benchPlayer({
          id: 21, name: 'Live Back', game_state: 'in_progress', points: 13.4, projected: 12.9,
        }),
        benchPlayer({
          id: 22, name: 'Final Back', game_state: 'final', points: 8.6, projected: 8.1,
        }),
        benchPlayer({
          id: 23, name: 'Later Wideout', position: 'WR', game_state: 'scheduled', points: 0, projected: 6,
        }),
        benchPlayer({
          id: 24, name: 'Bye Wideout', position: 'WR', game_state: null, availability: { available: false, reason: 'bye' },
        }),
      ],
    }),
  });
  renderPage();
  await userEvent.click(within(await screen.findByTestId('bench-card')).getByRole('button', { name: 'Show benches' }));

  const rows = within(screen.getByTestId('bench-home')).getAllByTestId('bench-row');
  expect(rows[0]).toHaveTextContent('13.4 pts');
  expect(rows[0]).toHaveTextContent('proj 12.9');
  expect(rows[1]).toHaveTextContent('8.6 pts · final');
  expect(rows[1]).toHaveTextContent('proj 8.1');
  expect(rows[2]).toHaveTextContent('proj 6.0');
  expect(within(rows[2]).queryByTestId('bench-points')).not.toBeInTheDocument();
  expect(rows[3]).toHaveTextContent('on bye');
});

test('a starter row shows the product line two and the state words while started, and none of them before kickoff', async () => {
  mockApi({
    matchup: matchupResponse({
      homeStarters: [starter({
        opponent: 'MIA', game_state: 'in_progress', game_clock: 'Q4 4:21', projected: 21.4,
      })],
      awayStarters: [starter({
        id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', opponent: 'DEN', game_state: 'scheduled', points: 0, projected: 12.2,
      })],
    }),
  });
  const { unmount } = renderPage();
  const table = await screen.findByTestId('slot-comparison');
  const lines = within(table).getAllByTestId('slot-line2').map((el) => el.textContent);
  expect(lines[0]).toContain('KC vs MIA · Q4\u00a04:21');
  expect(within(table).getAllByText('In progress').length).toBeGreaterThan(0);
  expect(within(table).getAllByText('Yet to play').length).toBeGreaterThan(0);
  unmount();

  mockApi({
    matchup: matchupResponse({
      matchup: { status: 'scheduled', home_score: '0', away_score: '0' },
      homeStarters: [starter({ opponent: 'MIA', projected: 21.4 })],
    }),
  });
  renderPage();
  const pre = await screen.findByTestId('slot-comparison');
  expect(within(pre).getByText('Every starter yet to play')).toBeInTheDocument();
  expect(within(pre).queryByText('Yet to play')).not.toBeInTheDocument();
  expect(within(pre).queryByTestId('slot-legend')).not.toBeInTheDocument();
});

// --- QA rulings (spec #2334 Matchup QA): the lock, who may say "Fill by", viewer first, Exp final ---

describe('the lock the note uses (the lineup_problem action item is one week\'s)', () => {
  const lineupItem = (key, deadline) => ({
    id: `lineup_problem:1:${key}`, leagueId: 1, type: 'lineup_problem', deadlineAt: deadline,
  });

  test('the item for this season and week sets the lock', async () => {
    const itemLock = inMinutes(180);
    liveGameRows = [nflGame({ start_time: inMinutes(600) })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }), actionItems: [lineupItem('2026-3', itemLock)] });
    renderPage();
    expect(await screen.findByTestId('lineup-note')).toHaveTextContent(`next kickoff ${weekdayTime(itemLock)}`);
  });

  test('an item for another week is ignored, and the next kickoff among the games stands', async () => {
    const gameLock = inMinutes(600);
    liveGameRows = [nflGame({ start_time: gameLock })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }), actionItems: [lineupItem('2026-9', inMinutes(30))] });
    renderPage();
    const note = await screen.findByTestId('lineup-note');
    expect(note).toHaveTextContent(`next kickoff ${weekdayTime(gameLock)}`);
    expect(note).not.toHaveTextContent('next kickoff in');
  });
});

describe('"Fill by" is said on the viewer\'s side only, and only while the lineup note shows', () => {
  const cellText = (side) => within(screen.getByTestId('slot-comparison')).getAllByTestId(`slot-cell-${side}`).map((el) => el.textContent).join(' | ');

  test('the viewer\'s empty row names the lock; the opponent\'s empty row says nothing about one', async () => {
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    // Home (the viewer) has no WR; away has no RB: each side has one empty slot.
    mockApi({
      matchup: matchupResponse({
        homeStarters: [starter({ slot: 'QB', game_state: 'in_progress' }), starter({ id: 8, name: 'H. Back', slot: 'RB', position: 'RB', game_state: 'in_progress' })],
        awayStarters: [starter({ id: 6, name: 'D. Adams', slot: 'QB', game_state: 'in_progress' }), starter({ id: 9, name: 'A. Wideout', slot: 'WR', position: 'WR', game_state: 'in_progress' })],
        homeBench: [benchPlayer({ position: 'WR' })],
        nflGameIds: ['G-LATE'],
      }),
    });
    renderPage();
    await screen.findByTestId('lineup-note');
    expect(cellText('home')).toMatch(/Empty · next kickoff /);
    expect(cellText('away')).toContain('No starter');
    expect(cellText('away')).not.toMatch(/Fill by|next kickoff/);
  });

  test('the opponent\'s empty slot carries no lock when the viewer has nothing to fix', async () => {
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    // The viewer is home with a full lineup; the away side has the empty FLEX.
    mockApi({
      matchup: matchupResponse({
        homeStarters: [starter({ slot: 'QB', game_state: 'in_progress' }), starter({ id: 8, name: 'H. Flex', slot: 'FLEX', position: 'WR', game_state: 'in_progress' })],
        awayStarters: [starter({ id: 6, name: 'D. Adams', slot: 'QB', game_state: 'in_progress' })],
        nflGameIds: ['G-LATE'],
      }),
    });
    renderPage();
    await screen.findByTestId('slot-comparison');
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
    expect(cellText('away')).toContain('No starter');
    expect(cellText('away')).not.toMatch(/Fill by|next kickoff/);
  });

  test('a non-participant sees no lock on either side, and the viewer\'s own empty row names it', async () => {
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    asNonParticipant();
    mockApi({ matchup: emptyFlex({ viewerTeamId: null, homeBench: [benchPlayer()] }) });
    const { unmount } = renderPage();
    await screen.findByTestId('slot-comparison');
    expect(cellText('home')).not.toMatch(/Fill by|next kickoff/);
    unmount();

    useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: 1, loading: false, error: null });
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }) });
    renderPage();
    await screen.findByTestId('lineup-note');
    expect(cellText('home')).toMatch(/Empty · next kickoff /);
  });

  test('before kickoff the viewer\'s empty row keeps "Fill by {lock}"', async () => {
    const lock = inMinutes(600);
    liveGameRows = [nflGame({ start_time: lock })];
    mockApi({
      matchup: matchupResponse({
        matchup: { status: 'scheduled', home_score: '0', away_score: '0' },
        homeStarters: [starter({ slot: 'QB', game_state: 'scheduled' })],
        awayStarters: [starter({ id: 6, name: 'D. Adams', slot: 'QB', game_state: 'scheduled' }), starter({ id: 7, name: 'T. Hill', slot: 'FLEX', position: 'WR', game_state: 'scheduled' })],
        nflGameIds: ['G-LATE'],
      }),
    });
    renderPage();
    await screen.findByTestId('lineup-note');
    // The games read lands after the note first paints, so wait for the lock.
    await waitFor(() => expect(cellText('home')).toContain(`Fill by ${weekdayTime(lock)}`));
    expect(cellText('home')).not.toContain('next kickoff');
  });

  test('a best ball league names no lock either', async () => {
    useLeague.mockReturnValue({ league: { ...LEAGUE, best_ball: true }, viewerTeamId: 1, loading: false, error: null });
    liveGameRows = [nflGame({ start_time: inMinutes(120) })];
    mockApi({ matchup: emptyFlex({ homeBench: [benchPlayer()] }) });
    renderPage();
    await screen.findByTestId('slot-comparison');
    expect(cellText('home')).not.toMatch(/Fill by|next kickoff/);
  });
});

describe('the viewer\'s side comes first (Critique 4 item 1)', () => {
  const awayViewer = () => mockApi({ matchup: matchupResponse({ viewerTeamId: 2 }) });
  const order = (nodes) => nodes.map((n) => n.getAttribute('data-testid'));

  test('as the away team the viewer is the left column of the strip, the live sentence, the odds and the compact bar', async () => {
    window.IntersectionObserver = jest.fn((callback) => {
      window.__observed = callback;
      return { observe: jest.fn(), disconnect: jest.fn() };
    });
    awayViewer();
    renderPage();
    await screen.findByTestId('scoreboard-strip');

    const sides = within(strip()).getAllByTestId(/^scoreboard-side-/);
    expect(order(sides)).toEqual(['scoreboard-side-away', 'scoreboard-side-home']);
    expect(stripScores()).toEqual(['88.0', '101.5']);
    expect(screen.getByTestId('scoreboard-live-region')).toHaveTextContent('Team B 88.0, Team A 101.5');
    expect(screen.getByRole('img', { name: /^Team B \d+%, Team A \d+% win probability$/ })).toBeInTheDocument();
    expect(within(strip()).getByTestId('scoreboard-margin')).toHaveTextContent('Team A by 13.5');

    act(() => { window.__observed([{ isIntersecting: false, boundingClientRect: { bottom: -20 } }]); });
    expect(screen.getByRole('group', { name: 'Team B 88.0, Team A 101.5, Team A by 13.5' })).toHaveTextContent('TB 88.0 · TA 101.5');
    delete window.IntersectionObserver;
    delete window.__observed;
  });

  test('as the away team the Starters frame puts his side on the left, with the You tag and the totals in that order', async () => {
    awayViewer();
    renderPage();
    const table = await screen.findByTestId('slot-comparison');

    const row = within(table).getAllByTestId('slot-row')[0];
    expect(order(Array.from(row.querySelectorAll('[data-testid^="slot-cell-"]')))).toEqual(['slot-cell-away', 'slot-cell-home']);
    expect(order(Array.from(within(table).getByTestId('slot-totals').querySelectorAll('[data-testid^="slot-total-"]')))).toEqual(['slot-total-away', 'slot-total-home']);
    const heads = within(table).getAllByText(/^Team [AB]$/).map((el) => el.textContent);
    expect(heads).toEqual(['Team B', 'Team A']);
    expect(within(table).getByText('You').parentElement).toHaveTextContent('Team B');
  });

  test('a participant as home, and a non-participant, see home on the left', async () => {
    renderPage();
    await screen.findByTestId('scoreboard-strip');
    expect(order(within(strip()).getAllByTestId(/^scoreboard-side-/))).toEqual(['scoreboard-side-home', 'scoreboard-side-away']);
  });

  test('a non-participant sees home first in the strip and the table', async () => {
    asNonParticipant();
    mockApi({ matchup: matchupResponse({ viewerTeamId: null }) });
    renderPage();
    const table = await screen.findByTestId('slot-comparison');
    expect(order(within(strip()).getAllByTestId(/^scoreboard-side-/))).toEqual(['scoreboard-side-home', 'scoreboard-side-away']);
    const row = within(table).getAllByTestId('slot-row')[0];
    expect(order(Array.from(row.querySelectorAll('[data-testid^="slot-cell-"]')))).toEqual(['slot-cell-home', 'slot-cell-away']);
    expect(within(table).queryByText('You')).not.toBeInTheDocument();
  });
});

describe('the per-starter Exp final column', () => {
  const live = (home, away) => matchupResponse({
    homeStarters: [starter({ projected: 21.4, expected_final: home, game_state: 'in_progress' })],
    awayStarters: [starter({
      id: 6, name: 'D. Adams', slot: 'WR', position: 'WR', projected: 12.2, expected_final: away, game_state: 'in_progress',
    })],
  });

  test('prints the producer\'s figure per row, a dash when it priced none, under an Exp final label', async () => {
    mockApi({ matchup: live(27.35, null) });
    renderPage();
    const table = await screen.findByTestId('slot-comparison');

    expect(within(table).getAllByTestId('slot-row-exp-final').map((el) => el.textContent)).toEqual(['Exp final 27.4', 'Exp final –']);
    expect(within(table).getAllByText('Exp final').length).toBeGreaterThan(0);
  });

  test('is not drawn before kickoff or on a phone', async () => {
    mockApi({ matchup: matchupResponse({ matchup: { status: 'scheduled', home_score: '0', away_score: '0' }, homeStarters: [starter({ expected_final: 20 })] }) });
    const { unmount } = renderPage();
    await screen.findByTestId('slot-comparison');
    expect(screen.queryByTestId('slot-row-exp-final')).not.toBeInTheDocument();
    unmount();

    mobile = true;
    mockApi({ matchup: live(27.35, 10) });
    renderPage();
    await screen.findByTestId('slot-comparison');
    expect(screen.queryByTestId('slot-row-exp-final')).not.toBeInTheDocument();
  });
});

test('leaving the page restores scroll-padding-top and disconnects the scoreboard observer', async () => {
  const disconnect = jest.fn();
  window.IntersectionObserver = jest.fn(() => ({ observe: jest.fn(), disconnect }));
  document.documentElement.style.scrollPaddingTop = '10px';
  const { unmount } = renderPage();
  await screen.findByTestId('scoreboard-strip');
  expect(document.documentElement.style.scrollPaddingTop).toBe('72px');

  unmount();
  expect(document.documentElement.style.scrollPaddingTop).toBe('10px');
  expect(disconnect).toHaveBeenCalled();
  document.documentElement.style.scrollPaddingTop = '';
  delete window.IntersectionObserver;
});

// Viewer first (spec #2402): an away viewer's Team leads in the strip and the Slot
// comparison, and its bench leads in the Bench card. Red-tell: handing the page's
// benches over as { first: home, second: away } puts the opponent's bench first here.
test('an away viewer sees their own Team first on the strip, the Slot comparison and the Bench card', async () => {
  mockApi({
    matchup: matchupResponse({
      viewerTeamId: 2,
      homeBench: [{ id: 31, name: 'H. Bench', position: 'RB', points: 0 }, { id: 33, name: 'H. Two', position: 'WR', points: 0 }],
      awayBench: [{ id: 32, name: 'A. Bench', position: 'RB', points: 0 }],
      away: { name: null },
    }),
  });
  useLeague.mockReturnValue({ league: LEAGUE, viewerTeamId: 2, loading: false, error: null });
  renderPage();
  await screen.findByTestId('slot-comparison');
  const sides = within(screen.getByTestId('scoreboard-strip')).getAllByTestId(/^scoreboard-side-/);
  expect(sides[0].getAttribute('data-testid')).toBe('scoreboard-side-away');
  expect(sides[1]).toHaveTextContent('Team A');
  // Cell test ids follow each side's origin, so an away viewer's left column is the away cell.
  const cells = within(screen.getByTestId('slot-comparison')).getAllByTestId(/^slot-cell-/);
  expect(cells.slice(0, 2).map((c) => c.getAttribute('data-testid'))).toEqual(['slot-cell-away', 'slot-cell-home']);
  // Bench card: its first column (positional test id) is the viewer's bench, and a missing
  // name falls back to "Away" because that is the viewer's own side.
  const card = screen.getByTestId('bench-card');
  expect(within(card).getByText('Away 1 player, Team A 2 players')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Show benches' }));
  const firstBench = within(screen.getByTestId('bench-home'));
  expect(firstBench.getByText('A. Bench')).toBeInTheDocument();
  expect(firstBench.queryByText('H. Bench')).not.toBeInTheDocument();
});
