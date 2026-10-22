/* eslint-disable testing-library/no-node-access -- these cases read emotion rules, data attributes and the Live chip's dot, which have no role or text */
import React from 'react';
import {
  act, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import supabase from '../../api/supabaseClient';
import { invalidate } from '../../lib/resourceCache';
import { computeDefaultWeek } from '../../lib/matchupWeek';
import { publishTeamProfileUpdate } from '../../lib/teamProfileEvents';
import { matchupFromListRow } from '../../entities/matchup';
import GameCenterPage from './index';
import { viewerSlots } from './ui/HeroSection';
import { syncLineText, weekGlanceFacts } from './model/useGameCenter';

// The page reads everything through the shared apiClient (the league cache,
// the Matchup list, the standings cache, the rosters), so the whole client is
// mocked and every GET is answered by the URL-keyed dispatcher below.
jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('../../api/supabaseClient', () => ({
  __esModule: true,
  default: {
    from: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

const renderPage = (leagueId = 1) =>
  renderWithProviders(<GameCenterPage />, {
    path: '/league/:leagueId/game-center',
    route: `/league/${leagueId}/game-center`,
  });

// A Matchup list row exactly as GET /api/league/:id/matchups delivers it (the
// snake_case columns the entity's list-row builder reads). `status` is the
// server's fact (ADR 0030); it defaults to match `final` so a fixture reads
// truthfully without every test spelling it out.
const row = (overrides = {}) => {
  const final = overrides.final ?? false;
  return {
    id: 1,
    season: 2026,
    week: 1,
    final,
    status: final ? 'final' : 'scheduled',
    first_kickoff_at: null,
    synced_at: null,
    home_team_id: 10,
    away_team_id: 20,
    home_team_name: 'Home Team',
    away_team_name: 'Away Team',
    home_score: 0,
    away_score: 0,
    nfl_game_ids: [],
    ...overrides,
  };
};

// The viewer's Matchup (Team 10 vs 20) and one other (30 vs 40), both in week 1.
const viewerRow = (overrides = {}) =>
  row({
    id: 1,
    home_team_id: 10,
    away_team_id: 20,
    home_team_name: 'My Team',
    away_team_name: 'Rival',
    status: 'live',
    home_score: '30.0',
    away_score: '20.0',
    home_expected_final: 100,
    away_expected_final: 140,
    home_players_remaining: 5,
    away_players_remaining: 4,
    ...overrides,
  });
const otherRow = (overrides = {}) =>
  row({
    id: 2,
    home_team_id: 30,
    away_team_id: 40,
    home_team_name: 'Other A',
    away_team_name: 'Other B',
    status: 'live',
    home_score: '12.0',
    away_score: '18.0',
    home_expected_final: 90,
    away_expected_final: 95,
    home_players_remaining: 3,
    away_players_remaining: 3,
    ...overrides,
  });

function mockApi({
  matchups = [],
  league = { id: 1, name: 'Sunday Ballers', current_week: 1 },
  teams = [],
  viewerTeamId = null,
  rosters = [],
  standings = [],
  actionItems = [],
  detail = null,
  advice = null,
} = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url.startsWith('/api/user/action-items')) return Promise.resolve({ data: { items: actionItems } });
    if (advice && url.startsWith('/api/team/lineup/advice')) return Promise.resolve({ data: advice });
    if (detail && url.includes('/matchups/')) return Promise.resolve({ data: detail });
    if (url.endsWith('/matchups')) return Promise.resolve({ data: matchups });
    if (url.endsWith('/rosters')) return Promise.resolve({ data: rosters });
    if (url.endsWith('/standings')) return Promise.resolve({ data: { standings } });
    return Promise.resolve({ data: { league, teams, viewerTeamId } });
  });
}

// Drive live updates through the app's own socket factory hook
// (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js): the entity's
// score feed builds its socket through createDraftSocket, so installing this
// factory hands the feed a controllable fake, exactly as the legacy page test
// did.
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
let sockets;
let liveGamePush;
let mobile;

function installLiveGames(rows) {
  const inFn = jest.fn().mockResolvedValue({ data: rows, error: null });
  supabase.from.mockReturnValue({ select: jest.fn().mockReturnValue({ in: inFn }) });
  const channelObj = {
    on: jest.fn((_event, _filter, handler) => {
      liveGamePush = (payload) => act(() => handler(payload));
      return channelObj;
    }),
    subscribe: jest.fn((cb) => { cb?.('SUBSCRIBED'); return channelObj; }),
  };
  supabase.channel.mockReturnValue(channelObj);
}

// The page opens one feed socket for the list, and a second for the live hero's lineups while the payload
// lacks yetToPlay; a score event reaches every one of them, as the server's room broadcast does.
const emitScores = (payload) => act(() => { sockets.forEach((s) => s.fire('scores:updated', payload)); });

beforeEach(() => {
  // Clear every shared resource cache (ADR 0004): the league and the
  // week-keyed standings are module state and outlive a test.
  invalidate(undefined, { reload: false });
  mobile = false;
  sockets = [];
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => {
    const made = makeFakeSocket();
    sockets.push(made);
    [socket] = sockets;
    return made;
  };
  // Every media query the page and its widgets read goes through
  // useMediaQuery: the theme's `sm` breakpoint (a max-width) reads `mobile`;
  // reduced motion and the rest read false.
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query) ? mobile : false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterEach(() => {
  delete window.__ENDZONE_TEST_SOCKET_FACTORY__;
  jest.clearAllMocks();
});

test('live NFL game updates move the Game Center game strip without reload', async () => {
  installLiveGames([{
    tank01_game_id: 'g1',
    week: 1,
    game_status: 'in_progress',
    away_team: 'GB',
    home_team: 'CHI',
    current_score_away: 10,
    current_score_home: 7,
    quarter: 'Q2',
    time_remaining: '8:12',
  }]);
  mockApi({ matchups: [viewerRow({ nfl_game_ids: ['g1'] })], viewerTeamId: 10 });

  renderPage();

  const strip = await screen.findByTestId('game-center-nfl-games');
  expect(strip).toHaveTextContent('GB 10 - CHI 7');
  expect(strip).toHaveTextContent('Q2 8:12');

  liveGamePush({
    new: {
      tank01_game_id: 'g1',
      week: 1,
      game_status: 'in_progress',
      away_team: 'GB',
      home_team: 'CHI',
      current_score_away: 17,
      current_score_home: 7,
      quarter: 'Q2',
      time_remaining: '3:04',
    },
  });

  expect(strip).toHaveTextContent('GB 17 - CHI 7');
  expect(strip).toHaveTextContent('Q2 3:04');
});

const cards = () => screen.queryAllByTestId('matchup-card');
const card = (id) => cards().find((el) => el.getAttribute('data-matchup-id') === String(id));
const glanceRow = (fact) =>
  screen.getAllByTestId('week-glance-row').find((el) => el.getAttribute('data-fact') === fact);
const feedRows = () => screen.queryAllByTestId('scoring-feed-row');

// An sx rule is neither laid out nor computed by jsdom, but emotion inserts
// every rule into `document.styleSheets` under the element's generated class
// (the Matchup page's test and the picker's read their layout rules the same
// way). This gathers the declarations of every rule whose selector starts
// with that class, keyed by the selector's tail ('' for the element's own).
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

test('a first load renders a skeleton per region, each region aria-busy', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderPage();

  // The h1 is up before any read settles; the sync line waits for the week.
  expect(screen.getByRole('heading', { level: 1, name: 'Game Center' })).toBeInTheDocument();
  expect(screen.queryByTestId('game-center-sync')).not.toBeInTheDocument();
  for (const region of ['picker', 'strip', 'main', 'rail']) {
    const el = screen.getByTestId(`game-center-loading-${region}`);
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(within(el).getAllByTestId('skeleton').length).toBeGreaterThan(0);
  }
});

test('a failed Matchup read renders an Alert and keeps the page frame up', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/matchups')) {
      return Promise.reject({ response: { data: { error: 'matchups unavailable' } } });
    }
    if (url.endsWith('/rosters') || url.endsWith('/standings')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: { league: { id: 1, name: 'Sunday Ballers' }, teams: [], viewerTeamId: null } });
  });
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('matchups unavailable');
  expect(screen.getByRole('heading', { level: 1, name: 'Game Center' })).toBeInTheDocument();
  expect(screen.queryByTestId('game-center-loading')).not.toBeInTheDocument();
});

