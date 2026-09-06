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

let liveGameRows = [];
function installSupabase() {
  const inFn = jest.fn().mockImplementation((column, ids) => Promise.resolve({
    data: liveGameRows.filter((r) => ids.includes(r.tank01_game_id)),
    error: null,
  }));
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  const channelObj = { on: jest.fn(() => channelObj), subscribe: jest.fn(() => channelObj) };
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
// in, the hindsight read and the player summary.
function mockApi({ matchup = matchupResponse(), prefs = { touchdownCelebrations: true }, standings = [], hindsight, summary } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/league/') && url.includes('/matchups/')) return Promise.resolve(matchup);
    if (url === '/api/notifications/prefs') return Promise.resolve({ data: prefs });
    if (url.endsWith('/standings')) return Promise.resolve({ data: { standings } });
    if (url.includes('/api/team/hindsight')) {
      if (typeof hindsight === 'function') return hindsight(url);
      return Promise.reject({ response: { status: 404 } });
    }
    if (/\/api\/players\/\d+\/summary/.test(url)) return Promise.resolve({ data: summary || { player: null } });
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
const slotOrder = () => screen.getAllByTestId('slot-row').map((row) => within(row).getByTestId('pos-chip').textContent);
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
  expect(await screen.findByRole('alert')).toHaveTextContent('matchup not found');
});

test('renders the header, both teams\' starters with points, and the strip\'s scores', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: 'Starters' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Bench' })).toBeInTheDocument();

  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(nav).getByRole('link', { name: 'Sunday Ballers' })).toHaveAttribute('href', '/league/1');
  expect(within(nav).getByRole('link', { name: 'Game Center' })).toHaveAttribute('href', '/league/1/game-center');
  // The current page ends the trail, as the Game Center breadcrumb ends on
  // its own page (#903 review). Red-tell: dropping the crumb, or its
  // aria-current, turns this red.
  expect(within(nav).getByText('Matchup')).toHaveAttribute('aria-current', 'page');
  expect(within(nav).queryByRole('link', { name: 'Matchup' })).not.toBeInTheDocument();

  // The column is the artboard's 1120px (matchupStandardDesktop()), not the
  // Game Center's 1200px. Red-tell: `maxWidth="lg"` on the Container turns
  // this red (its rule reads 1200px under the lg media query, and no 1120px).
  expect(rulesUnder(screen.getByTestId('matchup-column'))['']).toMatch(/max-width:\s*1120px/);

  expect(stripScores()).toEqual(['101.5', '88.0']);
  expect(within(strip()).getByTestId('scoreboard-side-home')).toHaveTextContent('Team A');
  expect(within(strip()).getByTestId('scoreboard-side-away')).toHaveTextContent('Team B');
  // The viewer (Team 1) is the home side.
  expect(within(strip()).getByTestId('scoreboard-side-home')).toHaveAttribute('data-viewer-team', 'true');

  const table = screen.getByTestId('slot-comparison');
  expect(within(table).getByRole('button', { name: 'P. Mahomes' })).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: 'D. Adams' })).toBeInTheDocument();
  const points = within(table).getAllByTestId('slot-points').map((el) => el.textContent);
  expect(points).toEqual(['24.1', '15.4']);

  // Set lineup links to the Lineup page (ADR 0019) from the header on desktop.
  expect(screen.getByRole('link', { name: 'Set lineup' })).toHaveAttribute('href', '/league/1/lineup');
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

test('a scheduled matchup reads Scheduled with no win-probability bar, and the Scoreboard view shows no WIN digits either', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: 'scheduled', home_score: '0', away_score: '0' } }) });
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Scheduled');
  expect(statusChip()).toHaveAttribute('data-variant', 'neutral');
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Win probability:/ })).not.toBeInTheDocument();

  // The Scoreboard view follows the same started state (#903 review): no WIN
  // row on the board, and the field's image says the probability is not yet
  // available. Red-tell: feeding the board the page's probability regardless
  // of status turns this red.
  await toScoreboard();
  expect(screen.queryByTestId('led-win')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('led-board')).queryByText('WIN')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /^Field position/ })).toHaveAccessibleName('Field position: win probability not yet available');
});

// The LIVE chip comes from the fetched status alone: no socket event is fired
// here. Red-tell: forcing the predicate to return Scheduled for `live` turns
// this case red and no other.
test('a live matchup reads LIVE from the fetch alone, with no socket event', async () => {
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('LIVE');
  // The canvas's `.chip.live`: the danger tint with the dot, on the header
  // chip and the strip's alike (#903 review).
  expect(statusChip()).toHaveAttribute('data-variant', 'danger');
  expect(within(statusChip()).getByTestId('badge-dot')).toHaveAttribute('aria-hidden', 'true');
  expect(within(strip()).getByTestId('scoreboard-status')).toHaveAttribute('data-variant', 'danger');
  expect(within(within(strip()).getByTestId('scoreboard-status')).getByTestId('badge-dot')).toBeInTheDocument();
  expect(screen.queryByText('Awaiting final')).not.toBeInTheDocument();
  expect(screen.getAllByRole('img', { name: /^Win probability:/ })).toHaveLength(1);
  expect(screen.getByText('Win probability')).toBeInTheDocument();
  expect(screen.queryByText(/Live win probability/)).not.toBeInTheDocument();
});

