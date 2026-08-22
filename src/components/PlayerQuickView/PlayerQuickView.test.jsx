import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import apiClient from '../../api/apiClient';
import PlayerQuickView from './PlayerQuickView';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const summaryResponse = (overrides = {}) => ({
  data: {
    player: {
      id: 7,
      name: 'Justin Jefferson',
      position: 'WR',
      nfl_team: 'Minnesota Vikings',
      jersey_number: 18,
      injury_status: null,
      injury_detail: null,
      news: null,
      photo_url: 'https://example.com/photo.jpg',
      bye_week: 6,
      adp: 3.4,
      ...(overrides.player || {}),
    },
    fantasy:
      overrides.fantasy !== undefined
        ? overrides.fantasy
        : {
            adp: 3.4,
            posRank: 2,
            posRankOf: 88,
            posRankSeason: 2025,
            previousSeasonYear: 2025,
            previousSeasonTotal: 300,
            projectionSeason: 2026,
            projectedPoints: 299.2,
          },
    currentSeason:
      overrides.currentSeason !== undefined
        ? overrides.currentSeason
        : {
            season: 2026,
            weekly: [
              { week: 1, stats: { receivingYards: 120, receivingTDs: 1, receptions: 8 }, fantasy_points: 20 },
              { week: 2, stats: { receivingYards: 90, receptions: 6 }, fantasy_points: 15 },
            ],
            games: 2,
            points: 35,
            perGame: 17.5,
          },
    previousSeasons:
      overrides.previousSeasons !== undefined
        ? overrides.previousSeasons
        : [
            {
              season: 2025,
              games: 17,
              stats: { receivingYards: 1500, receivingTDs: 10, receptions: 110 },
              points: 300,
              perGame: 17.6,
            },
          ],
  },
});

const renderQuickView = (props = {}) =>
  renderWithProviders(
    <PlayerQuickView open onClose={jest.fn()} playerId={7} {...props} />
  );

// Desktop by default so every existing assertion keeps hitting the table branch.
// Mobile tests flip this before rendering; the mock reads the flag at call time,
// which is when useMediaQuery runs during render.
let matchMediaMatches = false;

