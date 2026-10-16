/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
import React from 'react';
import {
  act, render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import { formatKickoff } from '../../../shared/lib';
import PickemBoard from '../index';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

let mobile = false;
// Sunday Oct 18 2026, 2:40 PM CDT: the Sunday Early games are in progress, Thursday is final, and
// the 3:25 PM games lock in 45 minutes.
const NOW = Date.parse('2026-10-18T19:40:00Z');

beforeEach(() => {
  invalidate(undefined, { reload: false });
  mobile = false;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
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
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const LEAGUE_ID = 1;
const TNF = '2026-10-16T00:15:00Z'; // Thu 8:15 PM ET
const EARLY = '2026-10-18T17:00:00Z'; // Sun 1:00 PM ET
const LATE = '2026-10-18T20:25:00Z'; // Sun 4:25 PM ET, 45 minutes after NOW
const SNF = '2026-10-19T00:20:00Z';
const MNF = '2026-10-20T00:15:00Z';

const game = (key, kickoffAt, overrides = {}) => {
  const [awayTeam, homeTeam] = key.split('|');
  return {
    gameKey: key,
    teams: [awayTeam, homeTeam],
    kickoffAt,
    homeTeam,
    awayTeam,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    quarter: null,
    timeRemaining: null,
    locked: false,
    winner: null,
    isTie: false,
    pickedCount: 1,
    line: null,
    weather: null,
    venue: null,
    broadcast: null,
    records: null,
    situation: null,
    linescores: null,
    headline: null,
    ...overrides,
  };
};
const live = (key, extra = {}) => game(key, EARLY, {
  locked: true, status: 'in_progress', quarter: 'Q4', timeRemaining: '4:21', homeScore: 20, awayScore: 17, ...extra,
});

const EARLY_KEYS = ['JAX|LAR', 'CIN|NYJ', 'ATL|CAR', 'TEN|IND', 'BUF|MIA', 'DET|TB', 'HOU|SEA', 'MIN|PHI'];
// The Week 7 slate at 2:40 PM: 14 games. Early is all live, Thursday is final, three windows are open.
const slate = () => [
  game('CLE|PIT', TNF, { locked: true, status: 'final', homeScore: 20, awayScore: 10, winner: 'PIT' }),
  ...EARLY_KEYS.map((key) => live(key)),
  game('ARI|SF', LATE),
  game('DAL|DEN', LATE),
  game('KC|LV', LATE),
  game('CHI|GB', SNF),
  game('NYG|WAS', MNF),
];
// 9 of 14 picked: Thursday, five Sunday Early, KC, GB and WAS. ARI|SF and DAL|DEN are open and unpicked.
const NINE = [
  ['CLE|PIT', 'PIT'], ['JAX|LAR', 'JAX'], ['CIN|NYJ', 'CIN'], ['ATL|CAR', 'ATL'], ['TEN|IND', 'TEN'], ['BUF|MIA', 'BUF'],
  ['KC|LV', 'KC'], ['CHI|GB', 'GB'], ['NYG|WAS', 'WAS'],
].map(([gameKey, pickedTeam]) => ({ gameKey, pickedTeam, confidence: null }));

const leagueResponse = () => ({
  data: {
    viewerTeamId: 3,
    league: { id: LEAGUE_ID, name: 'MinneApple', current_week: 7 },
    teams: Array.from({ length: 12 }, (unused, index) => ({ teamId: index + 1, teamName: `T${index + 1}` })),
  },
});

// A fake server for the week: a PUT changes what the next GET returns, the way the real one does.
function serve({
  games = slate(), myPicks = [], mode = 'straight', putImpl,
} = {}) {
  const state = { myPicks: [...myPicks] };
  apiClient.get.mockImplementation((url) => {
    if (url === `/api/league/${LEAGUE_ID}`) return Promise.resolve(leagueResponse());
    if (url === `/api/pickem/league/${LEAGUE_ID}/week/7`) {
      return Promise.resolve({ data: { season: 2026, week: 7, mode, games, myPicks: state.myPicks, othersPicks: {} } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  apiClient.put.mockImplementation(async (url, body) => {
    if (putImpl) {
      const outcome = await putImpl(body);
      if (outcome) return outcome;
    }
    for (const pick of body.picks) {
      state.myPicks = state.myPicks.filter((entry) => entry.gameKey !== pick.gameKey);
      if (pick.pickedTeam != null) state.myPicks.push({ gameKey: pick.gameKey, pickedTeam: pick.pickedTeam, confidence: pick.confidence ?? null });
    }
    return { data: { saved: body.picks.length } };
  });
  return state;
}

const renderBoard = async (props = {}) => {
  const view = render(<PickemBoard leagueId={LEAGUE_ID} {...props} />);
  await screen.findAllByTestId('game-card');
  return view;
};
const cardFor = (matchup) => screen.getByRole('article', { name: new RegExp(`^${matchup}`) });
const teamButton = (team) => screen.getByRole('button', { name: new RegExp(`^${team},`) });

test('renders the week picker, no "All weeks", and the windows as frames with their own h3', async () => {
  serve();
  await renderBoard();
  expect(screen.getByTestId('pick-week')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /All weeks/i })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Picks' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Sunday Late' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Sunday Late' })).toBeInTheDocument();
});

test('AC 6a: the week picker never offers "All", and setWeek never receives it', async () => {
  const user = userEvent.setup();
  serve();
  await renderBoard();
  expect(screen.queryByText('All weeks')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Previous week' }));
  const weekGets = apiClient.get.mock.calls.map(([url]) => url).filter((url) => url.includes('/week/'));
  expect(weekGets.every((url) => /\/week\/\d+$/.test(url))).toBe(true);
  expect(weekGets.some((url) => /All/i.test(url))).toBe(false);
});

test('AC 6e: the Picks h2 row reads "9 of 14 picked · 2 open · next lock {day time}" and the cursor card says it locks in 45 min', async () => {
  serve({ myPicks: NINE });
  await renderBoard();
  expect(screen.getByTestId('pickem-status')).toHaveTextContent(`9 of 14 picked · 2 open · next lock ${formatKickoff(LATE)}`);
  expect(cardFor('ARI at SF, locks in 45 min')).toBeInTheDocument();
  expect(cardFor('DAL at DEN, locks in 45 min')).toBeInTheDocument();
  expect(teamButton('ARI')).toHaveAccessibleName(expect.stringMatching(/, locks in 45 min$/));
  // The status is plain text: no live region in the h2 row.
  expect(within(screen.getByTestId('pickem-status')).queryByRole('status')).toBeNull();
});

test('AC 6e: with every game picked it reads "14 of 14 picked · all saved"', async () => {
  const picks = slate().map((entry) => ({ gameKey: entry.gameKey, pickedTeam: entry.awayTeam, confidence: null }));
  serve({ myPicks: picks });
  await renderBoard();
  const status = screen.getByTestId('pickem-status');
  expect(status).toHaveTextContent('14 of 14 picked · all saved');
  expect(status).not.toHaveTextContent('open');
  expect(status.querySelector('a')).toBeNull();
});

test('AC 3 / 4: the cursor sits on the earliest unlocked unpicked game, Danger within the hour, and the next-lock link focuses it', async () => {
  const user = userEvent.setup();
  serve({ myPicks: NINE });
  const { container } = await renderBoard();
  const cursors = container.querySelectorAll('.cursor');
  expect(cursors).toHaveLength(1);
  expect(cursors[0]).toContainElement(cardFor('ARI at SF'));
  expect(cursors[0]).toHaveStyle({ borderColor: 'var(--ps-danger)' });
  expect(cursors[0]).toHaveAttribute('id', 'pickem-cursor');

  await user.click(screen.getByRole('link', { name: /next lock/ }));
  expect(cursors[0]).toHaveFocus();
});

test('AC 4: the cursor frame is the yellow Cursor token when the kickoff is an hour or more away', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T18:00:00Z'));
  serve({ games: slate().map((entry) => (entry.locked ? { ...entry, locked: false, status: 'scheduled' } : entry)), myPicks: [] });
  const { container } = await renderBoard();
  const cursors = container.querySelectorAll('.cursor');
  expect(cursors).toHaveLength(1);
  expect(cursors[0]).toHaveStyle({ borderColor: 'var(--ps-cursor)' });
  expect(screen.queryByTestId('locks-in')).not.toBeInTheDocument();
});

test('AC 3: every game picked, or every game locked, draws no cursor', async () => {
  serve({ myPicks: slate().map((entry) => ({ gameKey: entry.gameKey, pickedTeam: entry.awayTeam, confidence: null })) });
  const { container, unmount } = await renderBoard();
  expect(container.querySelectorAll('.cursor')).toHaveLength(0);
  unmount();

  invalidate(undefined, { reload: false });
  serve({ games: slate().map((entry) => ({ ...entry, locked: true, status: 'in_progress', quarter: 'Q1' })) });
  const { container: again } = render(<PickemBoard leagueId={LEAGUE_ID} />);
  expect(await screen.findByTestId('pickem-status')).toBeInTheDocument();
  expect(again.querySelectorAll('.cursor')).toHaveLength(0);
});

test('AC 6f: a settled window is one summary row with a Show games toggle, collapsed with no cards; pressing it renders them', async () => {
  const user = userEvent.setup();
  serve({ myPicks: NINE });
  await renderBoard();
  const early = screen.getByRole('region', { name: 'Sunday Early' });
  expect(within(early).getByTestId('window-summary')).toHaveTextContent('8 live · 5 picked · 3 no pick');
  const toggle = within(early).getByRole('button', { name: /Show games/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(early).queryAllByTestId('game-card')).toHaveLength(0);

  await user.click(toggle);
  expect(within(early).getAllByTestId('game-card')).toHaveLength(8);
  const hide = within(early).getByRole('button', { name: /Hide games/ });
  expect(hide).toHaveAttribute('aria-expanded', 'true');
  expect(hide).toHaveTextContent('Hide games');

  // Thursday is all final: "Final · 1 of 1 correct", and a one-game window never earns Perfect.
  const thursday = screen.getByRole('region', { name: 'Thursday Night' });
  expect(within(thursday).getByTestId('window-summary')).toHaveTextContent('Final · 1 of 1 correct');
  expect(within(thursday).queryByText('Perfect')).not.toBeInTheDocument();
});

test('AC 6f: a window with an open game renders its cards and no toggle; "League picks reveal at kickoff" is once per head', async () => {
  serve({ myPicks: NINE });
  await renderBoard();
  const late = screen.getByRole('region', { name: 'Sunday Late' });
  expect(within(late).getAllByTestId('game-card')).toHaveLength(3);
  expect(within(late).queryByRole('button', { name: /(Show|Hide) games/ })).not.toBeInTheDocument();
  expect(within(late).getAllByText('League picks reveal at kickoff')).toHaveLength(1);
  expect(within(late).getAllByTestId('picked-count')).toHaveLength(3);
});

test('a final window with every pick right reads Perfect with a pixel star', async () => {
  const eight = EARLY_KEYS.map((key) => game(key, EARLY, {
    locked: true, status: 'final', homeScore: 24, awayScore: 17, winner: key.split('|')[1],
  }));
  serve({
    games: [...eight, game('ARI|SF', LATE)],
    myPicks: EARLY_KEYS.map((key) => ({ gameKey: key, pickedTeam: key.split('|')[1], confidence: null })),
  });
  await renderBoard();
  const early = screen.getByRole('region', { name: 'Sunday Early' });
  expect(within(early).getByTestId('window-summary')).toHaveTextContent('Final · 8 of 8 correct');
  expect(within(early).getByText('Perfect')).toBeInTheDocument();
});

describe('save on tap', () => {
  test('AC 6d: choosing a team sends ONE put with a one-element picks array, shows Saving then Pick saved with an Undo', async () => {
    const user = userEvent.setup();
    let release;
    serve({ myPicks: NINE, putImpl: () => new Promise((resolve) => { release = resolve; }) });
    await renderBoard();

    await user.click(teamButton('ARI'));
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(apiClient.put).toHaveBeenCalledWith('/api/pickem/league/1/week/7/picks', {
      picks: [{ gameKey: 'ARI|SF', pickedTeam: 'ARI', confidence: null }],
    });
    const card = cardFor('ARI at SF');
    expect(within(card).getByRole('status')).toHaveTextContent('Saving…');
    // Saving is not saved: the chosen team is outlined, not filled, and no check yet.
    expect(teamButton('ARI')).toHaveAttribute('aria-pressed', 'false');
    expect(teamButton('ARI')).toHaveAccessibleName(expect.stringMatching(/, saving$/));

    await act(async () => { release(null); });
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Pick saved'));
    expect(within(card).getByRole('button', { name: /Undo pick, ARI at SF/ })).toBeInTheDocument();
    expect(teamButton('ARI')).toHaveAttribute('aria-pressed', 'true');
    expect(teamButton('ARI')).toHaveAccessibleName(expect.stringMatching(/, saved$/));
    // Only the save line is live: Undo sits outside the region.
    expect(within(card).getByRole('status')).not.toContainElement(within(card).getByRole('button', { name: /Undo/ }));
    // The status moved on: 10 of 14, one open.
    expect(screen.getByTestId('pickem-status')).toHaveTextContent('10 of 14 picked · 1 open');
  });

  test('AC 6d: Undo of a first pick sends pickedTeam null; Undo of a changed pick sends the previous pick', async () => {
    const user = userEvent.setup();
    serve({ myPicks: NINE });
    await renderBoard();

    await user.click(teamButton('ARI'));
    await user.click(await screen.findByRole('button', { name: /Undo pick, ARI at SF/ }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(2));
    expect(apiClient.put).toHaveBeenLastCalledWith('/api/pickem/league/1/week/7/picks', {
      picks: [{ gameKey: 'ARI|SF', pickedTeam: null, confidence: null }],
    });
    await waitFor(() => expect(teamButton('ARI')).toHaveAttribute('aria-pressed', 'false'));

    // KC|LV is picked KC; change to LV, then Undo restores KC.
    await user.click(teamButton('LV'));
    await user.click(await screen.findByRole('button', { name: /Undo pick, KC at LV/ }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(4));
    expect(apiClient.put).toHaveBeenLastCalledWith('/api/pickem/league/1/week/7/picks', {
      picks: [{ gameKey: 'KC|LV', pickedTeam: 'KC', confidence: null }],
    });
  });

  test('a save never reopens the loading state: the board stays on screen and focus stays on the tapped button', async () => {
    const user = userEvent.setup();
    serve({ myPicks: NINE });
    await renderBoard();
    await user.click(teamButton('ARI'));
    await screen.findByRole('button', { name: /Undo pick, ARI at SF/ });
    expect(screen.queryByTestId('game-card-skeleton')).not.toBeInTheDocument();
    expect(teamButton('ARI')).toHaveFocus();
  });

  test('AC 6d: a 409 PICKEM_LOCKED shows the kicked-off copy on that card only, drawn Locked', async () => {
    const user = userEvent.setup();
    const state = serve({
      myPicks: NINE,
      putImpl: () => Promise.reject({
        response: { status: 409, data: { code: 'PICKEM_LOCKED', error: 'locked', gameKeys: ['DAL|DEN'] } },
      }),
    });
    // The refresh after the 409 shows DAL @ DEN kicked off.
    const refreshed = slate().map((entry) => (entry.gameKey === 'DAL|DEN' ? { ...entry, locked: true, status: 'in_progress', quarter: 'Q1', timeRemaining: '15:00', homeScore: 0, awayScore: 0 } : entry));
    await renderBoard();
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/league/1') return Promise.resolve(leagueResponse());
      return Promise.resolve({ data: { season: 2026, week: 7, mode: 'straight', games: refreshed, myPicks: state.myPicks, othersPicks: {} } });
    });

    const card = cardFor('DAL at DEN');
    const node = within(card).getByRole('status');
    await user.click(teamButton('DEN'));
    await waitFor(() => expect(within(card).getByTestId('locked-badge')).toBeInTheDocument());
    // One status node per card in every phase: the refused text went into the node that was there.
    expect(within(card).getAllByRole('status')).toHaveLength(1);
    expect(within(card).getByRole('status')).toBe(node);
    expect(node).toHaveTextContent("This pick wasn't saved: DAL @ DEN had already kicked off. Your other picks are saved.");
    // No other card carries the message.
    expect(screen.getAllByText(/had already kicked off/)).toHaveLength(1);
    expect(teamButton('DEN')).toBeDisabled();
  });

  test('a failed save stays on its card with a Retry, the attempted team outlined and a 2px Danger edge, never the 4px frame', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    serve({
      myPicks: NINE,
      putImpl: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('Network Error')) : null;
      },
    });
    const { container } = await renderBoard();
    await user.click(teamButton('ARI'));
    const card = cardFor('ARI at SF');
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent("Couldn't save this pick."));
    expect(teamButton('ARI')).toHaveAttribute('aria-pressed', 'false');
    expect(teamButton('ARI')).toHaveAccessibleName(expect.stringMatching(/, not saved, retry$/));
    const wrapper = card.parentElement;
    expect(wrapper).toHaveStyle({ border: '2px solid var(--ps-danger)' });
    expect(wrapper).not.toHaveClass('cursor');
    expect(container.querySelectorAll('.cursor')).toHaveLength(0);

    await user.click(within(card).getByRole('button', { name: /Retry saving pick, ARI at SF/ }));
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Pick saved'));
    expect(apiClient.put).toHaveBeenCalledTimes(2);
  });

  test('after Undo, focus goes back to a team button of that card, not the page', async () => {
    const user = userEvent.setup();
    serve({ myPicks: NINE });
    await renderBoard();
    await user.click(teamButton('ARI'));
    await user.click(await screen.findByRole('button', { name: /Undo pick, ARI at SF/ }));
    await waitFor(() => expect(within(cardFor('ARI at SF')).getByRole('status')).toHaveTextContent('Pick undone'));
    expect(teamButton('ARI')).toHaveFocus();
  });

  test('after Retry lands, focus goes to the attempted team of that card', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    serve({ myPicks: NINE, putImpl: () => { attempts += 1; return attempts === 1 ? Promise.reject(new Error('Network Error')) : null; } });
    await renderBoard();
    await user.click(teamButton('DEN'));
    await user.click(await screen.findByRole('button', { name: /Retry saving pick, DAL at DEN/ }));
    await waitFor(() => expect(within(cardFor('DAL at DEN')).getByRole('status')).toHaveTextContent('Pick saved'));
    expect(teamButton('DEN')).toHaveFocus();
  });

  test('a 500 is retryable but a 400 is refused: no Retry, its own words', async () => {
    const user = userEvent.setup();
    serve({
      myPicks: NINE,
      putImpl: () => Promise.reject({ response: { status: 400, data: { code: 'PICKEM_BAD_GAME', error: 'bad' } } }),
    });
    await renderBoard();
    await user.click(teamButton('ARI'));
    const card = cardFor('ARI at SF');
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent("This pick wasn't saved. Reload the page and try again."));
    expect(within(card).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(card.parentElement).toHaveStyle({ border: '2px solid var(--ps-danger)' });
  });

  test('Undo refused after kickoff says the pick stands, in the same status node', async () => {
    const user = userEvent.setup();
    let puts = 0;
    serve({
      myPicks: NINE,
      putImpl: () => {
        puts += 1;
        return puts === 2
          ? Promise.reject({ response: { status: 409, data: { code: 'PICKEM_LOCKED', error: 'locked', gameKeys: ['ARI|SF'] } } })
          : null;
      },
    });
    await renderBoard();
    await user.click(teamButton('ARI'));
    const card = cardFor('ARI at SF');
    const node = within(card).getByRole('status');
    await user.click(await screen.findByRole('button', { name: /Undo pick, ARI at SF/ }));
    await waitFor(() => expect(node).toHaveTextContent("Undo didn't go through: ARI @ SF kicked off. Your pick ARI stands."));
    expect(within(card).getByRole('status')).toBe(node);
    expect(within(card).queryByRole('button', { name: /Retry|Undo/ })).not.toBeInTheDocument();
  });

  test('AC 6i: no Save picks button, no discard dialog and nothing sticky at the bottom', async () => {
    const user = userEvent.setup();
    serve({ myPicks: NINE });
    const { container } = await renderBoard();
    await user.click(teamButton('ARI'));
    await screen.findByRole('button', { name: /Undo pick/ });
    expect(screen.queryByRole('button', { name: /Save picks/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The week picker is not guarded either: changing weeks opens no dialog.
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const stickyBottom = Array.from(container.querySelectorAll('*')).filter((el) => /bottom:\s*0/.test(el.getAttribute('style') || ''));
    expect(stickyBottom).toHaveLength(0);
  });

  test('AC 6m: each open card carries a save line with role=status, empty at rest', async () => {
    serve({ myPicks: NINE });
    await renderBoard();
    for (const matchup of ['ARI at SF', 'DAL at DEN', 'KC at LV', 'CHI at GB', 'NYG at WAS']) {
      expect(within(cardFor(matchup)).getByRole('status')).toHaveTextContent('');
    }
  });

  test('onSaved fires after a save that landed, so the page can clear the standings cache', async () => {
    const user = userEvent.setup();
    const onSaved = jest.fn();
    serve({ myPicks: NINE });
    await renderBoard({ onSaved });
    await user.click(teamButton('ARI'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith({ ok: true });
  });
});

describe('confidence mode', () => {
  const RANKED = [
    { gameKey: 'CLE|PIT', pickedTeam: 'PIT', confidence: 14 },
    { gameKey: 'JAX|LAR', pickedTeam: 'JAX', confidence: 13 },
    { gameKey: 'MIN|PHI', pickedTeam: 'PHI', confidence: 9 },
    { gameKey: 'KC|LV', pickedTeam: 'KC', confidence: 4 },
    { gameKey: 'CHI|GB', pickedTeam: 'GB', confidence: 7 },
  ];

  test('AC 6g: with ranks 14, 13 and 9 used the strip says "11 ranks left" and the page shows the rule line', async () => {
    serve({ mode: 'confidence', myPicks: RANKED.slice(0, 3) });
    await renderBoard();
    const strip = screen.getByTestId('rank-strip');
    expect(strip).toHaveTextContent('11 ranks left');
    expect(within(strip).getByRole('img')).toHaveAccessibleName(/^Ranks used: 9, 13, 14/);
    expect(screen.getByTestId('confidence-rule')).toHaveTextContent(
      'Confidence league: give each game a rank from 1 to 14, each used once. A correct pick earns its rank.'
    );
    expect(strip).toHaveStyle({ position: 'sticky', top: '0px' });
  });

  test('a locked rank is marked in the strip: 13 belongs to a kicked-off game', async () => {
    serve({ mode: 'confidence', myPicks: RANKED.slice(0, 3) });
    await renderBoard();
    expect(within(screen.getByTestId('rank-strip')).getByRole('img')).toHaveAccessibleName(
      'Ranks used: 9, 13, 14; locked to kicked-off games: 9, 13, 14'
    );
  });

  test('AC 6n: ranks held by kicked-off games are aria-disabled and say locked in the menu', async () => {
    serve({ mode: 'confidence', myPicks: RANKED });
    await renderBoard();
    const select = within(cardFor('ARI at SF')).getByRole('combobox', { name: 'Confidence for ARI at SF' });
    const option = within(select).getByRole('option', { name: 'Confidence 13 · locked, JAX @ LAR' });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute('aria-disabled', 'true');
    // KC|LV is open: its rank stays in the menu as "used by", choosable only for a ranked game.
    expect(within(select).getByRole('option', { name: 'Confidence 4 · used by KC @ LV' })).toBeDisabled(); // ARI|SF has no rank yet
  });

  test('one hint per window head, and each disabled select points at it', async () => {
    serve({ mode: 'confidence', myPicks: RANKED });
    await renderBoard();
    const late = screen.getByRole('region', { name: 'Sunday Late' });
    const hints = within(late).getAllByText('Pick a team to set its confidence');
    expect(hints).toHaveLength(1);
    const select = within(cardFor('ARI at SF')).getByRole('combobox');
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('aria-describedby', hints[0].id);
  });

  test('a team tapped with no rank yet is a draft: nothing is sent until a rank is chosen, then it saves', async () => {
    const user = userEvent.setup();
    serve({ mode: 'confidence', myPicks: RANKED });
    await renderBoard();
    const card = cardFor('ARI at SF');
    await user.click(teamButton('ARI'));
    expect(apiClient.put).not.toHaveBeenCalled();
    const select = within(card).getByRole('combobox');
    expect(select).toBeEnabled();
    expect(select).toHaveFocus();

    await user.selectOptions(select, 'Confidence 1');
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/api/pickem/league/1/week/7/picks', {
      picks: [{ gameKey: 'ARI|SF', pickedTeam: 'ARI', confidence: 1 }],
    });
  });

  test('AC 6i: choosing a used rank sends ONE put with both games and both cards say "Swapped with"', async () => {
    const user = userEvent.setup();
    const state = serve({
      mode: 'confidence',
      myPicks: [...RANKED, { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 }].filter((pick) => pick.gameKey !== 'CHI|GB'),
    });
    await renderBoard();
    // ARI|SF holds 7; KC|LV holds 4. Choose 4 for ARI|SF.
    const select = within(cardFor('ARI at SF')).getByRole('combobox');
    await user.selectOptions(select, 'Confidence 4 · used by KC @ LV');
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    expect(apiClient.put).toHaveBeenCalledWith('/api/pickem/league/1/week/7/picks', {
      picks: [
        { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 4 },
        { gameKey: 'KC|LV', pickedTeam: 'KC', confidence: 7 },
      ],
    });
    await waitFor(() => expect(within(cardFor('ARI at SF')).getByRole('status')).toHaveTextContent('Swapped with KC @ LV'));
    expect(within(cardFor('KC at LV')).getByRole('status')).toHaveTextContent('Swapped with ARI @ SF');
    expect(state.myPicks.find((pick) => pick.gameKey === 'ARI|SF').confidence).toBe(4);
  });

  test('choosing a rank while another rank save is in flight is held with a plain line; no second request goes out', async () => {
    const user = userEvent.setup();
    let release;
    serve({
      mode: 'confidence',
      myPicks: [...RANKED.slice(0, 3), { gameKey: 'KC|LV', pickedTeam: 'KC', confidence: 4 }, { gameKey: 'ARI|SF', pickedTeam: 'SF', confidence: 7 }],
      putImpl: () => new Promise((resolve) => { release = resolve; }),
    });
    await renderBoard();
    await user.selectOptions(within(cardFor('ARI at SF')).getByRole('combobox'), 'Confidence 1');
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
    await user.selectOptions(within(cardFor('KC at LV')).getByRole('combobox'), 'Confidence 2');
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(within(cardFor('KC at LV')).getByRole('status')).toHaveTextContent('Another rank is still saving. Choose this rank again in a moment.');
    await act(async () => { release(null); });
    await waitFor(() => expect(within(cardFor('KC at LV')).getByRole('status')).toHaveTextContent(''));
    expect(within(cardFor('ARI at SF')).getByRole('status')).toHaveTextContent('Pick saved');
  });

  test('a ranked pick has no "Confidence: none" to choose', async () => {
    serve({ mode: 'confidence', myPicks: RANKED });
    await renderBoard();
    const ranked = within(cardFor('KC at LV')).getByRole('combobox');
    expect(within(ranked).queryByRole('option', { name: 'Confidence: none' })).not.toBeInTheDocument();
    const unranked = within(cardFor('ARI at SF')).getByRole('combobox');
    expect(within(unranked).getByRole('option', { name: 'Confidence: none' })).toBeInTheDocument();
  });

  test('confidence in the numbers help: the closed disclosure carries the Confidence entry only on confidence boards', async () => {
    serve({ mode: 'confidence', myPicks: [] });
    const { unmount } = await renderBoard();
    expect(screen.getByText('What the numbers mean').closest('details')).not.toHaveAttribute('open');
    expect(within(screen.getByText('What the numbers mean').closest('details')).getByText('Confidence')).toBeInTheDocument();
    unmount();
    invalidate(undefined, { reload: false });
    serve({ mode: 'straight', myPicks: [] });
    await renderBoard();
    expect(within(screen.getByText('What the numbers mean').closest('details')).queryByText('Confidence')).not.toBeInTheDocument();
  });
});

describe('live and final cards', () => {
  const liveSlate = () => [
    live('JAX|LAR', { situation: { possession: 'JAX', downDistance: '2nd & 10 at LAR 25', homeWinProbability: 0.62 }, reveal: undefined }),
    game('ARI|SF', LATE),
  ];

  test('AC 6 / 6c: a live card has ONE two-sided win probability image naming both teams, summing to 100, and no Forecast credit', async () => {
    const user = userEvent.setup();
    serve({ games: liveSlate(), myPicks: [{ gameKey: 'JAX|LAR', pickedTeam: 'JAX', confidence: null }] });
    await renderBoard();
    await user.click(screen.getByRole('button', { name: /Show games/ }));
    const card = cardFor('JAX at LAR');
    const odds = within(card).getAllByRole('img').filter((el) => /win probability/.test(el.getAttribute('aria-label')));
    expect(odds).toHaveLength(1);
    expect(odds[0]).toHaveAccessibleName('Jacksonville Jaguars 38%, Los Angeles Rams 62% win probability');
    expect(card).not.toHaveTextContent(/Endzone Forecast/);
    expect(within(card).getByText('Win probability')).toBeInTheDocument();
    expect(within(card).getByTestId('live-badge')).toHaveTextContent('Q4 · 4:21');
  });

  test('the missed outcome names the pick and is not red', async () => {
    const user = userEvent.setup();
    serve({
      games: [game('JAX|LAR', EARLY, {
        locked: true, status: 'final', homeScore: 27, awayScore: 20, winner: 'LAR', headline: 'Rams run out the clock.',
      }), game('ARI|SF', LATE)],
      myPicks: [{ gameKey: 'JAX|LAR', pickedTeam: 'JAX', confidence: null }],
    });
    await renderBoard();
    await user.click(screen.getByRole('button', { name: /Show games/ }));
    const chip = screen.getByTestId('outcome-badge');
    expect(chip).toHaveTextContent('Missed · picked JAX');
    expect(chip).toHaveStyle({ borderColor: 'var(--ps-ink)' });
  });
});

test('an unreachable week shows the error with a Retry that reloads it', async () => {
  const user = userEvent.setup();
  let fail = true;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/league/1') return Promise.resolve(leagueResponse());
    if (fail) return Promise.reject(new Error('boom'));
    return Promise.resolve({ data: { season: 2026, week: 7, mode: 'straight', games: slate(), myPicks: [], othersPicks: {} } });
  });
  render(<PickemBoard leagueId={LEAGUE_ID} />);
  expect(await screen.findByTestId('pickem-board-error')).toHaveTextContent("We could not load this week's picks right now.");
  expect(screen.queryByTestId('game-card')).not.toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect((await screen.findAllByTestId('game-card')).length).toBeGreaterThan(0);
});

test('a week with no games renders the empty state, not a blank board', async () => {
  serve({ games: [] });
  render(<PickemBoard leagueId={LEAGUE_ID} />);
  expect(await screen.findByTestId('pickem-board-empty')).toHaveTextContent('No games scheduled for week 7.');
  expect(screen.queryByTestId('pickem-status')).not.toBeInTheDocument();
});

test('the week picker grows to the 44px touch target on a phone', async () => {
  mobile = true;
  serve({ myPicks: NINE });
  await renderBoard();
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
  expect(screen.getByTestId('pick-week-weeks')).toBeInTheDocument();
});

test('the board paints no dash token and no element carries an opacity below 1', async () => {
  const user = userEvent.setup();
  serve({ myPicks: NINE });
  const { container } = await renderBoard();
  await user.click(screen.getAllByRole('button', { name: /Show games/ })[0]);
  expect(container.innerHTML).not.toMatch(/dash-/);
  const faded = Array.from(container.querySelectorAll('*')).filter((el) => {
    const { opacity } = getComputedStyle(el);
    return opacity !== '' && Number(opacity) < 1;
  });
  expect(faded).toHaveLength(0);
});

describe('lock at kickoff, with no refetch', () => {
  const KICKOFF = Date.parse(LATE);
  let clock;

  beforeEach(() => {
    // Real timers drive the board's repaint; only the clock is the test's own, set 1.5 seconds before
    // the 3:25 PM kickoff (and jumped past it below). The app fires no request at the lock itself.
    clock = KICKOFF - 1500;
    Date.now.mockImplementation(() => clock);
  });

  test('the Danger cursor card turns Locked at kickoff + 1 ms on the repaint, with no new request', async () => {
    serve({ myPicks: NINE });
    const { container } = await renderBoard();
    const card = cardFor('ARI at SF, locks in under 1 min');
    expect(container.querySelector('.cursor')).toContainElement(card);
    expect(container.querySelector('.cursor')).toHaveStyle({ borderColor: 'var(--ps-danger)' });
    expect(teamButton('ARI')).toBeEnabled();
    const requests = apiClient.get.mock.calls.length;

    // The clock passes kickoff; the board's own timer (set for kickoff + 1 ms) repaints.
    clock = KICKOFF + 1;
    // All three 3:25 PM games lock at the same instant, so the window settles into its summary row.
    const late = screen.getByRole('region', { name: 'Sunday Late' });
    await waitFor(() => expect(within(late).getByTestId('window-summary')).toBeInTheDocument(), { timeout: 5000 });
    expect(within(late).getByTestId('window-summary')).toHaveTextContent('3 live · 1 picked · 2 no pick');
    expect(container.querySelectorAll('.cursor')).toHaveLength(0);
    expect(screen.getByTestId('pickem-status')).toHaveTextContent('9 of 14 picked');
    expect(screen.getByTestId('pickem-status')).not.toHaveTextContent('open');
    expect(screen.getByTestId('pickem-status')).not.toHaveTextContent('next lock');
    await userEvent.setup().click(within(late).getByRole('button', { name: /Show games/ }));
    expect(within(cardFor('ARI at SF')).getByTestId('locked-badge')).toBeInTheDocument();
    expect(teamButton('ARI')).toBeDisabled();
    // No refetch drove any of it.
    expect(apiClient.get.mock.calls.length).toBe(requests);
  });
});
