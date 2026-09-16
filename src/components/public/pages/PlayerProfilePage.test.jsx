import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import userEvent from '@testing-library/user-event';
import AppThemeProvider from '../../../theme/AppThemeProvider';
import publicApiClient from '../../../api/publicApiClient';
import apiClient from '../../../api/apiClient';
import { setSessionHint } from '../../../lib/sessionHint';
import PlayerProfilePage from './PlayerProfilePage';

jest.mock('../../../api/publicApiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

// The authenticated client In your leagues (#1359) reads - NEVER
// `publicApiClient`, which the anonymous read plumbing above still uses.
jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const COMPLETE_PROFILE = {
  playerId: 42,
  name: 'Alpha Back',
  position: 'RB',
  nflTeam: 'KC',
  adp: 12.5,
  posRank: 7,
  posRankOf: 60,
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
    { season: 2025, week: 1, opponent: 'BAL', statLine: '4 rec, 67 rec yds', fantasyPoints: 21.6, points: { standard: 19.6, halfPpr: 21.6, ppr: 23.6 } },
    { season: 2025, week: 3, opponent: 'MIA', statLine: '6 rec, 85 rec yds', fantasyPoints: 11.5, points: { standard: 8.5, halfPpr: 11.5, ppr: 14.5 } },
  ],
};

const PENDING_PROFILE = {
  ...COMPLETE_PROFILE,
  season: 2026,
  seasonSummary: null,
  weeklyLogPartial: false,
  recentGames: [],
};

// A past season the player has no data for (echoed, not swapped for the default).
const NOT_AVAILABLE_PROFILE = {
  ...COMPLETE_PROFILE,
  season: 2024,
  seasonSummary: null,
  weeklyLogPartial: false,
  recentGames: [],
  seasons: [
    { season: 2026, status: 'pending' },
    { season: 2025, status: 'complete' },
    { season: 2024, status: 'unavailable' },
  ],
};

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false, media: query, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }));
  publicApiClient.get.mockImplementation((url, config) => {
    if (String(url).includes('/rankings')) return Promise.resolve({ data: { rankings: [] } });
    const requested = config && config.params && config.params.season;
    if (requested === 2026) return Promise.resolve({ data: PENDING_PROFILE });
    if (requested === 2024) return Promise.resolve({ data: NOT_AVAILABLE_PROFILE });
    return Promise.resolve({ data: COMPLETE_PROFILE });
  });
  // Signed-out by default: a test that wants a signed-in render calls
  // `setSessionHint(true)` itself and provides its own `apiClient.get`
  // implementation. `setSessionHint(false)` here (rather than assuming a
  // clean slate) matters because `hasSessionHint` reads real
  // `window.localStorage`, which persists across tests in the same file.
  setSessionHint(false);
  apiClient.get.mockImplementation(() => Promise.reject(new Error(
    'apiClient (the authenticated client) should not be called from a signed-out render'
  )));
});

afterEach(() => {
  jest.clearAllMocks();
  setSessionHint(false);
});

const renderPage = (entry = '/players/42') => render(
  <AppThemeProvider>
    <HelmetProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/players/:id" element={<PlayerProfilePage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  </AppThemeProvider>
);

test('defaults to half-PPR and updates every points readout when the format changes', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  // Half-PPR default: headline labelled, season total 340, wk1 game 21.6.
  expect(screen.getByText(/2025 fantasy points · Half-PPR/)).toBeInTheDocument();
  expect(screen.getAllByText('340').length).toBeGreaterThan(0);
  expect(screen.getByText('21.6')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Full PPR' }));
  expect(screen.getByText(/2025 fantasy points · Full PPR/)).toBeInTheDocument();
  expect(screen.getAllByText('380').length).toBeGreaterThan(0);
  expect(screen.getByText('23.6')).toBeInTheDocument(); // wk1 PPR

  fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
  expect(screen.getAllByText('300').length).toBeGreaterThan(0);
  expect(screen.getByText('19.6')).toBeInTheDocument(); // wk1 standard
});

test('nests the sparkline title one level below the Game log section (h2 > h3)', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  // "Game log" is the h2 section; the "Points by week" sparkline card sits
  // inside that section, so it must be h3, not the h2 sibling #721 chose.
  expect(screen.getByRole('heading', { level: 2, name: 'Game log' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Points by week' })).toBeInTheDocument();
});

test('stat labels expose the shared FPTS/G definition and preserve the ADP definition', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  const perGameDefinition = screen.getByLabelText('FPTS/G definition');
  fireEvent.mouseOver(perGameDefinition);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Fantasy points per game: total fantasy points divided by games played.'
  );
  fireEvent.mouseLeave(perGameDefinition);
  await waitFor(() => expect(screen.queryByText(
    'Fantasy points per game: total fantasy points divided by games played.'
  )).not.toBeInTheDocument());

  const adpDefinition = screen.getByLabelText('ADP definition');
  fireEvent.mouseOver(adpDefinition);
  expect(await screen.findByText(
    'Average draft position: the typical pick where this player is selected.'
  )).toBeInTheDocument();
});