// Triage #872/#887's page-level promise: on the composed page ONE announced
// Win probability image and the plain "Win probability" caption (never "Live
// win probability") for every started status, not only live. The retro
// field's image is named "Field position: ...", so nothing else can double it.
test.each(['played', 'final'])('a %s matchup exposes exactly one Win probability image and the plain caption on the composed page', async (status) => {
  mockApi({ matchup: matchupResponse({ matchup: { status, final: status === 'final', home_score: '99', away_score: '92' } }) });
  renderPage();

  await screen.findByTestId('matchup-status-chip');
  expect(screen.getAllByRole('img', { name: /^Win probability:/ })).toHaveLength(1);
  expect(screen.getByText('Win probability')).toBeInTheDocument();
  expect(screen.queryByText(/Live win probability/)).not.toBeInTheDocument();
});

// A played (games done, not finalised) matchup reads "Awaiting final", never a
// guessed LIVE, and the strip says the SAME thing as the header.
test('a played matchup reads Awaiting final in both the header and the strip, never Not started or LIVE', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: 'played', home_score: '99', away_score: '92' } }) });
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Awaiting final');
  expect(screen.getAllByText('Awaiting final')).toHaveLength(2);
  expect(within(strip()).getByTestId('scoreboard-status')).toHaveTextContent('Awaiting final');
  // The canvas's `.chip.warn` on both chips, no dot (#903 review).
  expect(statusChip()).toHaveAttribute('data-variant', 'warning');
  expect(within(statusChip()).queryByTestId('badge-dot')).not.toBeInTheDocument();
  expect(within(strip()).getByTestId('scoreboard-status')).toHaveAttribute('data-variant', 'warning');
  expect(screen.queryByText('Not started')).not.toBeInTheDocument();
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
});

test('a final matchup reads Final', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { final: true } }) });
  renderPage();

  expect(await screen.findByTestId('matchup-status-chip')).toHaveTextContent('Final');
  // The canvas's `.chip.final`: the success tint on both chips (#903 review).
  // Red-tell: mapping every non-live status to neutral turns this red.
  expect(statusChip()).toHaveAttribute('data-variant', 'success');
  expect(within(strip()).getByTestId('scoreboard-status')).toHaveTextContent('Final');
  expect(within(strip()).getByTestId('scoreboard-status')).toHaveAttribute('data-variant', 'success');
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
});

