import { matchupWinProbability, remainingPoints, MARGIN_SCALE } from './winProbability';

describe('win probability', () => {
  test('remainingPoints never goes negative', () => {
    expect(remainingPoints(100, 40)).toBe(60);
    expect(remainingPoints(40, 100)).toBe(0);
  });

  test('symmetric even matchup is 50/50', () => {
    const p = matchupWinProbability({
      homeScore: 50, awayScore: 50, homeExpectedFinal: 110, awayExpectedFinal: 110,
    });
    expect(p.home).toBeCloseTo(0.5, 5);
    expect(p.home + p.away).toBeCloseTo(1, 10);
  });

  test('a big lead late (little projected remaining) approaches certainty', () => {
    const p = matchupWinProbability({
      homeScore: 120, awayScore: 90, homeExpectedFinal: 121, awayExpectedFinal: 91,
    });
    expect(p.home).toBeGreaterThan(0.75);
  });

  test('projected comeback still in play keeps it competitive', () => {
    const p = matchupWinProbability({
      homeScore: 80, awayScore: 60, homeExpectedFinal: 100, awayExpectedFinal: 115,
    });
    // Away trails now but is projected to finish ahead -> home under 50%.
    expect(p.home).toBeLessThan(0.5);
  });

  test('a played or final matchup resolves to the result by the scores', () => {
    const scores = { homeScore: 115.9, awayScore: 109.7, homeExpectedFinal: 115.9, awayExpectedFinal: 109.7 };
    const reversed = { homeScore: 109.7, awayScore: 115.9, homeExpectedFinal: 109.7, awayExpectedFinal: 115.9 };
    const tied = { homeScore: 100, awayScore: 100, homeExpectedFinal: 100, awayExpectedFinal: 100 };
    for (const status of ['final', 'played']) {
      expect(matchupWinProbability({ ...scores, status })).toEqual({ home: 1, away: 0 });
      expect(matchupWinProbability({ ...reversed, status })).toEqual({ home: 0, away: 1 });
      expect(matchupWinProbability({ ...tied, status })).toEqual({ home: 0.5, away: 0.5 });
    }
    // The scores decide it, whatever the Expected finals say.
    expect(matchupWinProbability({ ...scores, homeExpectedFinal: 90, awayExpectedFinal: 200, status: 'final' }))
      .toEqual({ home: 1, away: 0 });
  });

  test('a live matchup with no Expected finals stays a logistic, never certain', () => {
    const p = matchupWinProbability({
      homeScore: 60, awayScore: 40, homeExpectedFinal: null, awayExpectedFinal: null, status: 'live',
    });
    expect(p.home).toBeCloseTo(1 / (1 + Math.exp(-20 / MARGIN_SCALE)), 12);
    expect(p.home).toBeLessThan(1);
    expect(p.home).toBeGreaterThan(0.5);
  });

  test('scheduled, unknown and missing status keep the logistic', () => {
    const input = { homeScore: 115.9, awayScore: 109.7, homeExpectedFinal: 115.9, awayExpectedFinal: 109.7 };
    const logistic = 1 / (1 + Math.exp(-6.2 / MARGIN_SCALE));
    for (const status of [undefined, null, 'scheduled', 'live']) {
      expect(matchupWinProbability({ ...input, status }).home).toBeCloseTo(logistic, 12);
    }
  });

  test('a live matchup with points remaining keeps the logistic', () => {
    const p = matchupWinProbability({
      homeScore: 97.9, awayScore: 95.7, homeExpectedFinal: 120.6, awayExpectedFinal: 112.4, status: 'live',
    });
    expect(p.home).toBeCloseTo(1 / (1 + Math.exp(-(120.6 - 112.4) / MARGIN_SCALE)), 12);
    expect(p.home).toBeGreaterThan(0.5);
    expect(p.home).toBeLessThan(0.7);
  });

  test('MARGIN_SCALE is exposed for the bar to reason about certainty', () => {
    expect(MARGIN_SCALE).toBeGreaterThan(0);
  });
});