test('shows a points-based Pos rank card with its definition', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  expect(screen.getByTestId('pos-rank-stat-card')).toHaveTextContent('#7');
  const rankDefinition = screen.getByLabelText('Pos rank definition');
  fireEvent.mouseOver(rankDefinition);
  expect(await screen.findByText(
    "Position rank: this player's rank among players at the same position."
  )).toBeInTheDocument();
});

test('shows the partial-weekly affordance when weekly rows lag games played', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });
  expect(screen.getByText(/Weekly breakdown is partial/)).toBeInTheDocument();
  expect(screen.getByText(/reflects all 17 games/)).toBeInTheDocument();
});

test('honors a shared ?season= URL for a season the player lacks with a not-available state, not an error', async () => {
  renderPage('/players/42?season=2024');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await screen.findByText(/No 2024 data for Alpha Back/);
  // Not a mismatched-season view: no game table, and the unavailable season
  // is never offered as a toggle button.
  expect(screen.queryByRole('table', { name: 'Game log' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /2024/ })).not.toBeInTheDocument();
});

test('offers the sole valid season when an unavailable shared season is active', async () => {
  publicApiClient.get.mockImplementation((url) => {
    if (String(url).includes('/rankings')) return Promise.resolve({ data: { rankings: [] } });
    return Promise.resolve({
      data: {
        ...NOT_AVAILABLE_PROFILE,
        seasons: [
          { season: 2025, status: 'complete' },
          { season: 2024, status: 'unavailable' },
        ],
      },
    });
  });

  renderPage('/players/42?season=2024');
  await screen.findByText(/No 2024 data for Alpha Back/);

  expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '2024' })).not.toBeInTheDocument();
});

// A team defense: no receptions anywhere in its scoring, so the three formats
// are always the same number and offering a toggle would imply a difference.
const DEF_PROFILE = {
  ...COMPLETE_PROFILE,
  playerId: 6721,
  name: 'Denver Broncos',
  position: 'DEF',
  nflTeam: 'Denver Broncos',
  adp: null,
  posRank: 3,
  posRankOf: 32,
  seasonSummary: {
    season: 2025,
    gamesPlayed: 17,
    points: { standard: 187, halfPpr: 187, ppr: 187 },
    pointsPerGame: { standard: 11, halfPpr: 11, ppr: 11 },
    fantasyPoints: 187,
  },
  weeklyLogPartial: false,
  recentGames: [
    { season: 2025, week: 1, opponent: 'NYG', statLine: '2 Sk, 6 PA, 231 YdA', fantasyPoints: 13, points: { standard: 13, halfPpr: 13, ppr: 13 } },
  ],
};

function mockProfile(profile) {
  publicApiClient.get.mockImplementation((url) => {
    if (String(url).includes('/rankings')) return Promise.resolve({ data: { rankings: [] } });
    return Promise.resolve({ data: profile });
  });
}

test('hides the scoring-format toggle for a team defense, whose formats are identical', async () => {
  mockProfile(DEF_PROFILE);
  renderPage('/players/6721');
  await screen.findByRole('heading', { name: 'Denver Broncos' });

  expect(screen.queryByRole('button', { name: 'Full PPR' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Standard' })).not.toBeInTheDocument();
  // The headline also drops the format qualifier it can no longer switch.
  expect(screen.getByText('2025 fantasy points')).toBeInTheDocument();
  // Points still render, and the defensive stat line comes through.
  expect(screen.getAllByText('187').length).toBeGreaterThan(0);
  expect(screen.getByText('2 Sk, 6 PA, 231 YdA')).toBeInTheDocument();
  // A DEF unit has no ADP; the card shows a dash rather than a bogus number.
  expect(screen.getByTestId('adp-stat-card')).toHaveTextContent('-');
  // But it does have a points-based position rank.
  expect(screen.getByTestId('pos-rank-stat-card')).toHaveTextContent('#3');
});

test('hides the scoring-format toggle for an individual defender too', async () => {
  mockProfile({
    ...DEF_PROFILE,
    playerId: 900,
    name: 'Zaire Franklin',
    position: 'LB',
    nflTeam: 'IND',
    posRank: null,
    posRankOf: null,
    recentGames: [
      { season: 2025, week: 1, opponent: 'HOU', statLine: '6 Solo, 3 Ast, 1 Sk', fantasyPoints: 11, points: { standard: 11, halfPpr: 11, ppr: 11 } },
    ],
  });
  renderPage('/players/900');
  await screen.findByRole('heading', { name: 'Zaire Franklin' });

  expect(screen.queryByRole('button', { name: 'Full PPR' })).not.toBeInTheDocument();
  expect(screen.getByText('6 Solo, 3 Ast, 1 Sk')).toBeInTheDocument();
  // Without a season rollup the rank degrades to the same dash as ADP.
  expect(screen.getByTestId('pos-rank-stat-card')).toHaveTextContent('-');
});

test('keeps the scoring-format toggle for a pass-catching position', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });
  expect(screen.getByRole('button', { name: 'Full PPR' })).toBeInTheDocument();
});

