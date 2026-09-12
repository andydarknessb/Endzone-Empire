import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { invalidate } from '../../../lib/resourceCache';
import useBoardPresenter from './useBoardPresenter';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => {
  invalidate(undefined, { reload: false });
});

afterEach(() => {
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

const weekResponse = (overrides = {}) => ({
  data: {
    season: 2026,
    week: 3,
    mode: 'confidence',
    games: [
      {
        gameKey: 'NYJ|TEN',
        teams: ['NYJ', 'TEN'],
        kickoffAt: '2026-09-20T17:00:00Z',
        homeTeam: 'TEN',
        awayTeam: 'NYJ',
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
      },
      {
        gameKey: 'DAL|WAS',
        teams: ['WAS', 'DAL'],
        kickoffAt: '2026-09-21T17:00:00Z',
        homeTeam: 'DAL',
        awayTeam: 'WAS',
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        quarter: null,
        timeRemaining: null,
        locked: false,
        winner: null,
        isTie: false,
        pickedCount: 0,
        line: null,
        weather: null,
        venue: null,
        broadcast: null,
        records: null,
        situation: null,
        linescores: null,
        headline: null,
      },
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
      : Promise.reject(new Error(`unexpected GET ${url}`))
  );
};

test('defaults the week to the league\'s own current week and groups games by kickoff window', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse(),
  });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));

  await waitFor(() => expect(result.current.week).toBe(3));
  await waitFor(() => expect(result.current.windows.length).toBeGreaterThan(0));

  expect(result.current.totalManagers).toBe(3);
  expect(result.current.slateSize).toBe(2);
  const allGameKeys = result.current.windows.flatMap((w) => w.games.map((g) => g.gameKey));
  expect(allGameKeys.sort()).toEqual(['DAL|WAS', 'NYJ|TEN']);
});

test('pickWinner reflects immediately in the view (draft-aware) before any save', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse(),
  });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(2));

  act(() => result.current.onPickWinner('NYJ|TEN', 'TEN'));

  await waitFor(() => {
    const view = result.current.windows.flatMap((w) => w.games).find((g) => g.gameKey === 'NYJ|TEN');
    expect(view.myPick).toBe('TEN');
  });
  expect(result.current.isDirty).toBe(true);
  expect(result.current.pickedCount).toBe(1);
});

test('confidenceUsedByFor excludes a game\'s own current confidence but names other games\'', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse({
      myPicks: [{ gameKey: 'NYJ|TEN', pickedTeam: 'TEN', confidence: 5 }],
    }),
  });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(2));

  expect(result.current.confidenceUsedByFor('DAL|WAS')).toEqual([5]);
  expect(result.current.confidenceUsedByFor('NYJ|TEN')).toEqual([]);
});

test('a rejected save flags the named gameKey with the server\'s own message', async () => {
  mockGetByUrl({
    '/api/league/1': leagueResponse(),
    '/api/pickem/league/1/week/3': weekResponse(),
  });
  apiClient.put.mockRejectedValue({
    response: { data: { code: 'PICKEM_LOCKED', gameKeys: ['NYJ|TEN'], error: 'that game already kicked off' } },
  });
  const { result } = renderHook(() => useBoardPresenter(LEAGUE_ID));
  await waitFor(() => expect(result.current.slateSize).toBe(2));

  act(() => result.current.onPickWinner('NYJ|TEN', 'TEN'));
  await act(async () => {
    await result.current.onSave();
  });

  await waitFor(() => expect(result.current.flaggedMessages['NYJ|TEN']).toBeTruthy());
});