beforeEach(() => {
  apiClient.get.mockResolvedValue(summaryResponse());
  matchMediaMatches = false;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: matchMediaMatches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

test('renders header (name, position) after a successful fetch', async () => {
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Justin Jefferson #18');
  expect(screen.getByRole('heading', { level: 2, name: 'Justin Jefferson #18' })).toBeInTheDocument();
  expect(screen.getByText('WR')).toBeInTheDocument();
  expect(apiClient.get).toHaveBeenCalledWith('/api/players/7/summary', undefined);
});

test('exposes an accessible loading status and marks the content busy', () => {
  apiClient.get.mockReturnValue(new Promise(() => {}));
  renderQuickView();

  expect(screen.getByRole('dialog')).toHaveAccessibleName('Player details');
  expect(screen.getByRole('status')).toHaveTextContent('Loading player details');
  expect(screen.getByTestId('quickview-skeleton').closest('[aria-busy="true"]')).toBeInTheDocument();
});

test('labels the statistics period control and each statistics table', async () => {
  renderQuickView();

  expect(await screen.findByRole('group', { name: 'Statistics period' })).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'Justin Jefferson current-season weekly statistics' })
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous Seasons' }));
  expect(
    screen.getByRole('table', { name: 'Justin Jefferson previous-season statistics' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Current Season' }));
});

test('treats the player avatar as decorative because the adjacent heading supplies the name', async () => {
  renderQuickView();

  await screen.findByText('Justin Jefferson');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('prev/next arrows navigate through the provided list', async () => {
  const onNavigate = jest.fn();
  renderQuickView({ playerId: 7, playerIds: [5, 7, 9], onNavigate });
  await screen.findByText('Justin Jefferson');

  expect(screen.getByLabelText('Player 2 of 3')).toHaveTextContent('2 of 3');

  fireEvent.click(screen.getByRole('button', { name: 'Next player' }));
  expect(onNavigate).toHaveBeenCalledWith(9);

  fireEvent.click(screen.getByRole('button', { name: 'Previous player' }));
  expect(onNavigate).toHaveBeenCalledWith(5);
});

test('Left/Right arrow keys navigate the list', async () => {
  const onNavigate = jest.fn();
  renderQuickView({ playerId: 7, playerIds: [5, 7, 9], onNavigate });
  await screen.findByText('Justin Jefferson');

  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(onNavigate).toHaveBeenCalledWith(9);
});

test('Left/Right arrow keys do not navigate while a text input is focused', async () => {
  const onNavigate = jest.fn();
  renderQuickView({ playerId: 7, playerIds: [5, 7, 9], onNavigate });
  await screen.findByText('Justin Jefferson');
  const input = document.createElement('input');
  document.body.appendChild(input);
  input.focus();

  fireEvent.keyDown(input, { key: 'ArrowRight' });

  expect(onNavigate).not.toHaveBeenCalled();
  input.remove();
});

test('Compare pins the first player and renders two stat lines after navigation', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/players/9/summary') {
      return Promise.resolve(summaryResponse({
        player: { id: 9, name: 'JaMarr Chase', jersey_number: 1 },
        fantasy: {
          adp: 4.2,
          previousSeasonYear: 2025,
          previousSeasonTotal: 280,
          projectionSeason: 2026,
          projectedPoints: 287.4,
        },
        currentSeason: {
          season: 2026,
          weekly: [
            { week: 1, stats: { receivingYards: 140, receptions: 10 }, fantasy_points: 24 },
          ],
          games: 1,
          points: 24,
          perGame: 24,
        },
      }));
    }
    return Promise.resolve(summaryResponse());
  });

  function Harness() {
    const [playerId, setPlayerId] = React.useState(7);
    return (
      <PlayerQuickView
        open
        onClose={jest.fn()}
        playerId={playerId}
        playerIds={[7, 9]}
        onNavigate={setPlayerId}
      />
    );
  }

  renderWithProviders(<Harness />);
  await screen.findByText('Justin Jefferson');
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect(screen.getByText(/Justin Jefferson pinned/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Next player' }));

  const comparison = await screen.findByTestId('player-comparison');
  expect(comparison).toHaveTextContent('Justin Jefferson');
  expect(comparison).toHaveTextContent('6 Rec, 90 Rec Yds');
  expect(comparison).toHaveTextContent('JaMarr Chase');
  expect(comparison).toHaveTextContent('10 Rec, 140 Rec Yds');
  expect(within(comparison).getAllByLabelText(/Projected: Projected fantasy points:/)).toHaveLength(2);
  expect(within(comparison).getAllByLabelText(/FPTS\/G: Fantasy points per game:/)).toHaveLength(2);
});

test('a pinned player survives closing the modal and opening another row', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/players/9/summary') {
      return Promise.resolve(summaryResponse({
        player: { id: 9, name: 'JaMarr Chase', jersey_number: 1 },
        currentSeason: {
          season: 2026,
          weekly: [
            { week: 1, stats: { receivingYards: 140, receptions: 10 }, fantasy_points: 24 },
          ],
          games: 1,
          points: 24,
          perGame: 24,
        },
      }));
    }
    return Promise.resolve(summaryResponse());
  });

  function RowHarness() {
    const [open, setOpen] = React.useState(true);
    const [playerId, setPlayerId] = React.useState(7);
    const openPlayer = (id) => {
      setPlayerId(id);
      setOpen(true);
    };
    return (
      <>
        <button type="button" onClick={() => openPlayer(9)}>Open JaMarr Chase</button>
        <PlayerQuickView
          open={open}
          onClose={() => setOpen(false)}
          playerId={playerId}
          playerIds={[7, 9]}
          onNavigate={openPlayer}
        />
      </>
    );
  }

  renderWithProviders(<RowHarness />);
  await screen.findByText('Justin Jefferson');
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'Open JaMarr Chase' }));

  const comparison = await screen.findByTestId('player-comparison');
  expect(comparison).toHaveTextContent('Justin Jefferson');
  expect(comparison).toHaveTextContent('JaMarr Chase');
});

test('no nav arrows when no player list is provided', async () => {
  renderQuickView();
  await screen.findByText('Justin Jefferson');
  expect(screen.queryByRole('button', { name: 'Next player' })).not.toBeInTheDocument();
});

test('renders context actions and fires their onClick', async () => {
  const onClick = jest.fn();
  renderQuickView({ actions: [{ label: 'Add to Roster', onClick }] });
  await screen.findByText('Justin Jefferson');

  fireEvent.click(screen.getByRole('button', { name: 'Add to Roster' }));
  expect(onClick).toHaveBeenCalled();
});

test('preserves league context in the full-profile link', async () => {
  renderQuickView({ leagueId: 10 });

  expect(await screen.findByRole('link', { name: /Full profile/i })).toHaveAttribute(
    'href',
    '/players/7?leagueId=10'
  );
});

test('shows the fantasy strip: ADP, pos rank, projection, and last-season total', async () => {
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  const strip = screen.getByTestId('fantasy-strip');
  expect(strip).toHaveTextContent('ADP 3.4');
  expect(strip).toHaveTextContent('Pos rank #2');
  expect(strip).toHaveTextContent('Projected (2026): 299.2 pts');
  expect(strip).toHaveTextContent('2025: 300 pts');
  expect(screen.getByLabelText(/ADP: Average draft position:/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Pos rank: Position rank:/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Projected: Projected fantasy points:/)).toBeInTheDocument();
  expect(screen.getByLabelText(/FPTS\/G: Fantasy points per game:/)).toBeInTheDocument();
});