test('switching to the pending upcoming season renders a not-started state, not an error', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  fireEvent.click(screen.getByRole('button', { name: /2026/ }));

  await screen.findByText(/season hasn.t started yet/i);
  // No stat cards / game table in the pending state.
  expect(screen.queryByText(/Weekly breakdown is partial/)).not.toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Game log' })).not.toBeInTheDocument();
});

// #1359: the "In your leagues" block (parent #1354; CONTEXT.md's "In your
// leagues" / "Availability" / "Rostered").
const IN_YOUR_LEAGUES_RESPONSE = {
  leagues: [
    {
      leagueId: 11,
      leagueName: 'Alpha League',
      phase: 'in-season',
      availability: { state: 'my_team', teamId: 501, teamName: 'My Squad' },
    },
    {
      leagueId: 12,
      leagueName: 'Beta League',
      phase: 'in-season',
      availability: { state: 'rostered', teamId: 777, teamName: 'Rival Squad' },
    },
  ],
};

test('signed out renders no In your leagues block and never calls the authenticated endpoint', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  expect(screen.queryByText('In your leagues')).not.toBeInTheDocument();
  expect(apiClient.get).not.toHaveBeenCalled();
});

test('signed in with two leagues renders two lines with the exact glossary copy', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.resolve({ data: IN_YOUR_LEAGUES_RESPONSE });
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  const line1 = await screen.findByRole('button', { name: 'On your team in Alpha League' });
  const line2 = screen.getByRole('button', { name: 'Rostered by Rival Squad in Beta League' });
  expect(line1).toBeInTheDocument();
  expect(line2).toBeInTheDocument();
  // AC: "Each line's own rules carry min-height: 44px."
  expect(line1).toHaveStyle('min-height: 44px');
  expect(line2).toHaveStyle('min-height: 44px');
  // Risk review finding 2: a real league/team name is unbounded, unlike a
  // typical button's short fixed label - the row has to wrap it rather than
  // overflow on a narrow viewport.
  expect(line1).toHaveStyle('white-space: normal');
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/42/in-your-leagues');
});

test('drops a league line whose Availability state this page does not recognize, rather than an unlabeled button', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) {
      return Promise.resolve({
        data: {
          leagues: [
            ...IN_YOUR_LEAGUES_RESPONSE.leagues,
            { leagueId: 13, leagueName: 'Gamma League', phase: 'in-season', availability: { state: 'commissioner_only' } },
          ],
        },
      });
    }
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await screen.findByRole('button', { name: 'On your team in Alpha League' });
  // Every league line in the block has a real accessible name - none
  // rendered for the unrecognized state.
  const lines = screen.getAllByTestId('in-your-leagues-line');
  expect(lines).toHaveLength(2);
  lines.forEach((line) => expect(line).toHaveAccessibleName());
});

test('clicking the Rostered by line opens the Decision card with that league\'s id', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.resolve({ data: IN_YOUR_LEAGUES_RESPONSE });
    // The Decision card's own internal reads (line/usage/card): this test
    // only pins that ITS request carries the clicked league's id, not what
    // the card does with a response - same pattern WaiverWire.test.jsx uses.
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await userEvent.click(await screen.findByText('Rostered by Rival Squad in Beta League'));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Alpha Back' })).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/players/42/card?leagueId=12'));
});

// #1514 ("green for the wrong reason"): the card's action bar has to come
// from the FETCHED /card payload's own availability.state (context={
// fromCard()}), never from the "In your leagues" line's own availability -
// this line's state is 'rostered', but the mocked /card payload answers
// 'my_team', so Open lineup (not Propose trade) proves the fetch is what's
// actually driving the bar rather than the line the manager clicked.
test('the Decision card derives its action bar from the fetched card payload, not the clicked line\'s own availability', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.resolve({ data: IN_YOUR_LEAGUES_RESPONSE });
    if (String(url).includes('/card?')) return Promise.resolve({ data: { availability: { state: 'my_team' } } });
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await userEvent.click(await screen.findByText('Rostered by Rival Squad in Beta League'));

  expect(await screen.findByTestId('decision-card-open-lineup')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-propose-trade')).not.toBeInTheDocument();
});