// A code+message envelope with no `error` key (the shape the global express
// error handler and the rate limiter emit). The old hand-rolled read of
// `err.response.data.error` found no `error` key here and fell through to
// `err.message`, which a rejected object like this does not carry, so the page
// showed NO alert at all; reading through readHttpFailure surfaces the server's
// own sentence in the alert region.
test('a code+message Matchup failure (no error key) shows the server sentence in the Alert', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url.endsWith('/matchups')) {
      return Promise.reject({ response: { data: { code: 'MATCHUPS_DOWN', message: 'scores are briefly unavailable' } } });
    }
    if (url.endsWith('/rosters') || url.endsWith('/standings')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: { league: { id: 1, name: 'Sunday Ballers' }, teams: [], viewerTeamId: null } });
  });
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('scores are briefly unavailable');
  expect(screen.getByRole('heading', { level: 1, name: 'Game Center' })).toBeInTheDocument();
});

test('one h1, the breadcrumb, and an explicit h2 over every region', async () => {
  mockApi({
    matchups: [viewerRow(), otherRow()],
    viewerTeamId: 10,
    rosters: [{ teamId: 10, teamName: 'My Team', players: [{ id: 99, name: 'Speedy Runner' }] }],
  });
  renderPage();

  await screen.findByTestId('matchup-hero');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1, name: 'Game Center' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Your matchup' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'League matchups' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Scoring feed' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Week at a glance' })).toBeInTheDocument();

  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const breadcrumbList = within(nav).getByRole('list');
  expect(breadcrumbList).toHaveAttribute('role', 'list');
  expect(within(nav).getByRole('link', { name: 'Leagues' })).toHaveAttribute('href', '/league');
  expect(within(nav).getByRole('link', { name: 'Sunday Ballers' })).toHaveAttribute('href', '/league/1');
  expect(within(nav).getByText('Game Center')).toHaveAttribute('aria-current', 'page');

  // House style: no em dash and no emoji anywhere on the page.
  expect(document.body.textContent).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
});

// --- hero and grid ---------------------------------------------------------

test('the hero renders the viewer Matchup and the grid the rest', async () => {
  mockApi({
    matchups: [viewerRow(), otherRow(), otherRow({ id: 3, home_team_id: 50, away_team_id: 60, home_team_name: 'Other C', away_team_name: 'Other D' })],
    viewerTeamId: 10,
  });
  renderPage();

  const heroCard = await screen.findByTestId('matchup-hero');
  expect(within(heroCard).getByTestId('matchup-hero-side-home')).toHaveTextContent('My Team');
  expect(within(heroCard).getByTestId('matchup-hero-side-away')).toHaveTextContent('Rival');
  // The You pill sits on the viewer's side, matched by Team id (#112).
  expect(within(heroCard).getByTestId('matchup-hero-side-home')).toHaveAttribute('data-viewer-team', 'true');
  expect(within(heroCard).getByText('You')).toBeInTheDocument();

  // The grid holds the other two and never the viewer's.
  expect(cards()).toHaveLength(2);
  expect(card(1)).toBeUndefined();
  expect(card(2)).toHaveTextContent('Other A');
  expect(card(3)).toHaveTextContent('Other C');
  expect(screen.getByTestId('game-center-grid-count')).toHaveTextContent('2 more');
  // Every card is itself the link to its box score; so is the hero's Matchup link
  // (renamed from Compare rosters).
  expect(card(2).tagName).toBe('A');
  expect(card(2)).toHaveAttribute('href', '/league/1/matchups/2');
  expect(within(heroCard).getByRole('link', { name: /^Matchup, My Team against Rival/ })).toHaveAttribute('href', '/league/1/matchups/1');
});

test('a viewer with no Team on this league gets no hero and every Matchup in the grid', async () => {
  mockApi({ matchups: [viewerRow(), otherRow()], viewerTeamId: null });
  renderPage();

  await screen.findByRole('heading', { level: 2, name: 'League matchups' });
  expect(screen.queryByTestId('matchup-hero')).not.toBeInTheDocument();
  expect(cards()).toHaveLength(2);
  expect(screen.queryByTestId('game-center-grid-count')).not.toBeInTheDocument();
});

test('records and ranks come from the standings read and reach the hero and the grid', async () => {
  mockApi({
    matchups: [viewerRow(), otherRow()],
    viewerTeamId: 10,
    standings: [
      { teamId: 30, wins: 4, losses: 0, ties: 0, rank: 1 },
      { teamId: 10, wins: 3, losses: 1, ties: 0, rank: 2 },
      { teamId: 20, wins: 2, losses: 2, ties: 0, rank: 3 },
      { teamId: 40, wins: 1, losses: 2, ties: 1, rank: 4 },
    ],
  });
  renderPage();

  const heroCard = await screen.findByTestId('matchup-hero');
  const homeRecord = await within(within(heroCard).getByTestId('matchup-hero-side-home')).findByTestId('matchup-hero-record');
  expect(homeRecord).toHaveTextContent('3-1 · 2nd in league');
  expect(within(within(heroCard).getByTestId('matchup-hero-side-away')).getByTestId('matchup-hero-record')).toHaveTextContent('2-2 · 3rd in league');
  const other = card(2);
  expect(within(other).getByTestId('matchup-side-home')).toHaveTextContent('Other A 4-0');
  expect(within(other).getByTestId('matchup-side-home')).toHaveTextContent('Exp final 90.0');
  expect(within(other).getByTestId('matchup-side-home')).toHaveTextContent('3 players remaining');
  expect(within(other).getByTestId('matchup-side-away')).toHaveTextContent('Other B 1-2-1');
  expect(within(other).getByTestId('matchup-side-away')).toHaveTextContent('Exp final 95.0');
  // The standings read is one request, keyed by the league's current week.
  expect(apiClient.get.mock.calls.filter(([url]) => url.endsWith('/standings'))).toHaveLength(1);
});

test('the hero footer carries the earliest kickoff among the week\'s scheduled Matchups', async () => {
  const earlier = '2026-09-13T17:00:00.000Z';
  const later = '2026-09-14T00:20:00.000Z';
  mockApi({
    matchups: [
      viewerRow(),
      otherRow({ id: 2, status: 'scheduled', first_kickoff_at: later }),
      otherRow({ id: 3, status: 'scheduled', first_kickoff_at: earlier, home_team_id: 50, away_team_id: 60 }),
      // Week 2's kickoff is not this week's.
      otherRow({ id: 4, week: 2, status: 'scheduled', first_kickoff_at: '2026-09-01T00:00:00.000Z', home_team_id: 70, away_team_id: 80 }),
    ],
    viewerTeamId: 10,
  });
  renderPage();

  const facts = await screen.findByTestId('matchup-hero-footer-facts');
  const expected = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(earlier));
  expect(facts).toHaveTextContent(`Next kickoff ${expected}`);
  expect(facts).not.toHaveTextContent(/in progress/);
});

// --- the sync line ---------------------------------------------------------

const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const liveGame = (game_status) => ({
  tank01_game_id: 'g1', week: 1, game_status, away_team: 'GB', home_team: 'CHI', current_score_away: 10, current_score_home: 7,
});

test('the sync line says it refreshes every minute while an NFL game is in progress, with no countdown', async () => {
  installLiveGames([liveGame('in_progress')]);
  const syncedAt = new Date(Date.now() - 20000).toISOString();
  mockApi({ matchups: [viewerRow({ nfl_game_ids: ['g1'], synced_at: syncedAt }), otherRow({ synced_at: syncedAt })], viewerTeamId: 10 });
  renderPage();

  const line = await screen.findByTestId('game-center-sync');
  await waitFor(() => expect(line).toHaveTextContent(`Scores synced ${clock(syncedAt)} · refreshes every minute`));
  expect(line).not.toHaveTextContent('next pass');
});

// #2392 QA: a Matchup stays live from a final Thursday starter until Sunday, and the live pass sleeps in between,
// so the refresh tail follows games in progress, not the Live chip.
test('a live Matchup with no NFL game in progress shows the sync time alone', async () => {
  installLiveGames([liveGame('final')]);
  const syncedAt = new Date(Date.now() - 20000).toISOString();
  mockApi({ matchups: [viewerRow({ nfl_game_ids: ['g1'], synced_at: syncedAt }), otherRow({ synced_at: syncedAt })], viewerTeamId: 10 });
  renderPage();

  await screen.findByTestId('game-center-nfl-games');
  expect(screen.getByTestId('game-center-sync').textContent.trim()).toBe(`Scores synced ${clock(syncedAt)}`);
});

test('the sync line is omitted while the week has no syncedAt', async () => {
  mockApi({ matchups: [viewerRow(), otherRow()], viewerTeamId: 10 });
  renderPage();

  await screen.findByTestId('matchup-hero');
  expect(screen.queryByTestId('game-center-sync')).not.toBeInTheDocument();
});

test('syncLineText: the refresh tail rides only on a live week', () => {
  const at = '2026-09-13T20:13:00.000Z';
  expect(syncLineText(null, true)).toBeNull();
  expect(syncLineText('not a date', true)).toBeNull();
  expect(syncLineText(at, true)).toBe(`Scores synced ${clock(at)} · refreshes every minute`);
  expect(syncLineText(at, false)).toBe(`Scores synced ${clock(at)}`);
});

