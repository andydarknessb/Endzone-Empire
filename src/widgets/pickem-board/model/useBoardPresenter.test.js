import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import useBoardPresenter from './useBoardPresenter';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const NOW = Date.parse('2026-09-20T16:15:00Z'); // 45 minutes before the 1 PM ET games

beforeEach(() => {
  invalidate(undefined, { reload: false });
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const LEAGUE_ID = 1;

const leagueResponse = () => ({
  data: {
    viewerTeamId: 3,
    league: { id: LEAGUE_ID, name: 'MinneApple', current_week: 3 },
    teams: [{ teamId: 3, teamName: 'A' }, { teamId: 7, teamName: 'B' }, { teamId: 9, teamName: 'C' }],
  },
});

const game = (gameKey, kickoffAt, overrides = {}) => {
  const [awayTeam, homeTeam] = gameKey.split('|');
  return {
    gameKey,
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

const SUNDAY_EARLY = '2026-09-20T17:00:00Z';
const SUNDAY_LATE = '2026-09-20T20:25:00Z';

const weekResponse = (overrides = {}) => ({
  data: {
    season: 2026,
    week: 3,
    mode: 'confidence',
    games: [
      game('NYJ|TEN', SUNDAY_EARLY),
      game('DAL|WAS', SUNDAY_EARLY),
      game('HOU|IND', SUNDAY_LATE),
    ],
    myPicks: [],
    othersPicks: {},
    ...overrides,
  },
});

const mockGetByUrl = (map) => {
  apiClient.get.mockImplementation((url) =>
    Object.prototype.hasOwnProperty.call(map, url)
      ? Promise.resolve(map[url])
      : Promise.reject(new Error(`unexpected GET ${url}`)));
};

test('defaults the week to the league\'s own current week and groups games by kickoff window', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), '/api/pickem/league/1/week/3': weekResponse() });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));

  await waitFor(() => expect(result.current.windows.length).toBeGreaterThan(0));
  expect(result.current.week).toBe(3);
  expect(result.current.totalManagers).toBe(3);
  expect(result.current.slateSize).toBe(3);
  expect(result.current.windows.map((group) => group.window)).toEqual(['sunday-early', 'sunday-late']);
});

test('the cursor is the earliest unlocked unpicked game, and the status counts picked, open and the next lock', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse({ myPicks: [{ gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: 5 }] }),
  });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(3));

  expect(result.current.cursorKey).toBe('DAL|WAS');
  expect(result.current.cursorLockMinutes).toBe(45);
  expect(result.current.status).toEqual({
    picked: 1, total: 3, open: 2, nextLock: SUNDAY_EARLY,
  });
});

test('every view carries its lock words: whole minutes only under an hour', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), '/api/pickem/league/1/week/3': weekResponse() });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(3));
  const views = result.current.windows.flatMap((group) => group.games);
  expect(views.map((view) => view.lockMinutes)).toEqual([45, 45, null]);
});

test('usedByFor names who holds each rank, locked when that game kicked off, never this game\'s own', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse({
      games: [
        game('NYJ|TEN', SUNDAY_EARLY, { locked: true, status: 'in_progress', quarter: 'Q1' }),
        game('DAL|WAS', SUNDAY_EARLY),
        game('HOU|IND', SUNDAY_LATE),
      ],
      myPicks: [
        { gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: 5 },
        { gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: 2 },
      ],
    }),
  });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(3));

  expect(result.current.usedByFor('HOU|IND')).toEqual({
    5: { label: 'NYJ @ TEN', locked: true },
    2: { label: 'DAL @ WAS', locked: false },
  });
  expect(result.current.usedByFor('DAL|WAS')).toEqual({ 5: { label: 'NYJ @ TEN', locked: true } });
  expect(result.current.confidence).toEqual({ usedRanks: [2, 5], lockedRanks: [5], left: 1 });
});

test('a straight-up board has no confidence strip data', async () => {
  mockGetByUrl({ '/api/league/1': leagueResponse(), '/api/pickem/league/1/week/3': weekResponse({ mode: 'straight' }) });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(3));
  expect(result.current.confidence).toBeNull();
});

test('picking a winner saves at once and the view carries the saved pick, with no draft or dirty state', async () => {
  // The server keeps what was saved: the background refresh after the save reads it back.
  let myPicks = [];
  apiClient.get.mockImplementation((url) => Promise.resolve(
    url === '/api/league/1' ? leagueResponse() : weekResponse({ mode: 'straight', myPicks })
  ));
  apiClient.put.mockImplementation(async (url, body) => {
    myPicks = body.picks.map((pick) => ({ ...pick }));
    return { data: { saved: 1 } };
  });
  const onSaved = jest.fn();
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID, { onSaved }));
  await waitFor(() => expect(result.current.slateSize).toBe(3));

  await act(async () => { result.current.onPickWinner('NYJ|TEN', 'TEN'); });

  expect(apiClient.put).toHaveBeenCalledWith('/api/pickem/league/1/week/3/picks', {
    picks: [{ gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: null }],
  });
  await waitFor(() => {
    const view = result.current.windows.flatMap((group) => group.games).find((entry) => entry.gameKey === 'NYJ|TEN');
    expect(view.myPick).toBe('TEN');
  });
  expect(result.current.status.picked).toBe(1);
  expect(result.current.stateFor('NYJ|TEN')).toMatchObject({ status: 'saved' });
  expect(onSaved).toHaveBeenCalledWith({ ok: true });
  expect(result.current).not.toHaveProperty('isDirty');
});
