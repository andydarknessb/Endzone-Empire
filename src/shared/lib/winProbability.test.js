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

  test('a decided matchup (nothing left on either side) resolves to the result', () => {
    const final = { homeScore: 115.9, awayScore: 109.7, homeExpectedFinal: 115.9, awayExpectedFinal: 109.7 };
    expect(matchupWinProbability(final)).toEqual({ home: 1, away: 0 });
    expect(matchupWinProbability({
      homeScore: 109.7, awayScore: 115.9, homeExpectedFinal: 109.7, awayExpectedFinal: 115.9,
    })).toEqual({ home: 0, away: 1 });
    expect(matchupWinProbability({
      homeScore: 100, awayScore: 100, homeExpectedFinal: 100, awayExpectedFinal: 100,
    })).toEqual({ home: 0.5, away: 0.5 });
  });

  test('a live matchup with points remaining keeps the logistic', () => {
    const p = matchupWinProbability({
      homeScore: 97.9, awayScore: 95.7, homeExpectedFinal: 120.6, awayExpectedFinal: 112.4,
    });
    expect(p.home).toBeCloseTo(1 / (1 + Math.exp(-(120.6 - 112.4) / MARGIN_SCALE)), 12);
    expect(p.home).toBeGreaterThan(0.5);
    expect(p.home).toBeLessThan(0.7);
  });

  test('MARGIN_SCALE is exposed for the bar to reason about certainty', () => {
    expect(MARGIN_SCALE).toBeGreaterThan(0);
  });
});