// A status the server could not compute is null: no chip anywhere (not the
// header's, not the strip's), and never a false "Not started".
test('a null-status matchup shows no chip anywhere and never Not started', async () => {
  mockApi({ matchup: matchupResponse({ matchup: { status: null } }) });
  renderPage();

  await screen.findByRole('heading', { level: 1, name: 'Week 3 Matchup' });
  expect(statusChip()).not.toBeInTheDocument();
  expect(within(strip()).queryByTestId('scoreboard-status')).not.toBeInTheDocument();
  expect(screen.queryByText('Not started')).not.toBeInTheDocument();
  expect(screen.queryByText('Scheduled')).not.toBeInTheDocument();
  expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /^Win probability:/ })).not.toBeInTheDocument();
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
  expect(stripScores()).toEqual(['101.5', '88.0']);
  expect(statusChip()).toHaveTextContent('Scheduled');
  expect(screen.getByText('Projected 120.5')).toBeInTheDocument();
  expect(screen.getByText('Projected 97.3')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 4')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 2')).toBeInTheDocument();

  emitScores({
    scored: [{
      matchupId: 9, homeScore: 110, awayScore: 90, status: 'played',
      homeExpectedFinal: 130.2, awayExpectedFinal: 96.4, homePlayersRemaining: 3, awayPlayersRemaining: 1,
    }],
  });

  expect(stripScores()).toEqual(['110.0', '90.0']);
  expect(screen.getByText('Projected 130.2')).toBeInTheDocument();
  expect(screen.getByText('Projected 96.4')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 3')).toBeInTheDocument();
  expect(screen.getByText('Players remaining 1')).toBeInTheDocument();
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
  expect(within(strip).getByTestId('pace-bar')).toBeInTheDocument();
  expect(within(table).getByRole('button', { name: 'Stats for P. Mahomes' })).toHaveAttribute('aria-expanded', 'true');

  // The other starter's control opens his row and closes the first.
  await userEvent.click(within(table).getByRole('button', { name: 'Stats for D. Adams' }));
  expect(screen.getAllByTestId('slot-expanded')).toHaveLength(1);
  const byeStrip = screen.getByTestId('slot-expanded');
  expect(within(byeStrip).getByTestId('unavailable-reason')).toHaveTextContent('on bye');
  expect(within(byeStrip).queryByTestId('pace-bar')).not.toBeInTheDocument();
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

test("with celebrations off, the viewer's touchdown fires no cutscene while the opponent's toast still shows", async () => {
  reducedMotion = true;
  mockApi({ prefs: { touchdownCelebrations: false } });
  renderPage();
  await screen.findByTestId('scoreboard-strip');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/notifications/prefs'));

  emitScores({
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
    scored: [],
    plays: [
      { playerId: 6, name: 'D. Adams', nflTeam: 'LV', type: 'receiving', isTouchdown: true, pointsDelta: 6.4 },
      { playerId: 5, name: 'P. Mahomes', nflTeam: 'KC', type: 'passing', isTouchdown: true, pointsDelta: 4 },
      { playerId: 999, name: 'Stranger', nflTeam: 'NE', type: 'rushing', isTouchdown: true, pointsDelta: 6 },
    ],
  });

  const plays = screen.getAllByTestId('last-play');
  expect(plays.map((el) => el.getAttribute('data-side'))).toEqual(['home', 'away']);
  // The row's three spans are separated by whitespace, so copied or announced
  // text does not run together, and the points print to one decimal ("+4.0",
  // #903 review). Red-tell: dropping the whitespace nodes reads
  // "P. Mahomespassing TD+4.0" and turns the first assertion red; rounding to
  // a tenth without fixing the decimal prints "+4" and turns the second red.
  expect(plays[0]).toHaveTextContent('P. Mahomes passing TD +4.0');
  expect(plays[0]).not.toHaveTextContent(/\+4(?!\.)/);
  expect(plays[1]).toHaveTextContent('D. Adams receiving TD +6.4');
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
  expect(within(card).getByRole('heading', { level: 2, name: 'Bench what-if' })).toBeInTheDocument();
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
  // Collapsed with nothing beneath the header, the card clears the header's
  // bottom hairline so its edge is not a doubled line (#903 review). Red-tell:
  // dropping the collapsed `sx` (or the header-only gate) turns this red.
  expect(card).toHaveAttribute('data-header-only', 'true');
  // (jsdom serializes the `0` as "0px solid".)
  expect(rulesUnder(card)['>:first-of-type']).toMatch(/border-bottom:\s*0(px)?\b/);

  await userEvent.click(within(card).getByRole('button', { name: 'Show benches' }));
  expect(within(card).getByRole('button', { name: 'Hide benches' })).toHaveAttribute('aria-expanded', 'true');
  // Open, the header's hairline returns above the panel.
  expect(screen.getByTestId('bench-card')).not.toHaveAttribute('data-header-only');
  expect(rulesUnder(screen.getByTestId('bench-card'))['>:first-of-type']).toBeUndefined();

  const home = within(screen.getByTestId('bench-home'));
  expect(home.getAllByTestId('bench-row')).toHaveLength(3);
  expect(home.getAllByTestId('pos-chip').map((el) => el.textContent)).toEqual(['RB', 'WR', 'TE']);
  expect(home.getAllByTestId('bench-points').map((el) => el.textContent)).toEqual(['0.0', '0.0', '3.1']);
  // The Out and bye rows say so in place of a projection; the healthy one projects.
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

test('a starter\'s name opens PlayerQuickView for that player in this league', async () => {
  mockApi({
    summary: {
      player: { id: 5, name: 'P. Mahomes', position: 'QB', team: 'KC' },
      fantasy: {},
      currentSeason: null,
      previousSeasons: [],
    },
  });
  renderPage();
  await screen.findByTestId('slot-comparison');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'P. Mahomes' }));

  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/5/summary', { params: { leagueId: 1 } });
});

// --- mobile ------------------------------------------------------------------

test('below the sm breakpoint the toggle fills its row and Set lineup sits at the bottom of the page', async () => {
  mobile = true;
  renderPage();

  await screen.findByTestId('slot-comparison');
  const link = screen.getByRole('link', { name: 'Set lineup' });
  expect(link).toHaveAttribute('href', '/league/1/lineup');
  expect(screen.getByTestId('set-lineup')).toHaveAttribute('data-placement', 'bottom');
  expect(screen.getAllByRole('link', { name: 'Set lineup' })).toHaveLength(1);
  // The bench card precedes the action in document order.
  const bench = screen.getByTestId('bench-card');
  expect(bench.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The toggle's segments grow to the 44px touch target below sm (#903
  // review). Red-tell: rendering the toggle without `fill` on the phone
  // layout (or dropping the feature's fill rule) turns this red.
  const toggle = screen.getByRole('radiogroup', { name: 'Matchup view' });
  expect(rulesUnder(toggle)['[role="radio"]']).toMatch(/min-height:\s*44px/);
});