test('fantasy strip is hidden when there is no ADP/rank/projection/prior data', async () => {
  apiClient.get.mockResolvedValue(
    summaryResponse({
      fantasy: { adp: null, posRank: null, previousSeasonTotal: null, projectedPoints: null },
      previousSeasons: [],
    })
  );
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.queryByTestId('fantasy-strip')).not.toBeInTheDocument();
});

test('a pos rank alone keeps the fantasy strip visible (IDP has no ADP)', async () => {
  apiClient.get.mockResolvedValue(
    summaryResponse({
      fantasy: {
        adp: null, posRank: 4, posRankOf: 320, posRankSeason: 2025,
        previousSeasonTotal: null, projectedPoints: null,
      },
      previousSeasons: [],
    })
  );
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  const strip = screen.getByTestId('fantasy-strip');
  expect(strip).toHaveTextContent('Pos rank #4');
  expect(strip).not.toHaveTextContent('ADP');
});

test('toggle switches from Current Season weekly table to Previous Seasons table', async () => {
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByText('8 Rec, 120 Rec Yds, 1 Rec TD')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous Seasons' }));

  expect(screen.getByText('110 Rec, 1500 Rec Yds, 10 Rec TD')).toBeInTheDocument();
  expect(screen.getByText('2025')).toBeInTheDocument();
  expect(screen.getByLabelText(/FPTS\/G: Fantasy points per game:/)).toBeInTheDocument();
});

test('previousSeasons: [] shows the "No previous-season data" empty state', async () => {
  apiClient.get.mockResolvedValue(summaryResponse({ previousSeasons: [] }));
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous Seasons' }));

  expect(
    screen.getByText('No previous-season data available for this player.')
  ).toBeInTheDocument();
});

test('currentSeason: null shows the "No current-season stats" empty state', async () => {
  apiClient.get.mockResolvedValue(summaryResponse({ currentSeason: null }));
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  // The toggle's last-selected view persists across opens for the session
  // (module-level state) — force back to "Current Season" for this assertion
  // regardless of what a prior test left it on.
  fireEvent.click(screen.getByRole('button', { name: 'Current Season' }));
  expect(screen.getByText('No current-season stats yet')).toBeInTheDocument();
});

test('missing photo_url still renders the initials fallback avatar', async () => {
  apiClient.get.mockResolvedValue(summaryResponse({ player: { photo_url: null } }));
  renderQuickView();

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  expect(screen.getByText('JJ')).toBeInTheDocument();
});

test('draftedBy renders the "Drafted by Team X" banner', async () => {
  renderQuickView({ draftedBy: 'Team X' });

  expect(await screen.findByText('Drafted by Team X')).toBeInTheDocument();
});

test('clicking the X (aria-label Close) calls onClose', async () => {
  const onClose = jest.fn();
  renderQuickView({ onClose });

  expect(await screen.findByText('Justin Jefferson')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));

  expect(onClose).toHaveBeenCalled();
});

describe('mobile layout (below the sm breakpoint)', () => {
  beforeEach(() => {
    matchMediaMatches = true;
  });

  test('opens full screen instead of a floating sm dialog', async () => {
    renderQuickView();

    await screen.findByText('Justin Jefferson');
    expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperFullScreen');
  });

  test('renders current-season weeks as stacked cards instead of a table', async () => {
    renderQuickView();
    await screen.findByText('Justin Jefferson');
    // lastView is module-level state shared across tests — force the view we assert on.
    fireEvent.click(screen.getByRole('button', { name: 'Current Season' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('list', {
      name: 'Justin Jefferson current-season weekly statistics',
    });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Week 1')).toBeInTheDocument();
    expect(within(cards[0]).getByText('8 Rec, 120 Rec Yds, 1 Rec TD')).toBeInTheDocument();
    // The headline wraps a nested caption span, so no element's text is exactly "20".
    expect(cards[0]).toHaveTextContent('20 FPTS');
  });

  test('renders previous seasons as stacked cards with games and per-game splits', async () => {
    renderQuickView();
    await screen.findByText('Justin Jefferson');
    fireEvent.click(screen.getByRole('button', { name: 'Previous Seasons' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('list', {
      name: 'Justin Jefferson previous-season statistics',
    });
    const [card] = within(list).getAllByRole('listitem');
    expect(within(card).getByText('2025')).toBeInTheDocument();
    expect(within(card).getByText('110 Rec, 1500 Rec Yds, 10 Rec TD')).toBeInTheDocument();
    expect(card).toHaveTextContent('300 FPTS');
    expect(within(card).getByText('Games')).toBeInTheDocument();
    expect(within(card).getByText('17')).toBeInTheDocument();
    expect(within(card).getByText('17.6')).toBeInTheDocument();
    expect(
      within(card).getByLabelText('FPTS/G: Fantasy points per game: total fantasy points divided by games played.')
    ).toBeInTheDocument();
    // Leave the shared toggle back on Current Season for any later test.
    fireEvent.click(screen.getByRole('button', { name: 'Current Season' }));
  });
});
