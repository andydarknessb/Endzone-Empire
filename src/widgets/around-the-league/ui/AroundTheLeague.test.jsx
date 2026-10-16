import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import AroundTheLeague from '../index';

/**
 * around-the-league slice tests (#1103). The widget owns two reads (useLeague
 * -> useResource, entities/matchup's useLeagueMatchups -> a plain apiClient
 * GET plus the score/identity feeds), so the whole client is mocked and every
 * GET is answered by the URL-keyed dispatcher below - the same seam
 * matchup-preview's and my-team-summary's widget tests use. The score feed's
 * socket is swapped for a controllable fake through the app's own test hook
 * (window.__ENDZONE_TEST_SOCKET_FACTORY__, src/api/socket.js), exactly as
 * GameCenterPage.test.jsx does for the same entity hook.
 */
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

function makeFakeSocket() {
  const handlers = {};
  return {
    emit: jest.fn(),
    on: jest.fn((event, cb) => { handlers[event] = cb; }),
    io: { on: jest.fn(), off: jest.fn() },
    disconnect: jest.fn(),
  };
}

// Every media query the widget reads goes through useMediaQuery: the
// theme's `md` breakpoint (a max-width) reads `mobile`. Set fresh every test
// (rather than mutated once inside a test body) because CRA's jest preset
// runs with `resetMocks: true`: a jest.fn() assigned to window.matchMedia
// inside one test loses its implementation before the next test even
// though the window (and so the property) persists across the whole file,
// which would leave every later test's useMediaQuery call reading
// `undefined.matches`. GameCenterPage.test.jsx uses this same shape.
let mobile;

