import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

function mockGetByUrl(map) {
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

const tiles = () => screen.queryAllByTestId('around-the-league-tile');

describe('AroundTheLeague', () => {
  it('renders six tiles with both Team names and totals, from a six-matchup fixture', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });

    renderWidget();

    const rendered = await screen.findAllByTestId('around-the-league-tile');
    expect(rendered).toHaveLength(6);

    for (const matchup of SIX_MATCHUPS) {
      const tile = rendered.find(
        (el) => el.getAttribute('data-matchup-id') === String(matchup.id)
      );
      expect(tile).toBeDefined();
      expect(within(tile).getByText(`Team ${matchup.home_team_id}`)).toBeInTheDocument();
      expect(within(tile).getByText(`Team ${matchup.away_team_id}`)).toBeInTheDocument();
    }

    expect(screen.getByText('6 matchups')).toBeInTheDocument();
  });

  it('rings exactly one tile, the viewer\'s own, by Team id and never by home/away seat', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });

    renderWidget();
    await screen.findAllByTestId('around-the-league-tile');

    const rung = tiles().filter((el) => el.hasAttribute('data-viewer-tile'));
    expect(rung).toHaveLength(1);
    expect(rung[0]).toHaveAttribute('data-matchup-id', '3');

    // The ring is a border/box-shadow (colour and shape alone), so the
    // viewer's own row also carries a visible "You" pill: identifiable in
    // the accessibility tree, not by colour only (WCAG 1.4.1), matching
    // DraftGrades' and StandingsTable's viewer rows.
    expect(within(rung[0]).getByText('You')).toBeInTheDocument();
  });

  it('shows scores and flips the tail to "Live" once a matchup has started', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });

    renderWidget();
    const rendered = await screen.findAllByTestId('around-the-league-tile');
    const started = rendered.find((el) => el.getAttribute('data-matchup-id') === '3');

    expect(within(started).getByText('52.1')).toBeInTheDocument();
    expect(within(started).getByText('48.7')).toBeInTheDocument();
    expect(screen.getByText(/Live/)).toBeInTheDocument();

    // An untouched Matchup still shows its projected total, not a score.
    const scheduled = rendered.find((el) => el.getAttribute('data-matchup-id') === '1');
    expect(within(scheduled).getByText('101.0')).toBeInTheDocument();
    expect(within(scheduled).getByText('92.0')).toBeInTheDocument();
  });

  it('links the tail to this league\'s Game Center', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });

    renderWidget();
    await screen.findAllByTestId('around-the-league-tile');

    const link = screen.getByRole('link', { name: 'Game Center' });
    expect(link).toHaveAttribute('href', `/league/${LEAGUE_ID}/game-center`);
  });

  it('holds six skeleton tiles while its reads are in flight', () => {
    apiClient.get.mockImplementation((url) => {
      if (url === `/api/league/${LEAGUE_ID}` || url === `/api/league/${LEAGUE_ID}/matchups`) {
        return new Promise(() => {});
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderWidget();

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('around-the-league-tile')).toHaveLength(0);
  });

  it('renders one compact alert sentence on a failed read', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === `/api/league/${LEAGUE_ID}`) return Promise.resolve(leagueResponse());
      if (url === `/api/league/${LEAGUE_ID}/matchups`) return Promise.reject(new Error('boom'));
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderWidget();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We could not load this week's matchups right now.");
    expect(screen.queryAllByTestId('around-the-league-tile')).toHaveLength(0);
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
      resolveMatchups({ data: SIX_MATCHUPS });
      await matchupsPromise;
    });

    await screen.findAllByTestId('around-the-league-tile');
    expect(card).toHaveAttribute('aria-busy', 'false');
  });

  it('labels each figure with what it is, for assistive tech reading a bare number', async () => {
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });

    renderWidget();
    const rendered = await screen.findAllByTestId('around-the-league-tile');
    const started = rendered.find((el) => el.getAttribute('data-matchup-id') === '3');
    const scheduled = rendered.find((el) => el.getAttribute('data-matchup-id') === '1');

    expect(within(started).getAllByText('Score').length).toBeGreaterThan(0);
    expect(within(scheduled).getAllByText('Projected').length).toBeGreaterThan(0);
  });

  it('is reachable by keyboard below md, where the tiles scroll sideways', async () => {
    mobile = true;
    mockGetByUrl({
      [`/api/league/${LEAGUE_ID}`]: leagueResponse(),
      [`/api/league/${LEAGUE_ID}/matchups`]: { data: SIX_MATCHUPS },
    });

    renderWidget();
    await screen.findAllByTestId('around-the-league-tile');

    const body = screen.getByTestId('around-the-league-body');
    expect(body).toHaveAttribute('data-layout', 'scroll');
    expect(body).toHaveAttribute('tabIndex', '0');
    expect(body).toHaveAccessibleName();
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