// --- week at a glance ------------------------------------------------------

// A week every glance fact can be read from: two live Matchups and one still
// scheduled. Shared by the desktop and the mobile glance cases.
const glanceWeek = () => [
  row({ id: 1, status: 'live', home_team_id: 10, away_team_id: 20, home_team_name: 'Alpha', away_team_name: 'Beta', home_score: '101.3', away_score: '97.9', home_expected_final: 105, away_expected_final: 130, home_players_remaining: 2, away_players_remaining: 3 }),
  row({ id: 2, status: 'live', home_team_id: 30, away_team_id: 40, home_team_name: 'Gamma', away_team_name: 'Delta', home_score: '88.0', away_score: '72.2', home_expected_final: 90, away_expected_final: 80, home_players_remaining: 4, away_players_remaining: 5 }),
  row({ id: 3, status: 'scheduled', home_team_id: 50, away_team_id: 60, home_team_name: 'Epsilon', away_team_name: 'Zeta', home_score: '0', away_score: '0', home_expected_final: 140, away_expected_final: 120, home_players_remaining: 9, away_players_remaining: 9 }),
];

// Red-tell (#897): deriving the top score from Expected final instead of the
// score turns this case red and no other. Beta's Expected final (130) and
// Epsilon's (140) both exceed Alpha's score (101.3); Alpha still tops the week.
test('the glance tile\'s top score is the highest score in the week, never an Expected final', async () => {
  mockApi({ matchups: glanceWeek() });
  renderPage();

  const glanceCard = await screen.findByTestId('week-glance');
  const glanceList = within(glanceCard).getByRole('list');
  expect(glanceList).toHaveAttribute('role', 'list');
  expect(within(glanceRow('top-score')).getByTestId('week-glance-text')).toHaveTextContent('Alpha');
  expect(within(glanceRow('top-score')).getByTestId('week-glance-value')).toHaveTextContent('101.3');
  expect(within(glanceRow('closest')).getByTestId('week-glance-text')).toHaveTextContent('Alpha · Beta');
  expect(within(glanceRow('closest')).getByTestId('week-glance-value')).toHaveTextContent('3.4');
  expect(within(glanceRow('biggest-lead')).getByTestId('week-glance-text')).toHaveTextContent('Gamma over Delta');
  expect(within(glanceRow('biggest-lead')).getByTestId('week-glance-value')).toHaveTextContent('15.8');
  // Players remaining sums every side of the week (the server's one definition), the scheduled Matchup included.
  expect(glanceRow('players-remaining')).toHaveTextContent('Players remaining');
  expect(within(glanceRow('players-remaining')).getByTestId('week-glance-text')).toHaveTextContent('Starters league-wide');
  expect(within(glanceRow('players-remaining')).getByTestId('week-glance-value')).toHaveTextContent('32');
});

test('weekGlanceFacts: a row whose fact is not derivable is left out, and a week with none has no tile', async () => {
  const scheduledOnly = [
    matchupFromListRow(row({ id: 3, status: 'scheduled', home_players_remaining: 9, away_players_remaining: 9, home_expected_final: 140 })),
  ];
  // Nothing has started: no top score, no closest, no lead; the starters
  // set to play are known, and the row says so (nothing is live to be "remaining").
  expect(weekGlanceFacts(scheduledOnly).map((r) => r.key)).toEqual(['players-remaining']);
  expect(weekGlanceFacts(scheduledOnly)[0]).toMatchObject({ label: 'Starters set to play', value: '18' });
  // Every started Matchup tied: closest is derivable, a lead is not. (The
  // Expected finals are here only so the top-score row's presence does not
  // depend on which figure derives it; the red-tell case above binds that.)
  const tied = [
    matchupFromListRow(row({ id: 1, status: 'live', home_score: '50', away_score: '50', home_expected_final: 60, away_expected_final: 60 })),
  ];
  expect(weekGlanceFacts(tied).map((r) => r.key)).toEqual(['top-score', 'closest']);
  // Nothing derivable at all.
  expect(weekGlanceFacts([matchupFromListRow(row({ id: 3, status: 'scheduled' }))])).toEqual([]);
  expect(weekGlanceFacts([])).toEqual([]);

  mockApi({ matchups: [row({ id: 3, status: 'scheduled' })] });
  renderPage();
  await screen.findByRole('heading', { level: 2, name: 'League matchups' });
  expect(screen.queryByTestId('week-glance')).not.toBeInTheDocument();
});