beforeEach(() => {
  // The league read is a shared cached resource (ADR 0004) and is module
  // state that outlives a test, so it is cleared whole.
  invalidate(undefined, { reload: false });
  window.__ENDZONE_TEST_SOCKET_FACTORY__ = () => makeFakeSocket();
  mobile = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query) ? mobile : false,
    media: query,
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

const LEAGUE_ID = 42;

// Twelve Teams, six Week-3 Matchups. Team 4 (away in its pairing) is the
// viewer, deliberately NOT the home side: a home/away shortcut for the ring
// would fail this fixture (either ringing the wrong tile or none at all),
// which is the red-tell the issue calls for.
const TEAMS = Array.from({ length: 12 }, (_, i) => ({
  teamId: i + 1,
  id: i + 1,
  teamName: `Team ${i + 1}`,
  avatar_url: null,
  avatar_static_url: null,
}));

function matchupRow(id, homeId, awayId, overrides = {}) {
  return {
    id,
    season: 2026,
    week: 3,
    final: false,
    status: 'scheduled',
    home_team_id: homeId,
    home_team_name: `Team ${homeId}`,
    home_score: '0',
    home_expected_final: 100 + homeId,
    home_players_remaining: 9,
    away_team_id: awayId,
    away_team_name: `Team ${awayId}`,
    away_score: '0',
    away_expected_final: 90 + awayId,
    away_players_remaining: 9,
    ...overrides,
  };
}

// Six Week-3 pairings; the third (Team 3 vs Team 4) is live, the viewer's own
// (Team 4, away) and started, so the fixture also proves the tail flips to
// "Live" and that tile's figures read as scores rather than projections.
const SIX_MATCHUPS = [
  matchupRow(1, 1, 2),
  matchupRow(2, 5, 6),
  matchupRow(3, 3, 4, {
    status: 'live',
    home_score: '52.1',
    away_score: '48.7',
  }),
  matchupRow(4, 7, 8),
  matchupRow(5, 9, 10),
  matchupRow(6, 11, 12),
];

function leagueResponse(league = {}) {
  return {
    data: {
      viewerTeamId: 4,
      league: { id: LEAGUE_ID, name: 'MinneApple', current_week: 3, ...league },
      teams: TEAMS,
    },
  };
}

// The standings read (the rival pick on game day) answers a default table unless a test overrides it.
function mockGetByUrl(overrides) {
  const map = { [STANDINGS_URL]: standingsOf(), ...overrides };
  apiClient.get.mockImplementation((url) => {
    if (Object.prototype.hasOwnProperty.call(map, url)) {
      const value = map[url];
      return value && value.reject ? Promise.reject(value.reject) : Promise.resolve(value);
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderWidget(props = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AroundTheLeague leagueId={LEAGUE_ID} {...props} />
    </MemoryRouter>
  );
}

// An sx rule is not laid out by jsdom, but emotion inserts it into
// `document.styleSheets` under the element's generated class; this reads the
// declarations of the rules under that class, keyed by selector tail.
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

const tiles = () => screen.queryAllByTestId('around-the-league-tile');

// Six Week-3 pairings, none started: the pre-kickoff strip. Team 4 (away in its pairing) is the
// viewer, deliberately NOT the home side: a home/away shortcut for dropping the viewer's own matchup
// would keep the wrong tile.
const SCHEDULED_SIX = SIX_MATCHUPS.map((m) => ({ ...m, status: 'scheduled', home_score: '0', away_score: '0' }));

// The standings the rival pick reads: Team n is in position n.
const standingsOf = (count = 12) => ({
  data: {
    league: { current_week: 3 },
    standings: Array.from({ length: count }, (_, i) => ({
      teamId: i + 1, name: `RAW ${i + 1}`, wins: count - i, losses: i, ties: 0, pf: 1000 - i, pa: 900 + i, rank: i + 1, streak: 'W1', winPct: 0.5,
    })),
  },
});

const STANDINGS_URL = `/api/scoring/league/${LEAGUE_ID}/standings`;

describe('AroundTheLeague', () => {
  it('renders the other five matchups, not the viewer\'s own, with both Team names and projections', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });

    renderWidget();

    const rendered = await screen.findAllByTestId('around-the-league-tile');
    expect(rendered).toHaveLength(5);
    // Matchup 3 holds the viewer (Team 4, away): by Team id, never by home/away seat, it is the page's
    // Matchup panel and not repeated here.
    expect(rendered.find((el) => el.getAttribute('data-matchup-id') === '3')).toBeUndefined();

    for (const matchup of SCHEDULED_SIX.filter((m) => m.id !== 3)) {
      const tile = rendered.find((el) => el.getAttribute('data-matchup-id') === String(matchup.id));
      expect(tile).toBeDefined();
      expect(within(within(tile).getByTestId('around-the-league-tile-home'))
        .getByText(`Team ${matchup.home_team_id}`)).toBeInTheDocument();
      expect(within(within(tile).getByTestId('around-the-league-tile-away'))
        .getByText(`Team ${matchup.away_team_id}`)).toBeInTheDocument();
    }

    expect(screen.getByText(/5 matchups · win probability/)).toBeInTheDocument();
    // Before kickoff the figures are projections, framed rather than Board black.
    const first = rendered.find((el) => el.getAttribute('data-matchup-id') === '1');
    expect(first).toHaveAttribute('data-state', 'scheduled');
    expect(within(first).getByText('101.0')).toBeInTheDocument();
    expect(within(first).getByText('92.0')).toBeInTheDocument();
    expect(within(first).getByText('Proj')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projected · Game Center' })).toBeInTheDocument();
  });

  it('shows every matchup to a viewer with no Team of their own', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: { ...leagueResponse(), data: { ...leagueResponse().data, viewerTeamId: null } },
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });

    renderWidget();

    expect(await screen.findAllByTestId('around-the-league-tile')).toHaveLength(6);
  });

  it('names each tile in one sentence with both sides, the figures and the win probability for the first', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });

    renderWidget();
    const [tile] = await screen.findAllByTestId('around-the-league-tile');

    expect(tile.getAttribute('aria-label')).toMatch(
      /^Team 1 against Team 2, projected 101\.0 to 92\.0, \d+% win probability for Team 1$/
    );
    // The odds bar names its team too, and uses the Frame colour before kickoff.
    expect(within(tile).getByRole('img', { name: /^Team 1 win probability \d+%$/ })).toBeInTheDocument();
  });

  it('on game day shows the three rival games, live and final on Board black, and flips the tail to "Live"', async () => {
    // Viewer Team 4 is third... in position 4. Games: 1v2 (positions 1, 2), 5v6 (5, 6), 7v8, 9v10, 11v12.
    // Nearest to position 4: 5v6 (1), 1v2 (2), 7v8 (3).
    const rows = [
      matchupRow(1, 1, 2, { status: 'live', home_score: '92.6', away_score: '71.3' }),
      matchupRow(2, 5, 6, { status: 'live', home_score: '60.0', away_score: '66.5' }),
      matchupRow(3, 3, 4, { status: 'live', home_score: '52.1', away_score: '48.7' }),
      matchupRow(4, 7, 8, { status: 'final', final: true, home_score: '118.7', away_score: '104.2' }),
      matchupRow(5, 9, 10),
      matchupRow(6, 11, 12),
    ];
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: rows },
      [STANDINGS_URL]: standingsOf(),
    });

    renderWidget();

    await waitFor(() => expect(tiles().map((el) => el.getAttribute('data-matchup-id')).sort()).toEqual(['1', '2', '4']));
    expect(screen.getByText(/3 rival matchups/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Live · Game Center' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All matchups in Game Center' })).toHaveAttribute(
      'href', `/league/${LEAGUE_ID}/game-center`
    );

    const live = tiles().find((el) => el.getAttribute('data-matchup-id') === '2');
    expect(live).toHaveAttribute('data-state', 'live');
    expect(within(live).getByText('Live')).toBeInTheDocument();
    expect(within(live).getByText('60.0')).toBeInTheDocument();
    expect(within(live).getByText('66.5')).toBeInTheDocument();

    const done = tiles().find((el) => el.getAttribute('data-matchup-id') === '4');
    expect(done).toHaveAttribute('data-state', 'final');
    expect(within(done).getByText('Final')).toBeInTheDocument();
    expect(done).toHaveTextContent('Team 7 won by 14.5');
    expect(done.getAttribute('aria-label')).toBe('Team 7 against Team 8, final, 118.7 to 104.2');
    // The final tile has no odds bar: nothing is left to forecast.
    expect(within(done).queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps matchups in their own order on game day while the standings are unavailable', async () => {
    const rows = [
      matchupRow(1, 1, 2, { status: 'live', home_score: '10.0', away_score: '12.0' }),
      matchupRow(2, 5, 6),
      matchupRow(3, 3, 4),
      matchupRow(4, 7, 8),
      matchupRow(5, 9, 10),
      matchupRow(6, 11, 12),
    ];
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: rows },
      [STANDINGS_URL]: { reject: new Error('standings down') },
    });

    renderWidget();

    await waitFor(() => expect(tiles().map((el) => el.getAttribute('data-matchup-id'))).toEqual(['1', '2', '4']));
  });

  it('links the tail and the last tile to this league\'s Game Center', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });

    renderWidget();
    await screen.findAllByTestId('around-the-league-tile');

    expect(screen.getByRole('link', { name: 'Projected · Game Center' })).toHaveAttribute('href', `/league/${LEAGUE_ID}/game-center`);
    expect(screen.getByTestId('around-the-league-all')).toHaveAttribute('href', `/league/${LEAGUE_ID}/game-center`);
  });

  it('links each tile to its own matchup detail, and keeps the Game Center link for a tile with no id (#1981 L6)', async () => {
    const rows = [matchupRow(1, 1, 2), { ...matchupRow(2, 5, 6), id: null }];
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: rows },
    });

    renderWidget();

    const rendered = await screen.findAllByTestId('around-the-league-tile');
    expect(rendered[0]).toHaveAttribute('href', `/league/${LEAGUE_ID}/matchups/1`);
    expect(rendered[1]).toHaveAttribute('href', `/league/${LEAGUE_ID}/game-center`);
  });

  it('lays the strip on three equal columns before kickoff and four on game day, at md and up', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });
    const { unmount } = renderWidget();
    await screen.findAllByTestId('around-the-league-tile');
    let body = screen.getByTestId('around-the-league-body');
    expect(body).toHaveAttribute('data-layout', 'grid');
    expect(rulesUnder(body)['']).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    unmount();

    // Game day: three rival tiles plus the link tile make four cells.
    invalidate(undefined, { reload: false });
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });
    renderWidget();
    await waitFor(() => expect(tiles()).toHaveLength(3));
    body = screen.getByTestId('around-the-league-body');
    expect(rulesUnder(body)['']).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
  });

  it('never lays out more columns than it has cells: two rival tiles and the link tile fill three', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS.slice(0, 3) },
    });
    renderWidget();
    await waitFor(() => expect(tiles()).toHaveLength(2));
    const body = screen.getByTestId('around-the-league-body');
    expect(rulesUnder(body)['']).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });

  it('holds skeleton tiles while its reads are in flight', () => {
    apiClient.get.mockImplementation((url) => {
      if (url === `/api/league/${LEAGUE_ID}` || url === `/api/league/${LEAGUE_ID}/matchups`) {
        return new Promise(() => {});
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderWidget();

    expect(screen.getByTestId('around-the-league')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryAllByTestId('around-the-league-tile')).toHaveLength(0);
  });

  it('renders one danger panel on a failed read, and Try again reads again', async () => {
    let failing = true;
    apiClient.get.mockImplementation((url) => {
      if (url === `/api/league/${LEAGUE_ID}`) return Promise.resolve(leagueResponse());
      if (url === `/api/league/${LEAGUE_ID}/matchups`) {
        return failing ? Promise.reject(new Error('boom')) : Promise.resolve({ data: SCHEDULED_SIX });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderWidget();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We could not load this week's matchups right now.");
    expect(screen.queryAllByTestId('around-the-league-tile')).toHaveLength(0);

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try loading the matchups again' }));
    expect(await screen.findAllByTestId('around-the-league-tile')).toHaveLength(5);
  });

  it('reports aria-busy true while its reads are in flight and false once they settle', async () => {
    let resolveMatchups;
    const matchupsPromise = new Promise((resolve) => {
      resolveMatchups = resolve;
    });
    apiClient.get.mockImplementation((url) => {
      if (url === `/api/league/${LEAGUE_ID}`) return Promise.resolve(leagueResponse());
      if (url === `/api/league/${LEAGUE_ID}/matchups`) return matchupsPromise;
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderWidget();

    const card = await screen.findByTestId('around-the-league');
    expect(card).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveMatchups({ data: SCHEDULED_SIX });
      await matchupsPromise;
    });

    await screen.findAllByTestId('around-the-league-tile');
    expect(card).toHaveAttribute('aria-busy', 'false');
  });

  it('labels each figure with what it is, for assistive tech reading a bare number', async () => {
    const rows = [matchupRow(1, 1, 2), matchupRow(2, 5, 6, { status: 'live', home_score: '30.0', away_score: '20.0' })];
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: rows },
    });

    renderWidget();
    const rendered = await screen.findAllByTestId('around-the-league-tile');
    const started = rendered.find((el) => el.getAttribute('data-matchup-id') === '2');
    const scheduled = rendered.find((el) => el.getAttribute('data-matchup-id') === '1');

    expect(within(started).getAllByText('Score').length).toBeGreaterThan(0);
    expect(within(scheduled).getAllByText('Projected').length).toBeGreaterThan(0);
  });

  it('labels the figure "Score", never "Projected", on an unknown status', async () => {
    // ADR 0030: an unknown status asserts neither state. `tileView`'s figure is already the score
    // there (a stored fact, matchup-grid's own convention), so the accessible label has to agree.
    const unknownStatusMatchup = matchupRow(7, 1, 2, {
      status: 'not-a-real-status',
      home_score: '75.0',
      away_score: '70.0',
    });
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: [unknownStatusMatchup] },
    });

    renderWidget();
    const [tile] = await screen.findAllByTestId('around-the-league-tile');

    expect(within(tile).getByText('75.0')).toBeInTheDocument();
    expect(within(tile).getByText('70.0')).toBeInTheDocument();
    expect(within(tile).getAllByText('Score').length).toBeGreaterThan(0);
    expect(within(tile).queryAllByText('Projected')).toHaveLength(0);
  });

  it('announces "Not available" for a figure with no value to show', async () => {
    const noProjectionMatchup = matchupRow(8, 1, 2, {
      home_expected_final: null,
      away_expected_final: null,
    });
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: [noProjectionMatchup] },
    });

    renderWidget();
    const [tile] = await screen.findAllByTestId('around-the-league-tile');

    expect(within(tile).getAllByText('Not available')).toHaveLength(2);
  });

  it('is reachable by keyboard below md, where the tiles scroll sideways', async () => {
    mobile = true;
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });

    renderWidget();
    await screen.findAllByTestId('around-the-league-tile');

    const body = screen.getByTestId('around-the-league-body');
    expect(body).toHaveAttribute('data-layout', 'scroll');
    expect(body).toHaveAttribute('tabIndex', '0');
    expect(body).toHaveAccessibleName();
  });

  it('never wears the cursor: the one cursor belongs to Your move', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SCHEDULED_SIX },
    });

    renderWidget();
    await screen.findAllByTestId('around-the-league-tile');

    const frame = screen.getByTestId('around-the-league');
    // eslint-disable-next-line testing-library/no-node-access -- the cursor is a class, not a role
    expect(frame.querySelector('.cursor')).toBeNull();
  });

  it('never mounts for a pick\'em-only league', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === `/api/league/${LEAGUE_ID}`) {
        return Promise.resolve(leagueResponse({ pickem_only: true }));
      }
      if (url === `/api/league/${LEAGUE_ID}/matchups`) return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    const { container } = renderWidget();

    // Wait for both reads to settle, then assert nothing rendered: a
    // pick'em-only league never mounts a body, so there is no tile, no
    // skeleton and no error sentence to wait for instead.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(`/api/league/${LEAGUE_ID}`));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
