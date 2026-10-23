import { act, renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../api/apiClient';
import { invalidate } from '../../lib/resourceCache';
import { buildFactRows, formatGenerated, useRecap } from './RecapCard';

jest.mock('../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

beforeEach(() => {
  // The commissioner flag rides useLeague's shared cache (ADR 0004), module
  // state that outlives a test, so it is cleared whole between them.
  invalidate(undefined, { reload: false });
});

afterEach(() => {
  jest.clearAllMocks();
});

const mockGetByUrl = (overrides = {}) => {
  apiClient.get.mockImplementation((url) => {
    for (const [key, value] of Object.entries(overrides)) {
      if (url === key || url.endsWith(key)) return Promise.resolve(value);
    }
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
};

const leagueResponse = (isCommissioner, currentSeason = 2026) => ({
  data: {
    league: { id: 1, is_commissioner: isCommissioner, current_season: currentSeason },
    teams: [],
    viewerTeamId: null,
  },
});

const recapResponse = (data = {}) => ({
  data: {
    season: 2026,
    week: 5,
    data: { generatedAt: '2026-07-10T12:00:00.000Z', narrative: 'The story.', facts: {}, ...data },
  },
});

describe('buildFactRows', () => {
  test('a bold label then the value, joined by middots, in the fixed order', () => {
    const rows = buildFactRows({
      highestScorer: { team: 'Sunday Ballers', points: 142.5 },
      benchBlunder: { team: 'Bad Luck FC', pointsLeftOnBench: 22.1 },
      waiverSteal: { player: 'Puka Nacua', team: 'Bad Luck FC', points: 28.4 },
      closestMatchup: { home: 'Team A', away: 'Team B', homeScore: 100, awayScore: 99, margin: 1 },
    });
    expect(rows.map((r) => `${r.label}${r.value}`)).toEqual([
      'High scoreSunday Ballers · 142.5',
      'Bench blunderBad Luck FC · 22.1 left on the bench',
      'Waiver stealPuka Nacua · Bad Luck FC · 28.4 pts',
      'Closest gameTeam A vs Team B · by 1',
    ]);
  });

  test('a five-fact payload renders four rows, and no facts renders none', () => {
    const rows = buildFactRows({
      highestScorer: { team: 'A', points: 1 },
      benchBlunder: { team: 'B', pointsLeftOnBench: 2 },
      waiverSteal: { player: 'P', team: 'C', points: 3 },
      closestMatchup: { home: 'D', away: 'E', homeScore: 1, awayScore: 0, margin: 1 },
      biggestBlowout: { home: 'F', away: 'G', homeScore: 90, awayScore: 10, margin: 80 },
    });
    expect(rows).toHaveLength(4);
    expect(buildFactRows(null)).toEqual([]);
  });
});

describe('formatGenerated', () => {
  test('month, day, hour and minute only; null without a stamp', () => {
    const iso = '2026-07-10T12:00:00.000Z';
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
    expect(formatGenerated(iso)).toBe(expected);
    expect(formatGenerated(null)).toBeNull();
  });
});

describe('useRecap', () => {
  test('stays null when the recap endpoint 404s', async () => {
    apiClient.get.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useRecap(1));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(result.current.recap).toBeNull();
  });

  test('a commissioner rebuild posts the week and season on screen and replaces the recap', async () => {
    mockGetByUrl({
      '/api/scoring/league/1/recap': recapResponse(),
      '/api/league/1': leagueResponse(true, 2026),
    });
    apiClient.post.mockResolvedValue(recapResponse({ narrative: 'Rebuilt.' }));

    const { result } = renderHook(() => useRecap(1));
    await waitFor(() => expect(result.current.isCommissioner && result.current.isCurrentSeasonRecap).toBe(true));
    await act(() => result.current.handleRebuild());

    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/1/recap', { week: 5, season: 2026 });
    expect(result.current.recap.data.narrative).toBe('Rebuilt.');
  });

  test('an older season recap is not rebuildable, even for a commissioner', async () => {
    mockGetByUrl({
      '/api/scoring/league/1/recap': recapResponse(),
      '/api/league/1': leagueResponse(true, 2027),
    });
    const { result } = renderHook(() => useRecap(1));
    await waitFor(() => expect(result.current.isCommissioner).toBe(true));
    await waitFor(() => expect(result.current.recap).not.toBeNull());
    expect(result.current.isCurrentSeasonRecap).toBe(false);
  });
});