// Red-tell (#897): deriving the glance rows under "All weeks" (dropping the
// All guard in useGameCenter) renders the tile with cross-week facts and turns
// this case red; the per-week cases above stay green either way.
test('the Week at a glance tile is not rendered under All weeks, and a week brings it back', async () => {
  mockApi({
    matchups: [
      ...glanceWeek(),
      row({ id: 4, week: 2, status: 'live', home_team_id: 70, away_team_id: 80, home_team_name: 'Eta', away_team_name: 'Theta', home_score: '150.0', away_score: '10.0' }),
    ],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
  });
  renderPage();

  await screen.findByTestId('week-glance');
  expect(within(glanceRow('top-score')).getByTestId('week-glance-value')).toHaveTextContent('101.3');

  await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
  expect(screen.queryByTestId('week-glance')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Week at a glance' })).not.toBeInTheDocument();
  // The rest of the rail is still up: only the per-week tile is gone.
  expect(screen.getByRole('heading', { level: 2, name: 'Scoring feed' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('radio', { name: 'Wk 2' }));
  expect(within(glanceRow('top-score')).getByTestId('week-glance-value')).toHaveTextContent('150.0');
});

// --- the live feed: one model update reaches the DOM ----------------------

test('a scores:updated event moves a card\'s score and chip with no refetch', async () => {
  mockApi({ matchups: [row({ id: 5, status: 'scheduled', home_expected_final: 100, away_expected_final: 140 })] });
  renderPage();

  await screen.findByRole('heading', { level: 2, name: 'League matchups' });
  const before = card(5);
  expect(before).toHaveAttribute('data-state', 'scheduled');
  // Before kickoff the card's big number is the projected total.
  expect(within(within(before).getByTestId('matchup-side-home')).getByTestId('matchup-figure')).toHaveTextContent('100.0');

  emitScores({
    leagueId: 1,
    week: 1,
    scored: [{ matchupId: 5, homeScore: 21, awayScore: 14, status: 'live', homeExpectedFinal: 104.6, awayExpectedFinal: 131.3 }],
    plays: [],
  });

  const after = card(5);
  expect(within(within(after).getByTestId('matchup-side-home')).getByTestId('matchup-figure')).toHaveTextContent('21.0');
  expect(within(within(after).getByTestId('matchup-side-away')).getByTestId('matchup-figure')).toHaveTextContent('14.0');
  // Board black says live: the tile carries no chip (the Live chip is the h1 row's and the hero's).
  expect(after).toHaveAttribute('data-state', 'live');
  expect(within(after).queryByTestId('matchup-status')).not.toBeInTheDocument();
  expect(within(after).getByTestId('matchup-side-home')).toHaveTextContent('Exp final 104.6');
  // No refetch of the list and no per-card fetch rode the event.
  expect(apiClient.get.mock.calls.filter(([url]) => url.endsWith('/matchups'))).toHaveLength(1);
  expect(apiClient.get).not.toHaveBeenCalledWith('/api/league/1/matchups/5');
});

test('a scores:updated event moves the hero and the glance tile too', async () => {
  mockApi({ matchups: [viewerRow(), otherRow()], viewerTeamId: 10 });
  renderPage();

  const heroCard = await screen.findByTestId('matchup-hero');
  expect(within(within(heroCard).getByTestId('matchup-hero-side-home')).getByTestId('matchup-hero-score')).toHaveTextContent('30.0');
  // The glance row read here is the biggest lead (30.0 - 20.0), deliberately
  // not the top score: the top-score derivation has its own red-tell case
  // above, and this case must stay green under that case's mutation.
  expect(within(glanceRow('biggest-lead')).getByTestId('week-glance-text')).toHaveTextContent('My Team over Rival');
  expect(within(glanceRow('biggest-lead')).getByTestId('week-glance-value')).toHaveTextContent('10.0');

  emitScores({
    leagueId: 1,
    week: 1,
    scored: [{ matchupId: 1, homeScore: 44.5, awayScore: 20, status: 'live' }],
    plays: [],
  });

  expect(within(within(heroCard).getByTestId('matchup-hero-side-home')).getByTestId('matchup-hero-score')).toHaveTextContent('44.5');
  expect(within(glanceRow('biggest-lead')).getByTestId('week-glance-value')).toHaveTextContent('24.5');
});

// A socket reconnect re-joins the room and refetches silently: the scoreboard
// on screen stays up and no skeleton region appears (F1).
test('a reconnect refetches without blanking the scoreboard with skeletons', async () => {
  mockApi({ matchups: [row({ id: 5, status: 'live', home_score: '21.0', away_score: '14.0' })] });
  renderPage();

  await screen.findByRole('heading', { level: 2, name: 'League matchups' });
  expect(within(within(card(5)).getByTestId('matchup-side-home')).getByTestId('matchup-figure')).toHaveTextContent('21.0');

  // The reconnect's refetch never resolves here, so any first-load flag it set
  // would still be showing the skeletons when we assert.
  apiClient.get.mockReturnValue(new Promise(() => {}));
  act(() => { socket.reconnect(); });

  expect(screen.queryByTestId('game-center-loading')).not.toBeInTheDocument();
  expect(within(within(card(5)).getByTestId('matchup-side-home')).getByTestId('matchup-figure')).toHaveTextContent('21.0');
  const joins = socket.emit.mock.calls.filter(([event]) => event === 'league:join');
  expect(joins).toHaveLength(2);
});

test('a Team rename reaches the hero and the ticker with no request', async () => {
  mockApi({
    matchups: [viewerRow(), otherRow()],
    viewerTeamId: 10,
    rosters: [{ teamId: 10, teamName: 'My Team', players: [{ id: 99, name: 'Speedy Runner' }] }],
  });
  renderPage();

  const heroCard = await screen.findByTestId('matchup-hero');
  emitScores({
    leagueId: 1,
    week: 1,
    scored: [],
    plays: [{ playerId: 99, name: 'Speedy Runner', nflTeam: 'MIN', type: 'rushing', pointsDelta: 6, isTouchdown: true }],
  });
  expect(feedRows()[0]).toHaveTextContent('My Team');

  act(() => { publishTeamProfileUpdate({ leagueId: 1, teamId: 10, name: 'Renamed Team' }); });

  expect(within(heroCard).getByTestId('matchup-hero-side-home')).toHaveTextContent('Renamed Team');
  expect(feedRows()[0]).toHaveTextContent('Renamed Team');
  expect(apiClient.get.mock.calls.filter(([url]) => url.endsWith('/rosters'))).toHaveLength(1);
});

// --- the week picker and its default --------------------------------------

test('the default week matches computeDefaultWeek: the league\'s current week when it has Matchups', async () => {
  const rows = [
    row({ id: 1, week: 1, final: true, home_score: '90', away_score: '80' }),
    row({ id: 2, week: 2, status: 'live', home_score: '10', away_score: '5' }),
    row({ id: 3, week: 3 }),
  ];
  const league = { id: 1, name: 'Sunday Ballers', current_week: 2 };
  mockApi({ matchups: rows, league });
  renderPage();

  const expected = computeDefaultWeek(league, rows.map(matchupFromListRow), [1, 2, 3]);
  expect(expected).toBe(2);
  expect(await screen.findByRole('radio', { name: 'Wk 2' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'Wk 1' })).toHaveAttribute('aria-checked', 'false');
  // Only week 2's Matchup is on screen.
  expect(cards()).toHaveLength(1);
  expect(card(2)).toBeDefined();
});

test('the default week matches computeDefaultWeek: the latest unfinished week when the current week has none', async () => {
  const rows = [
    row({ id: 1, week: 1, final: true, home_score: '90', away_score: '80' }),
    row({ id: 2, week: 2, status: 'live', home_score: '10', away_score: '5' }),
    row({ id: 3, week: 3, status: 'scheduled' }),
  ];
  const league = { id: 1, name: 'Sunday Ballers', current_week: 9 };
  mockApi({ matchups: rows, league });
  renderPage();

  expect(computeDefaultWeek(league, rows.map(matchupFromListRow), [1, 2, 3])).toBe(3);
  expect(await screen.findByRole('radio', { name: 'Wk 3' })).toHaveAttribute('aria-checked', 'true');
  expect(cards()).toHaveLength(1);
  expect(card(3)).toBeDefined();
});

test('picking a week filters the grid; All weeks shows every Matchup', async () => {
  mockApi({
    matchups: [row({ id: 1, week: 1 }), row({ id: 2, week: 2, home_team_id: 30, away_team_id: 40 })],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
  });
  renderPage();

  await screen.findByRole('radio', { name: 'Wk 1' });
  expect(cards()).toHaveLength(1);
  await userEvent.click(screen.getByRole('radio', { name: 'Wk 2' }));
  expect(cards()).toHaveLength(1);
  expect(card(2)).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
  expect(cards()).toHaveLength(2);
});

test('for an away viewer the grid names the viewer Team first on its own Matchup card and home first on every other (#2403)', async () => {
  mockApi({
    matchups: [
      viewerRow({ id: 1, week: 1 }),
      viewerRow({ id: 4, week: 2 }),
      otherRow({ id: 2, week: 2 }),
    ],
    viewerTeamId: 20,
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
  });
  renderPage();

  await screen.findByTestId('matchup-hero');
  await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
  // Week 2's own Matchup: the viewer (Rival, seated away) first, the home Team second.
  expect(within(card(4)).getByTestId('matchup-side-home')).toHaveTextContent('Rival');
  expect(within(card(4)).getByTestId('matchup-side-away')).toHaveTextContent('My Team');
  // Another Matchup stays home first.
  expect(within(card(2)).getByTestId('matchup-side-home')).toHaveTextContent('Other A');
  expect(within(card(2)).getByTestId('matchup-side-away')).toHaveTextContent('Other B');
});

// --- the ticker and feed --------------------------------------------------

test('the ticker names the fantasy Team from the rosters read and filters plays by the week on screen', async () => {
  mockApi({
    matchups: [row({ id: 5, week: 1, status: 'live' }), row({ id: 6, week: 2, home_team_id: 30, away_team_id: 40 })],
    league: { id: 1, name: 'Sunday Ballers', current_week: 1 },
    rosters: [
      { teamId: 10, teamName: 'Home Team', players: [{ id: 99, name: 'Speedy Runner' }] },
      { teamId: 30, teamName: 'Week Two Team', players: [{ id: 77, name: 'Late Bloomer' }] },
    ],
  });
  renderPage();

  await screen.findByRole('radio', { name: 'Wk 1' });
  // Idle before the first play of the week lands: the feed says so and the strip is not drawn.
  expect(screen.getByTestId('scoring-feed')).toHaveTextContent('Live scoring plays will appear here once games kick off.');
  expect(screen.queryByTestId('scoring-strip')).not.toBeInTheDocument();

  emitScores({
    leagueId: 1,
    week: 1,
    scored: [],
    plays: [{ playerId: 99, name: 'Speedy Runner', nflTeam: 'MIN', type: 'rushing', pointsDelta: 6, isTouchdown: true }],
  });

  // Desktop draws no strip (the rail's feed shows the plays); the feed row carries the play.
  expect(screen.queryByTestId('scoring-strip')).not.toBeInTheDocument();
  expect(feedRows()).toHaveLength(1);
  expect(feedRows()[0]).toHaveTextContent('Speedy Runner');
  expect(feedRows()[0]).toHaveTextContent('Home Team');

  // A play from another week is held but not shown while week 1 is on screen.
  emitScores({
    leagueId: 1,
    week: 2,
    scored: [],
    plays: [{ playerId: 77, name: 'Late Bloomer', nflTeam: 'GB', type: 'receiving', pointsDelta: 7.5, isTouchdown: true }],
  });
  expect(feedRows()).toHaveLength(1);
  expect(screen.getByTestId('scoring-feed')).not.toHaveTextContent('Late Bloomer');

  // A play by a player no Team rosters is not a league play.
  emitScores({
    leagueId: 1,
    week: 1,
    scored: [],
    plays: [{ playerId: 12345, name: 'Free Agent', type: 'rushing', pointsDelta: 6, isTouchdown: true }],
  });
  expect(feedRows()).toHaveLength(1);

  // Every week: both plays, newest first.
  await userEvent.click(screen.getByRole('button', { name: 'All weeks' }));
  expect(feedRows()).toHaveLength(2);
  expect(feedRows()[0]).toHaveTextContent('Late Bloomer');
  expect(feedRows()[0]).toHaveTextContent('Week Two Team');
});

test('a play by a side of the viewer\'s Matchup carries that side to the feed', async () => {
  mockApi({
    matchups: [viewerRow(), otherRow()],
    viewerTeamId: 10,
    rosters: [
      { teamId: 10, teamName: 'My Team', players: [{ id: 1, name: 'Mine' }] },
      { teamId: 20, teamName: 'Rival', players: [{ id: 2, name: 'Theirs' }] },
      { teamId: 30, teamName: 'Other A', players: [{ id: 3, name: 'Elsewhere' }] },
    ],
  });
  renderPage();

  await screen.findByTestId('matchup-hero');
  emitScores({
    leagueId: 1,
    week: 1,
    scored: [],
    plays: [
      { playerId: 1, name: 'Mine', type: 'rushing', pointsDelta: 6, isTouchdown: true },
      { playerId: 2, name: 'Theirs', type: 'rushing', pointsDelta: 6, isTouchdown: true },
      { playerId: 3, name: 'Elsewhere', type: 'rushing', pointsDelta: 6, isTouchdown: true },
    ],
  });

  const sides = screen.getAllByTestId('scoring-feed-side').map((el) => el.getAttribute('data-side'));
  // A neutral play (another matchup) carries no side text at all.
  expect(sides).toEqual(['home', 'away']);
});

// --- mobile ---------------------------------------------------------------

test('below the sm breakpoint the grid renders rows, the feed shows three and the picker fills', async () => {
  mobile = true;
  mockApi({
    matchups: [row({ id: 5, week: 1, status: 'live' })],
    rosters: [{
      teamId: 10,
      teamName: 'Home Team',
      players: [1, 2, 3, 4].map((id) => ({ id, name: `Player ${id}` })),
    }],
  });
  renderPage();

  await screen.findByRole('radio', { name: 'Wk 1' });
  expect(screen.getByTestId('matchup-grid')).toHaveAttribute('data-layout', 'rows');
  expect(card(5)).toHaveAttribute('data-layout', 'row');

  emitScores({
    leagueId: 1,
    week: 1,
    scored: [],
    plays: [1, 2, 3, 4].map((id) => ({ playerId: id, name: `Player ${id}`, type: 'rushing', pointsDelta: 6, isTouchdown: true })),
  });
  expect(feedRows()).toHaveLength(3);
  expect(screen.getByTestId('scoring-feed-show-all')).toHaveTextContent('Show all 4 plays');
});

// The picker scrolls its own week strip below sm (#916), but a scroll
// container only scrolls if an ancestor lets it: the header row is a grid
// item, and a grid item's automatic minimum size is content-based, so without
// `minWidth: 0` on that row the grid measures a whole season of segments and
// the document grows past the phone, which is the dead strip beside every
// card the issue reports. jsdom lays nothing out, so the rule is the binding;
// it was measured in headless Chromium at a 390px viewport, on this page's
// own DOM and rules: 1366px of document without it, exactly 390 with.
//
// Red-tell (#916 review): deleting `minWidth: 0` from the header row's sx in
// GameCenterPage.jsx turns this jsdom case red AND the layout guard's
// "Game Center @ 390x844" width case (tests/e2e/game-center-matchup-layout.spec.ts,
// #920), which measured the document at 1347px inside a 390px viewport with the
// zero removed, and 390px with it. This rule binds the CSS; that e2e case binds
// the rendered geometry.
test('below the sm breakpoint the header row can shrink below the week strip it holds', async () => {
  mobile = true;
  mockApi({ matchups: [row({ id: 5, week: 1, status: 'live' })] });
  renderPage();

  await screen.findByRole('radio', { name: 'Wk 1' });
  const header = screen.getByTestId('game-center-header');
  expect(header).toContainElement(screen.getByTestId('pick-week'));
  // Zero at every width, which is safe only because the strip inside it
  // scrolls at every width (#921). Paired with a strip that does NOT scroll,
  // this same zero is what let the strip overflow onto the "All weeks" button
  // beside it above `sm`: measured in Chromium on this page's DOM, 45.61px of
  // overlap at 1440px with 14 weeks and 282.75px with 18, and a document of
  // 1532px inside a 1440px viewport. With the strip scrolling, the button
  // clears the strip by a structural 56px at every width from 600 to 1920.
  // Red-tell: deleting `minWidth: 0` from the header row's sx turns this case
  // red and no other.
  expect(rulesUnder(header)['']).toMatch(/min-width:\s*0/);
  // The strip itself is the scroll container inside that row.
  expect(rulesUnder(screen.getByRole('radiogroup', { name: 'Week' }))['']).toMatch(/overflow-x:\s*auto/);
});

// The title column is the OTHER half of that rule, and it points the other
// way. It holds words, not a scroll container, so a zero minimum there does
// not let it clip: it lets the h1 overflow its own column onto the picker's
// first chevron. #917 gave it one, and Chromium measured "CENTER" (min-content
// 104.86px) sitting 11.47px over the picker between 600 and 730px with a full
// season, on a week with no sync line. jsdom lays nothing out, so the rule is
// the binding.
//
// Red-tell (#921): putting `minWidth: 0` back on the title column's sx in
// GameCenterPage.jsx turns this jsdom case red AND the layout guard's
// "Game Center @ 640x900" header-region overlap case
// (tests/e2e/game-center-matchup-layout.spec.ts, #920), which measured the h1
// overlapping the week picker by 11x38px with the zero added (its fixture serves
// no sync line, the condition this case measured). The e2e case compares
// bounding boxes because the h1 overflows UNDER the picker's chevron, which is
// painted on top, so an elementFromPoint hit test cannot see it; this rule binds
// the CSS, that e2e case binds the rendered geometry.
test('the title column keeps its content minimum, so the h1 cannot overflow onto the picker', async () => {
  mockApi({ matchups: [row({ id: 5, week: 1, status: 'live' })] });
  renderPage();

  await screen.findByRole('radio', { name: 'Wk 1' });
  const title = screen.getByTestId('game-center-title');
  expect(title).toContainElement(screen.getByRole('heading', { level: 1, name: 'Game Center' }));
  // Read the column's own rule first, so a harness that hands back nothing
  // fails here rather than passing the absence assertion for free.
  const rule = rulesUnder(title)[''];
  expect(rule).toMatch(/display:\s*grid/);
  expect(rule).not.toMatch(/min-width/);
});

// The canvas's mobile artboard (build.mjs `gameCenterMobile()`) ends at the
// three-row feed with no Week at a glance tile; the same week renders the
// tile at desktop width in the red-tell case above.
test('below the sm breakpoint the Week at a glance tile is not rendered', async () => {
  mobile = true;
  mockApi({ matchups: glanceWeek() });
  renderPage();

  await screen.findByRole('heading', { level: 2, name: 'League matchups' });
  expect(screen.getByTestId('matchup-grid')).toHaveAttribute('data-layout', 'rows');
  expect(screen.queryByTestId('week-glance')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Week at a glance' })).not.toBeInTheDocument();
});

// --- Play-select wave 2 (ADR 0067, spec #2334) -----------------------------

// The Live chip is a span whose first child is its aria-hidden square dot; the screen-reader "Live" text a
// game tile carries is not one.
const liveChips = () => Array.from(document.querySelectorAll('span'))
  .filter((el) => el.textContent === 'Live' && el.firstElementChild?.getAttribute('aria-hidden') === 'true');

const playsFor = (ids) => ids.map((id) => ({
  playerId: id, name: `Player ${id}`, type: 'rushing', pointsDelta: 6, isTouchdown: true,
}));
const rosterFor = (ids) => [{ teamId: 10, teamName: 'My Team', players: ids.map((id) => ({ id, name: `Player ${id}` })) }];

describe('Play-select', () => {
  test('a live week wears no cursor and no filled action (AC 3)', async () => {
    mockApi({ matchups: [viewerRow(), otherRow()], viewerTeamId: 10 });
    renderPage();

    await screen.findByTestId('matchup-hero');
    expect(document.querySelectorAll('.cursor')).toHaveLength(0);
    expect(document.querySelectorAll('[data-filled="true"]')).toHaveLength(0);
    // PsButton's own marker: a filled action is data-variant="fill"; the page's Set lineup is a ghost.
    expect(document.querySelectorAll('[data-variant="fill"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-variant="ghost"]').length).toBeGreaterThan(0);
  });

  test('exactly two Live chips while live: the h1 row and the hero, none on the tiles or the NFL strip (AC 6j)', async () => {
    installLiveGames([
      {
        tank01_game_id: 'g1', week: 1, game_status: 'in_progress', away_team: 'GB', home_team: 'CHI', current_score_away: 10, current_score_home: 7, quarter: 'Q2', time_remaining: '8:12',
      },
      {
        tank01_game_id: 'g2', week: 1, game_status: 'in_progress', away_team: 'MIN', home_team: 'DET', current_score_away: 3, current_score_home: 0, quarter: 'Q1', time_remaining: '2:00',
      },
    ]);
    mockApi({
      matchups: [viewerRow({ nfl_game_ids: ['g1', 'g2'] }), otherRow(), otherRow({ id: 3, home_team_id: 50, away_team_id: 60 })],
      viewerTeamId: 10,
    });
    renderPage();

    await screen.findByTestId('matchup-hero');
    const nflStrip = await screen.findByTestId('game-center-nfl-games');
    // The strip's own hidden "Live" text is exercised (live tiles carry it) and is not a chip.
    expect(within(nflStrip).getAllByText('Live').length).toBeGreaterThan(0);
    expect(liveChips()).toHaveLength(2);
    expect(within(screen.getByTestId('game-center-title')).getAllByText('Live')).toHaveLength(1);
    expect(within(screen.getByTestId('matchup-hero')).getAllByText('Live')).toHaveLength(1);
    expect(within(screen.getByTestId('matchup-grid')).queryByText('Live')).not.toBeInTheDocument();
  });

  test('a week with nothing live has no Live chip, and the hero is the framed panel with Kickoff and no 0.0', async () => {
    mockApi({
      matchups: [
        viewerRow({ status: 'scheduled', home_score: '0', away_score: '0', first_kickoff_at: '2026-09-13T17:00:00.000Z' }),
        otherRow({ status: 'scheduled', home_score: '0', away_score: '0' }),
      ],
      viewerTeamId: 10,
    });
    renderPage();

    const hero = await screen.findByTestId('matchup-hero');
    expect(liveChips()).toHaveLength(0);
    expect(within(hero).getByTestId('matchup-hero-kickoff')).toHaveTextContent('Kickoff');
    expect(hero).not.toHaveTextContent(/(^|[^0-9])0[.]0([^0-9]|$)/);
    expect(hero).not.toHaveTextContent('Next kickoff');
    expect(within(hero).getByTestId('matchup-hero-side-home')).toHaveTextContent('Proj');
    expect(within(hero).getByTestId('matchup-hero-side-home')).toHaveTextContent('5 starters set to play');
    // RULINGS Critique 10 item 13: the League matchups head says it once, with the earliest kickoff.
    expect(screen.getAllByText(/projected totals/)).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'League matchups' })).toHaveTextContent(/All games kick off .+ · projected totals/);
  });

  test('desktop draws no latest-plays strip, and the rail feed carries the plays (AC 6b)', async () => {
    mockApi({ matchups: [viewerRow()], viewerTeamId: 10, rosters: rosterFor([1, 2]) });
    renderPage();
    await screen.findByTestId('matchup-hero');
    emitScores({ leagueId: 1, week: 1, scored: [], plays: playsFor([1, 2]) });
    expect(screen.queryByTestId('scoring-strip')).not.toBeInTheDocument();
    expect(feedRows()).toHaveLength(2);
  });

  test('on a phone the strip is back with the newest play only', async () => {
    mobile = true;
    mockApi({ matchups: [viewerRow()], viewerTeamId: 10, rosters: rosterFor([1, 2]) });
    renderPage();
    await screen.findByTestId('matchup-hero');
    emitScores({ leagueId: 1, week: 1, scored: [], plays: playsFor([1, 2]) });
    const stripRegion = screen.getByRole('region', { name: 'Recent league scoring plays' });
    expect(within(stripRegion).getAllByTestId('scoring-strip-play')).toHaveLength(1);
    expect(stripRegion).toHaveTextContent('Latest plays');
    expect(within(stripRegion).queryByText('Live')).not.toBeInTheDocument();
  });

  test('the hero and the tile print players remaining from the one count, and the glance row sums them (AC 6l)', async () => {
    mockApi({ matchups: [viewerRow({ home_yet_to_play: 2, away_yet_to_play: 3 }), otherRow()], viewerTeamId: 10 });
    renderPage();
    const hero = await screen.findByTestId('matchup-hero');
    expect(within(hero).getByTestId('matchup-hero-side-home')).toHaveTextContent('5 players remaining');
    expect(within(card(2)).getByTestId('matchup-side-home')).toHaveTextContent('3 players remaining');
    // 5 + 4 + 3 + 3.
    expect(within(glanceRow('players-remaining')).getByTestId('week-glance-value')).toHaveTextContent('15');
  });

  test('the live hero sentence names their players remaining', async () => {
    mockApi({ matchups: [viewerRow({ home_yet_to_play: 2, away_yet_to_play: 3 }), otherRow()], viewerTeamId: 10 });
    renderPage();
    const hero = await screen.findByTestId('matchup-hero');
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent(/they have 4 players remaining/);
  });

  // The lineups the note reads (the viewer is home): one QB, the FLEX slot empty.
  const SLOTS = [{ key: 'QB', count: 1 }, { key: 'FLEX', count: 1 }];
  const noteLeague = { id: 1, name: 'Sunday Ballers', current_week: 1, roster_slots: SLOTS };
  const lineupDetail = ({ week = 1, bench = [], awayStarters = [] } = {}) => ({
    matchup: {
      id: 1, season: 2026, week, status: 'live', home_score: '30.0', away_score: '20.0',
    },
    home: {
      teamId: 10, name: 'My Team', starters: [{ id: 1, slot: 'QB', name: 'Quarterback', game_state: 'in_progress' }], bench,
    },
    away: {
      teamId: 20, name: 'Rival', starters: awayStarters, bench: [],
    },
    viewerTeamId: 10,
    nflGameIds: [],
  });

  test('the server yetToPlay prints in the hero sentence, never the helpers\' numbers from the lineups', async () => {
    // The lineups the note reads would say 2 remaining and 2 yet to play for them; the sentence prints the server's pair.
    mockApi({
      matchups: [viewerRow({ home_yet_to_play: 2, away_yet_to_play: 3 }), otherRow()],
      viewerTeamId: 10,
      league: noteLeague,
      detail: lineupDetail({ awayStarters: [{ id: 5, slot: 'QB', game_state: 'scheduled' }, { id: 6, slot: 'FLEX', game_state: 'scheduled' }] }),
      actionItems: [lineupItemFor(new Date(Date.now() + 45 * 60000).toISOString())],
    });
    renderPage();
    const hero = await screen.findByTestId('matchup-hero');
    await screen.findByTestId('lineup-note');
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent(/they have 4 players remaining, 3 yet to play/);
    expect(within(hero).getByTestId('matchup-hero-side-away')).toHaveTextContent('4 players remaining');
  });

  const lineupItemFor = (lock, extra = {}) => ({
    id: 'lineup_problem:1:2026-1', type: 'lineup_problem', leagueId: 1, title: 'Fill your empty FLEX slot', detail: 'FLEX is empty', deadlineAt: lock, cta: { label: 'Fix lineup', to: '/league/1/lineup' }, ...extra,
  });

  test('the lineup note shows only for the league\'s current week: Wk 8 while the current week is 7 has none', async () => {
    mockApi({
      matchups: [viewerRow({ week: 7 }), viewerRow({ id: 8, week: 8, status: 'scheduled' })],
      viewerTeamId: 10,
      league: { ...noteLeague, current_week: 7 },
      detail: lineupDetail({ week: 7 }),
      actionItems: [lineupItemFor(new Date(Date.now() + 45 * 60000).toISOString(), { id: 'lineup_problem:1:2026-7' })],
    });
    renderPage();
    expect(await screen.findByTestId('lineup-note')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Wk 8' }));
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Wk 7' }));
    expect(await screen.findByTestId('lineup-note')).toBeInTheDocument();
  });

  test('once the lock passes the note goes away and the action items are asked for again, once', async () => {
    jest.useFakeTimers();
    try {
      const lock = new Date(Date.now() + 45 * 60000).toISOString();
      mockApi({
        matchups: [viewerRow()], viewerTeamId: 10, league: noteLeague, detail: lineupDetail(), actionItems: [lineupItemFor(lock)],
      });
      renderPage();
      expect(await screen.findByTestId('lineup-note')).toBeInTheDocument();
      const asks = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/user/action-items')).length;
      expect(asks()).toBe(1);

      // The page's minute clock walks past the lock; the shared cache's refetch runs once.
      await act(async () => { jest.advanceTimersByTime(46 * 60000); });
      expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
      expect(asks()).toBe(2);
      await act(async () => { jest.advanceTimersByTime(10 * 60000); });
      expect(asks()).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // The fallback path (a payload without yetToPlay, or any server count): the hero's side lines and sentence
  // print the one set of helper numbers from the lineups, and Week at a glance does not add up a total from the
  // other source: with the hero's server counts null it is left out, never a sum of the other tiles alone.
  test('with null server counts the hero reads the helper numbers throughout, and the glance prints no mixed sum', async () => {
    const starter = (id, state, extra = {}) => ({
      id, slot: 'WR', name: `Starter ${id}`, position: 'WR', nfl_team: null, game_state: state, ...extra,
    });
    const detail = {
      matchup: { id: 1, season: 2026, week: 1, final: false, status: 'live', home_score: '30.0', away_score: '20.0' },
      home: {
        teamId: 10, name: 'My Team', expectedFinal: 100, starters: [starter(1, 'final'), starter(2, 'in_progress'), starter(3, 'scheduled')], bench: [],
      },
      away: {
        teamId: 20,
        name: 'Rival',
        expectedFinal: 140,
        starters: [
          starter(11, 'in_progress'), starter(12, 'in_progress'), starter(13, 'scheduled'), starter(14, 'scheduled'),
          starter(15, 'in_progress', { injury_status: 'O', availability: { available: false, reason: 'out' } }),
          starter(16, 'scheduled', { availability: { available: false, reason: 'suspended' } }),
        ],
        bench: [],
      },
      viewerTeamId: 10,
      nflGameIds: [],
    };
    mockApi({
      matchups: [viewerRow({ home_players_remaining: null, away_players_remaining: null }), otherRow()],
      viewerTeamId: 10,
      detail,
    });
    renderPage();

    const hero = await screen.findByTestId('matchup-hero');
    const sentence = within(hero).getByTestId('matchup-hero-sentence');
    await waitFor(() => expect(sentence).toHaveTextContent('they have 4 players remaining, 2 yet to play'));
    // Home: one final, one live, one not started: 2 remaining. Away: the Out and the unavailable starter do not count.
    expect(within(hero).getByTestId('matchup-hero-side-home')).toHaveTextContent('2 players remaining');
    expect(within(hero).getByTestId('matchup-hero-side-away')).toHaveTextContent('4 players remaining');
    // The tile for the other matchup keeps the server's 3 and 3, and the glance, whose hero sides have no server
    // count, prints no players-remaining sum (6 would be the other source's half of a mixed total).
    expect(within(card(2)).getByTestId('matchup-side-home')).toHaveTextContent('3 players remaining');
    expect(screen.getByTestId('week-glance')).toBeInTheDocument();
    expect(screen.queryByText('Players remaining', { selector: 'span' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-fact="players-remaining"]')).toBeNull();
  });

  // One source per matchup id: a count flickering between null and present never remounts the hero or asks for
  // the lineups again.
  test('the count source is chosen once per matchup: a null that arrives later keeps the node and prints no helper numbers', async () => {
    mockApi({
      matchups: [viewerRow({ home_yet_to_play: 2, away_yet_to_play: 3 }), otherRow()],
      viewerTeamId: 10,
      league: noteLeague,
      detail: lineupDetail({ awayStarters: [{ id: 5, slot: 'QB', game_state: 'scheduled' }] }),
      actionItems: [lineupItemFor(new Date(Date.now() + 45 * 60000).toISOString())],
    });
    renderPage();
    const hero = await screen.findByTestId('matchup-hero');
    await screen.findByTestId('lineup-note');
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent('3 yet to play');
    const reads = () => apiClient.get.mock.calls.filter(([url]) => url.includes('/matchups/')).length;
    expect(reads()).toBe(1);

    emitScores({ leagueId: 1, week: 1, scored: [{ matchupId: 1, homeScore: 31, awayScore: 20, status: 'live', homeYetToPlay: null, awayYetToPlay: null }], plays: [] });
    expect(screen.getByTestId('matchup-hero')).toBe(hero);
    // The server pair is still the source: its yet-to-play is gone, and the lineups' 1 remaining is not printed in its place.
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent('they have 4 players remaining');
    expect(within(hero).getByTestId('matchup-hero-sentence')).not.toHaveTextContent('yet to play');
    expect(reads()).toBe(1);
  });

  test('the fallback is kept when the server pair arrives later: one lineup read, the same hero node', async () => {
    mockApi({
      matchups: [viewerRow({ home_players_remaining: null, away_players_remaining: null }), otherRow()],
      viewerTeamId: 10,
      detail: {
        matchup: { id: 1, season: 2026, week: 1, status: 'live', home_score: '30.0', away_score: '20.0' },
        home: { teamId: 10, name: 'My Team', starters: [{ id: 1, game_state: 'in_progress' }], bench: [] },
        away: { teamId: 20, name: 'Rival', starters: [{ id: 2, game_state: 'scheduled' }], bench: [] },
        viewerTeamId: 10,
        nflGameIds: [],
      },
    });
    renderPage();
    const hero = await screen.findByTestId('matchup-hero');
    await waitFor(() => expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent('1 yet to play'));

    emitScores({ leagueId: 1, week: 1, scored: [{ matchupId: 1, homeScore: 31, awayScore: 20, status: 'live', homeYetToPlay: 0, awayYetToPlay: 5, homePlayersRemaining: 1, awayPlayersRemaining: 5 }], plays: [] });
    expect(screen.getByTestId('matchup-hero')).toBe(hero);
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent('1 yet to play');
    expect(apiClient.get.mock.calls.filter(([url]) => url.includes('/matchups/'))).toHaveLength(1);
  });

  test('a failed read is the danger panel: the title, the server sentence and a ghost Retry that asks again', async () => {
    let failing = true;
    apiClient.get.mockImplementation((url) => {
      if (url.startsWith('/api/user/action-items')) return Promise.resolve({ data: { items: [] } });
      if (url.endsWith('/matchups')) {
        return failing
          ? Promise.reject({ response: { data: { error: 'matchups unavailable' } } })
          : Promise.resolve({ data: [viewerRow()] });
      }
      if (url.endsWith('/rosters')) return Promise.resolve({ data: [] });
      if (url.endsWith('/standings')) return Promise.resolve({ data: { standings: [] } });
      return Promise.resolve({ data: { league: { id: 1, name: 'Sunday Ballers', current_week: 1 }, teams: [], viewerTeamId: 10 } });
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not load Game Center right now.');
    expect(alert).toHaveTextContent('matchups unavailable');
    const retry = within(alert).getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('data-variant', 'ghost');
    const asks = () => apiClient.get.mock.calls.filter(([url]) => url.endsWith('/matchups')).length;
    expect(asks()).toBe(1);

    failing = false;
    await userEvent.click(retry);
    expect(await screen.findByTestId('matchup-hero')).toBeInTheDocument();
    expect(asks()).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('the week picker is the playselect look: one tab stop, the selected week', async () => {
    mockApi({ matchups: [viewerRow(), otherRow({ week: 2, id: 9, home_team_id: 70, away_team_id: 80 })], viewerTeamId: 10 });
    renderPage();
    const picker = await screen.findByTestId('pick-week');
    expect(within(picker).getByRole('radio', { name: 'Wk 1' })).toHaveAttribute('tabindex', '0');
    expect(within(picker).getByRole('radio', { name: 'Wk 2' })).toHaveAttribute('tabindex', '-1');
    expect(within(picker).getByRole('button', { name: 'Next week' })).toHaveAttribute('tabindex', '-1');
  });

  const noteLock = () => new Date(Date.now() + 45 * 60000).toISOString();

  test('the live lineup note names the empty slot and points at free agents when no bench player can fill it', async () => {
    mockApi({
      matchups: [viewerRow()], viewerTeamId: 10, league: noteLeague, detail: lineupDetail(), actionItems: [lineupItemFor(noteLock())],
    });
    renderPage();
    const note = await screen.findByTestId('lineup-note');
    expect(note).toHaveAccessibleName(/FLEX is empty · no bench player can fill it · add a free agent playing at .+ · next kickoff in 4[45] min/);
    expect(within(note).getByRole('link', { name: 'Free agents' })).toHaveAttribute('href', '/league/1/waivers');
    expect(document.querySelectorAll('[data-filled="true"], [data-variant="fill"]')).toHaveLength(0);
  });

  test('with a bench player whose game has not started the note names the next kickoff, with a ghost Set lineup', async () => {
    mockApi({
      matchups: [viewerRow()],
      viewerTeamId: 10,
      league: noteLeague,
      detail: lineupDetail({ bench: [{ id: 9, slot: 'BENCH', name: 'Bench Guy', game_state: 'scheduled' }] }),
      actionItems: [lineupItemFor(noteLock())],
    });
    renderPage();
    const note = await screen.findByTestId('lineup-note');
    expect(note).toHaveAccessibleName(/FLEX is empty · next kickoff in 4[45] min/);
    expect(note).not.toHaveAccessibleName(/no bench player/);
    expect(within(note).getByRole('link', { name: 'Set lineup' })).toHaveAttribute('href', '/league/1/lineup');
  });

  test('before kickoff the note names the move the advice gives and its lock, read once for the own team', async () => {
    mockApi({
      matchups: [viewerRow({ status: 'scheduled', home_score: '0', away_score: '0' })],
      viewerTeamId: 10,
      league: noteLeague,
      detail: lineupDetail(),
      actionItems: [lineupItemFor(new Date(Date.now() + 26 * 3600000).toISOString())],
      advice: { suggestions: [], openSlotFills: [{ name: 'Jordan Addison', slot: 'FLEX', projection: 12.9 }] },
    });
    renderPage();
    const note = await screen.findByTestId('lineup-note');
    await waitFor(() => expect(note).toHaveAccessibleName(/Start Jordan Addison at FLEX · [+]12[.]9 pts/));
    expect(note).toHaveAttribute('data-kind', 'pre');
    expect(within(note).getByTestId('lineup-note-lock')).toHaveTextContent(/^Locks /);
    expect(apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/team/lineup/advice'))).toHaveLength(1);
  });

  // Re-QA: a count of 0 is a count. A league that lists a K slot with 0 seats has no K slot to fill.
  test('a roster slot with a count of 0 is not an empty slot', async () => {
    mockApi({
      matchups: [viewerRow()],
      viewerTeamId: 10,
      league: { ...noteLeague, roster_slots: [{ key: 'QB', count: 1 }, { key: 'K', count: 0 }] },
      detail: lineupDetail(),
      actionItems: [lineupItemFor(noteLock())],
    });
    renderPage();
    await screen.findByTestId('matchup-hero');
    await waitFor(() => expect(apiClient.get.mock.calls.some(([url]) => url.includes('/matchups/'))).toBe(true));
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
  });

  test('viewerSlots honours a count of 0 and fills a stray slot', () => {
    expect(viewerSlots({ roster_slots: [{ key: 'QB', count: 1 }, { key: 'K', count: 0 }, { key: 'FLEX' }] }, [{ id: 1, slot: 'QB' }, { id: 2, slot: 'IDP' }]))
      .toEqual([{ slot: 'QB', player: { id: 1, slot: 'QB' } }, { slot: 'FLEX', player: null }, { slot: 'IDP', player: { id: 2, slot: 'IDP' } }]);
  });

  test('best ball has no lineup to set: no lineup read for the note and no advice read', async () => {
    mockApi({
      matchups: [viewerRow({ status: 'scheduled', home_score: '0', away_score: '0' })],
      viewerTeamId: 10,
      league: { ...noteLeague, best_ball: true },
      detail: lineupDetail(),
      actionItems: [lineupItemFor(noteLock())],
    });
    renderPage();
    await screen.findByTestId('matchup-hero');
    await waitFor(() => expect(apiClient.get.mock.calls.some(([url]) => url.startsWith('/api/user/action-items'))).toBe(true));
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
    expect(apiClient.get.mock.calls.filter(([url]) => url.includes('/matchups/'))).toHaveLength(0);
    expect(apiClient.get.mock.calls.filter(([url]) => url.startsWith('/api/team/lineup/advice'))).toHaveLength(0);
  });

  // Re-QA: while the helper path reads the lineups, no count shows, so the server's numbers never flash first.
  test('on the helper path no count line and no count clause show until the lineups have read', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    mockApi({
      matchups: [viewerRow({ home_players_remaining: 5, away_players_remaining: 4 }), otherRow()],
      viewerTeamId: 10,
      league: noteLeague,
      detail: lineupDetail({ awayStarters: [{ id: 5, slot: 'QB', game_state: 'in_progress' }] }),
    });
    const answer = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation((url) => (url.includes('/matchups/') ? gate.then(() => answer(url)) : answer(url)));
    renderPage();

    const hero = await screen.findByTestId('matchup-hero');
    expect(within(hero).queryByTestId('matchup-hero-remaining')).not.toBeInTheDocument();
    expect(hero).not.toHaveTextContent(/players remaining/);
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent(/^Ahead now, projected to trail by 40[.]0$/);

    release();
    await waitFor(() => expect(within(hero).getByTestId('matchup-hero-side-away')).toHaveTextContent('1 player remaining'));
    expect(within(hero).getByTestId('matchup-hero-sentence')).toHaveTextContent('they have 1 player remaining');
  });

  test('a full lineup draws no note, and neither does a lock the page cannot name', async () => {
    mockApi({
      matchups: [viewerRow()],
      viewerTeamId: 10,
      league: { ...noteLeague, roster_slots: [{ key: 'QB', count: 1 }] },
      detail: lineupDetail(),
      actionItems: [lineupItemFor(noteLock())],
    });
    const { unmount } = renderPage();
    await screen.findByTestId('matchup-hero');
    await waitFor(() => expect(apiClient.get.mock.calls.some(([url]) => url.includes('/matchups/'))).toBe(true));
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
    unmount();

    // Another league's deadline is not this league's lock: live with no kickoff to come leaves nothing to fix.
    mockApi({
      matchups: [viewerRow()], viewerTeamId: 10, league: noteLeague, detail: lineupDetail(), actionItems: [lineupItemFor(noteLock(), { leagueId: 2, id: 'lineup_problem:2:x' })],
    });
    renderPage();
    await screen.findByTestId('matchup-hero');
    await waitFor(() => expect(apiClient.get.mock.calls.filter(([url]) => url.includes('/matchups/')).length).toBeGreaterThan(1));
    expect(screen.queryByTestId('lineup-note')).not.toBeInTheDocument();
  });


  afterEach(() => { delete window.IntersectionObserver; });

  // Re-QA: the compact bar watches the hero element that is on screen. A week switch changes which branch draws the
  // hero, so an observer left on the old node would never pin again.
  test('the compact scoreboard still pins after switching from the live week to a past final and back', async () => {
    const observed = [];
    window.IntersectionObserver = jest.fn((cb) => {
      const record = { cb, el: null };
      observed.push(record);
      return { observe: jest.fn((el) => { record.el = el; }), disconnect: jest.fn() };
    });
    mockApi({
      matchups: [
        viewerRow({ week: 7 }),
        viewerRow({
          id: 6, week: 6, status: 'final', final: true, home_players_remaining: 0, away_players_remaining: 0,
        }),
        otherRow({ week: 7 }),
      ],
      viewerTeamId: 10,
      league: { id: 1, name: 'Sunday Ballers', current_week: 7 },
    });
    renderPage();
    await screen.findByTestId('matchup-hero');

    await userEvent.click(screen.getByRole('radio', { name: 'Wk 6' }));
    await waitFor(() => expect(screen.getByTestId('matchup-hero')).toHaveTextContent('Final'));
    await userEvent.click(screen.getByRole('radio', { name: 'Wk 7' }));
    await waitFor(() => expect(screen.getByTestId('matchup-hero')).toHaveTextContent('Live'));

    // The observer that is watching the page is on the hero that is in the document now.
    const live = observed.filter((o) => o.el && o.el.isConnected);
    expect(live).toHaveLength(1);
    expect(live[0].el).toContainElement(screen.getByTestId('matchup-hero'));
    act(() => live[0].cb([{ isIntersecting: false, boundingClientRect: { bottom: -10 } }]));
    expect(screen.getByTestId('game-center-compact-scoreboard')).toBeInTheDocument();
  });

  test('once the hero scrolls out of view the compact scoreboard pins, and scroll-padding-top reserves it', async () => {
    let notify;
    window.IntersectionObserver = jest.fn((cb) => { notify = cb; return { observe: jest.fn(), disconnect: jest.fn() }; });
    mockApi({ matchups: [viewerRow(), otherRow()], viewerTeamId: 10 });
    renderPage();
    await screen.findByTestId('matchup-hero');
    expect(screen.queryByTestId('game-center-compact-scoreboard')).not.toBeInTheDocument();

    act(() => notify([{ isIntersecting: false, boundingClientRect: { bottom: -10 } }]));
    const bar = screen.getByTestId('game-center-compact-scoreboard');
    expect(within(bar).getByRole('group')).toHaveAccessibleName('My Team 30.0, Rival 20.0, My Team by 10.0');
    expect(within(bar).getByText('Live')).toBeInTheDocument();
    const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText)).join('');
    expect(rules).toMatch(/scroll-padding-top: ?72px/);

    act(() => notify([{ isIntersecting: true, boundingClientRect: { bottom: 100 } }]));
    expect(screen.queryByTestId('game-center-compact-scoreboard')).not.toBeInTheDocument();
  });

  test('the live hero announces only the score sentence, and only when a score changes', async () => {
    mockApi({ matchups: [viewerRow(), otherRow()], viewerTeamId: 10 });
    renderPage();
    const region = await screen.findByTestId('matchup-hero-live-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('My Team 30.0, Rival 20.0');
    expect(region).not.toHaveTextContent(/remaining|as of/i);
    const payload = { leagueId: 1, week: 1, scored: [{ matchupId: 1, homeScore: 36, awayScore: 20, status: 'live' }], plays: [] };
    emitScores(payload);
    expect(region).toHaveTextContent('My Team 36.0, Rival 20.0');
    const before = region.textContent;
    emitScores(payload);
    expect(region.textContent).toBe(before);
  });
});