test('maps the public profile\'s camelCase fields into the Decision card entry (formal-001 f3)', async () => {
  // toDecisionCardEntry (entities/player) reads snake_case (nfl_team,
  // photo_url); the public payload is camelCase (nflTeam, photoUrl). A
  // mapping bug at the call site would leave the card's team label blank
  // and its headshot on the initials fallback while every OTHER assertion
  // here (which only checks the dialog heading, i.e. entry.name) stayed
  // green - this is the test that would actually catch that.
  publicApiClient.get.mockImplementation((url) => {
    if (String(url).includes('/rankings')) return Promise.resolve({ data: { rankings: [] } });
    return Promise.resolve({ data: { ...COMPLETE_PROFILE, photoUrl: 'https://cdn.example/alpha-back.jpg' } });
  });
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.resolve({ data: IN_YOUR_LEAGUES_RESPONSE });
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await userEvent.click(await screen.findByText('On your team in Alpha League'));
  const dialog = await screen.findByRole('dialog');

  expect(within(dialog).getByText('KC')).toBeInTheDocument();
  expect(within(dialog).getByTestId('decision-card-headshot')).toHaveAttribute(
    'src',
    'https://cdn.example/alpha-back.jpg'
  );
});

test('shows an aria-busy loading region for a signed-in viewer before the leagues read resolves', async () => {
  apiClient.get.mockReturnValue(new Promise(() => {})); // never resolves - pins the loading state
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  const heading = await screen.findByText('In your leagues');
  // LoadingRows (../kit/DataState) carries its own aria-busy/aria-live - the
  // same loading contract every other reader on this page already uses.
  // Scoped to this section: PeerLinks' own rankings read renders a second
  // LoadingRows lower on the page.
  // eslint-disable-next-line testing-library/no-node-access -- asserting on the owning region, same pattern LoadingRows' own consumers use
  expect(within(heading.closest('section')).getByTestId('loading-rows')).toHaveAttribute('aria-busy', 'true');
});

test('closing the card holds its context through the exit transition, not the my_team default', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.resolve({ data: IN_YOUR_LEAGUES_RESPONSE });
    // #1514: the card passes context={fromCard()} here, so the rostered
    // action bar this test asserts on only renders once the /card payload's
    // own availability.state answers (ADR 0040 ruling c).
    if (String(url).includes('/card?')) return Promise.resolve({ data: { availability: { state: 'rostered' } } });
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await userEvent.click(await screen.findByText('Rostered by Rival Squad in Beta League'));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByTestId('decision-card-propose-trade'); // confirms the rostered action bar rendered

  await userEvent.click(within(dialog).getByTestId('decision-card-close'));

  // Risk review finding 4: nulling every card prop at once on close used to
  // flip `context` to the widget's `my_team` default mid-exit (the Drawer's
  // own 120ms exit transition), swapping in a plain "Open lineup" link under
  // a still focus-trapped user. `openLine` now survives the close, so the
  // rostered action bar - never "Open lineup" - is what's still there.
  expect(screen.getByTestId('decision-card-propose-trade')).toBeInTheDocument();
  expect(screen.queryByTestId('decision-card-open-lineup')).not.toBeInTheDocument();
});

test('an errored in-your-leagues read renders the profile with no block and no error text', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.reject(new Error('network error'));
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/players/42/in-your-leagues'));
  expect(screen.queryByText('In your leagues')).not.toBeInTheDocument();
  expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
});

test('a signed-in viewer with no eligible leagues renders no block, not an empty heading', async () => {
  apiClient.get.mockImplementation((url) => {
    if (String(url).includes('/in-your-leagues')) return Promise.resolve({ data: { leagues: [] } });
    return Promise.reject(new Error(`unexpected apiClient url ${url}`));
  });
  setSessionHint(true);
  renderPage('/players/42');
  await screen.findByRole('heading', { name: 'Alpha Back' });

  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/players/42/in-your-leagues'));
  expect(screen.queryByText('In your leagues')).not.toBeInTheDocument();
});

test('renders the same anonymous hero and stat grid as before the In your leagues addition', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Alpha Back' });

  expect(screen.getByTestId('profile-hero')).toMatchSnapshot();
  expect(screen.getByTestId('stat-grid')).toMatchSnapshot();
  // Nothing rendered between the hero and the stat grid for an anonymous view.
  expect(screen.queryByText('In your leagues')).not.toBeInTheDocument();
});
