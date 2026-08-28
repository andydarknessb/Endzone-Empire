import React from 'react';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import {
  MemoryRouter, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import publicApiClient from '../../api/publicApiClient';
import { clearLeagueCache } from '../../hooks/useLeague';
import AuthenticatedPlayerProfilePage from './AuthenticatedPlayerProfilePage';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const COMPLETE_PROFILE = {
  playerId: 42,
  name: 'Alpha Back',
  position: 'RB',
  nflTeam: 'KC',
  adp: 12.5,
  season: 2025,
  seasons: [
    { season: 2026, status: 'pending' },
    { season: 2025, status: 'complete' },
  ],
  seasonSummary: {
    season: 2025,
    gamesPlayed: 17,
    points: { standard: 300, halfPpr: 340, ppr: 380 },
    pointsPerGame: { standard: 17.6, halfPpr: 20, ppr: 22.4 },
    fantasyPoints: 340,
  },
  weeklyLogPartial: true,
  recentGames: [
    {
      season: 2025,
      week: 1,
      opponent: 'BAL',
      statLine: '4 rec, 67 rec yds',
      fantasyPoints: 21.6,
      points: { standard: 19.6, halfPpr: 21.6, ppr: 23.6 },
    },
    {
      season: 2025,
      week: 3,
      opponent: 'MIA',
      statLine: '6 rec, 85 rec yds',
      fantasyPoints: 11.5,
      points: { standard: 8.5, halfPpr: 11.5, ppr: 14.5 },
    },
  ],
};

const PENDING_PROFILE = {
  ...COMPLETE_PROFILE,
  season: 2026,
  seasonSummary: null,
  weeklyLogPartial: false,
  recentGames: [],
};

const renderPage = (entry = '/players/42') => renderWithProviders(
  <AuthenticatedPlayerProfilePage />,
  { path: '/players/:playerId', route: entry }
);

const draftProfileEntry = (originOverrides = {}) => ({
  pathname: '/players/42',
  search: '?leagueId=10',
  state: {
    playerProfileOrigin: {
      kind: 'draft-room',
      leagueId: '10',
      pathname: '/league/10/draft',
      search: '?view=players&pos=WR',
      ...originOverrides,
    },
  },
});

beforeEach(() => {
  // The league store outlives a test in this file, so each test has to start
  // from an empty one instead of the previous test's row.
  clearLeagueCache();
  publicApiClient.get.mockResolvedValue({ data: { rankings: [] } });
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/public/players/42') {
      return Promise.resolve({ data: config?.params?.season === 2026 ? PENDING_PROFILE : COMPLETE_PROFILE });
    }
    if (url === '/api/league/10') {
      return Promise.resolve({ data: { league: { id: 10, scoring_preset: 'ppr' } } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
});

afterEach(() => {
  clearLeagueCache();
  jest.clearAllMocks();
});

test('renders the scoring switcher, points sparkline, game log, and partial-weekly note', async () => {
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Alpha Back' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Standard' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Fantasy points over 2 recent games/i })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Game log' })).toBeInTheDocument();
  expect(screen.getByText(/Weekly breakdown is partial/)).toBeInTheDocument();
  expect(screen.getByText(/reflects all 17 games/)).toBeInTheDocument();
});

test('defaults to the active league scoring format without recalculating points', async () => {
  renderPage('/players/42?leagueId=10');

  expect(await screen.findByText(/2025 fantasy points · Full PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('380').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.getAllByText('300').length).toBeGreaterThan(0);
});

test('holds the profile back until the league format is known', async () => {
  let resolveProfile;
  let resolveLeague;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') {
      return new Promise((resolve) => { resolveProfile = () => resolve({ data: COMPLETE_PROFILE }); });
    }
    if (url === '/api/league/10') {
      return new Promise((resolve) => {
        resolveLeague = () => resolve({ data: { league: { id: 10, scoring_preset: 'ppr' } } });
      });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/10'));

  // The profile has landed and the league has not. The body must not mount
  // yet: initialFormat is an initial value, so a format arriving afterwards
  // would reset a switch the reader had already flipped.
  await act(async () => { resolveProfile(); });
  expect(screen.queryByRole('heading', { name: 'Alpha Back' })).not.toBeInTheDocument();

  await act(async () => { resolveLeague(); });

  expect(await screen.findByText(/2025 fantasy points · Full PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Full PPR' })).toHaveAttribute('aria-pressed', 'true');
});

test('a failed profile shows its error and Retry without waiting for the league', async () => {
  let rejectProfile;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') {
      return new Promise((resolve, reject) => { rejectProfile = () => reject(new Error('boom')); });
    }
    // A league endpoint that never answers: a stalled connection, no timeout.
    if (url === '/api/league/10') return new Promise(() => {});
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/10'));

  // Only the body needs the league's format, and no body is going to render.
  // Holding the failure behind the league would leave the reader on skeletons
  // with no way to retry, for as long as the league request hangs.
  await act(async () => { rejectProfile(); });

  expect(await screen.findByText(/We couldn.t load this player/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('an empty profile shows Player not found without waiting for the league', async () => {
  let resolveEmpty;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') {
      return new Promise((resolve) => { resolveEmpty = () => resolve({ data: null }); });
    }
    if (url === '/api/league/10') return new Promise(() => {});
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/league/10'));

  await act(async () => { resolveEmpty(); });

  expect(await screen.findByText('Player not found.')).toBeInTheDocument();
});

test('keeps the Draft room breadcrumb available while the profile is loading', () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') return new Promise(() => {});
    if (url === '/api/league/10') return new Promise(() => {});
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage(draftProfileEntry());

  expect(screen.getByRole('link', { name: 'Draft room' })).toHaveAttribute(
    'href',
    '/league/10/draft?view=players&pos=WR'
  );
});

test.each([
  ['failed', () => Promise.reject(new Error('boom')), /We couldn.t load this player/],
  ['not-found', () => Promise.resolve({ data: null }), 'Player not found.'],
])('keeps the Draft room breadcrumb available in the %s profile state', async (_state, profileResponse, message) => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/public/players/42') return profileResponse();
    if (url === '/api/league/10') return Promise.resolve({ data: { league: { id: 10 } } });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage(draftProfileEntry());

  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft room' })).toHaveAttribute(
    'href',
    '/league/10/draft?view=players&pos=WR'
  );
});

test('renders the profile in the default format when the league request fails', async () => {
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/public/players/42') {
      return Promise.resolve({ data: config?.params?.season === 2026 ? PENDING_PROFILE : COMPLETE_PROFILE });
    }
    if (url === '/api/league/10') return Promise.reject(new Error('League unavailable'));
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage('/players/42?leagueId=10');

  expect(await screen.findByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/league/10');
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Alpha Back' })).toBeInTheDocument();
  expect(screen.queryByText(/We couldn.t load this player/)).not.toBeInTheDocument();
  expect(screen.queryByText(/League unavailable/)).not.toBeInTheDocument();
});

test('falls back to Half-PPR without league context', async () => {
  renderPage();

  expect(await screen.findByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Half-PPR' })).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the no-current-season state honest', async () => {
  renderPage('/players/42?season=2026');

  expect(await screen.findByText(/2026 season hasn.t started yet/i)).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Game log' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Fantasy points over/i })).not.toBeInTheDocument();
});

test.each([
  ['direct entry', '/players/42?leagueId=10'],
  ['a cross-league origin', draftProfileEntry({ leagueId: '11', pathname: '/league/11/draft' })],
  ['an arbitrary origin path', draftProfileEntry({ pathname: '/admin' })],
  ['a malformed origin query', draftProfileEntry({ search: 'view=players' })],
])('uses the Players fallback for %s', async (_case, entry) => {
  renderPage(entry);

  expect(await screen.findByRole('link', { name: 'Players' })).toHaveAttribute('href', '/player');
  expect(screen.queryByRole('link', { name: 'Draft room' })).not.toBeInTheDocument();
});

test('preserves Draft origin and league context through a related-player profile', async () => {
  publicApiClient.get.mockResolvedValue({
    data: {
      rankings: [{
        playerId: 99,
        name: 'Bravo Back',
        position: 'RB',
        projectedPoints: 250,
      }],
    },
  });
  apiClient.get.mockImplementation((url, config) => {
    if (url === '/api/public/players/42') return Promise.resolve({ data: COMPLETE_PROFILE });
    if (url === '/api/public/players/99') {
      return Promise.resolve({
        data: {
          ...COMPLETE_PROFILE,
          playerId: 99,
          name: 'Bravo Back',
          season: config?.params?.season || COMPLETE_PROFILE.season,
        },
      });
    }
    if (url === '/api/league/10') {
      return Promise.resolve({ data: { league: { id: 10, scoring_preset: 'ppr' } } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });

  renderPage(draftProfileEntry());

  const relatedPlayer = await screen.findByRole('link', { name: /Bravo Back/ });
  expect(relatedPlayer).toHaveAttribute('href', '/players/99?leagueId=10');
  fireEvent.click(relatedPlayer);

  expect(await screen.findByRole('heading', { name: 'Bravo Back' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft room' })).toBeInTheDocument();
});

test('preserves Draft origin and league context while changing profile seasons', async () => {
  renderPage(draftProfileEntry());
  await screen.findByRole('heading', { name: 'Alpha Back' });

  fireEvent.click(screen.getByRole('button', { name: /2026.*soon/ }));

  expect(await screen.findByText(/2026 season hasn.t started yet/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Draft room' })).toBeInTheDocument();
});

test('returns a Draft-room profile to its exact filtered Draft URL without a history loop', async () => {
  const draftSearch = '?view=players&pos=WR&q=deep&sort=proj&dir=desc&showDrafted=1&byes=6%2C10';
  const profileState = {
    playerProfileOrigin: {
      kind: 'draft-room',
      leagueId: '10',
      pathname: '/league/10/draft',
      search: draftSearch,
    },
  };

  function DraftLocation() {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <>
        <output aria-label="Draft location">
          {JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}
        </output>
        <button type="button" onClick={() => navigate(-1)}>History back</button>
      </>
    );
  }

  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/league/10/draft',
          search: draftSearch,
          state: { originalDraftEntry: true },
        },
        {
          pathname: '/players/42',
          search: '?leagueId=10',
          state: profileState,
        },
      ]}
      initialIndex={1}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/players/:playerId" element={<AuthenticatedPlayerProfilePage />} />
        <Route path="/league/:leagueId/draft" element={<DraftLocation />} />
      </Routes>
    </MemoryRouter>
  );

  fireEvent.click(await screen.findByRole('link', { name: 'Draft room' }));

  expect(screen.getByRole('status', { name: 'Draft location' })).toHaveTextContent(
    JSON.stringify({
      pathname: '/league/10/draft',
      search: draftSearch,
      state: { draftRoomReturn: true },
    })
  );

  fireEvent.click(screen.getByRole('button', { name: 'History back' }));

  expect(screen.getByRole('status', { name: 'Draft location' })).toHaveTextContent(
    JSON.stringify({
      pathname: '/league/10/draft',
      search: draftSearch,
      state: { originalDraftEntry: true },
    })
  );
});
