import { matchupBoard } from './matchupBoard';

const side = (teamId, score, expectedFinal, playersRemaining) => ({
  teamId, name: `Team ${teamId}`, score, expectedFinal, playersRemaining,
});
const matchup = (status, over = {}) => ({
  id: 1,
  status,
  home: side(10, 100, 120, 2),
  away: side(20, 90, 110, 3),
  ...over,
});

describe('matchupBoard: the one board reading of a Matchup (#2048)', () => {
  // status -> chip, hasStarted, settled, whether a win probability, whether the Expected final survives
  it.each([
    ['scheduled', { label: 'Scheduled', variant: 'neutral', dot: false }, false, false, false, true],
    ['live', { label: 'LIVE', variant: 'danger', dot: true }, true, false, true, true],
    ['played', { label: 'Awaiting final', variant: 'warning', dot: false }, true, true, false, false],
    ['final', { label: 'Final', variant: 'success', dot: false }, true, true, false, false],
    [null, null, null, false, false, true],
  ])('status %s', (status, chip, hasStarted, settled, hasProbability, keepsExpected) => {
    const board = matchupBoard(matchup(status), 10);
    expect(board.chip).toEqual(chip);
    expect(board.hasStarted).toBe(hasStarted);
    expect(board.settled).toBe(settled);
    expect(board.winProbability !== null).toBe(hasProbability);
    expect(board.home.expectedFinal).toBe(keepsExpected ? 120 : null);
    expect(board.away.expectedFinal).toBe(keepsExpected ? 110 : null);
    expect(board.resultLine !== null).toBe(settled);
  });

  it('an unrecognised status is unknown, like null', () => {
    const board = matchupBoard(matchup('postponed'), 10);
    expect(board).toMatchObject({ chip: null, hasStarted: null, settled: false, winProbability: null });
  });

  it('carries score and Players remaining through on every side', () => {
    const board = matchupBoard(matchup('live'), 10);
    expect(board.home).toEqual({ score: 100, expectedFinal: 120, playersRemaining: 2 });
    expect(board.away).toEqual({ score: 90, expectedFinal: 110, playersRemaining: 3 });
  });

  it('prices the live win probability from the scores and Expected finals', () => {
    const { winProbability } = matchupBoard(matchup('live'), 10);
    expect(winProbability.home).toBeGreaterThan(0.5);
    expect(winProbability.home + winProbability.away).toBeCloseTo(1);
  });

  describe('viewer or spectator', () => {
    it('reads the result line from the viewer side', () => {
      expect(matchupBoard(matchup('final'), 10).resultLine).toBe('You won by 10.0');
      expect(matchupBoard(matchup('final'), 20).resultLine).toBe('You lost by 10.0');
    });
    it('names the winner for a spectator', () => {
      expect(matchupBoard(matchup('final'), null).resultLine).toBe('Team 10 won by 10.0');
      expect(matchupBoard(matchup('played'), 99).resultLine).toBe('Unofficial: Team 10 won by 10.0');
    });
  });

  describe('a missing score', () => {
    const noScore = { home: side(10, null, 120, 2) };
    it('gives a settled Matchup no result line, but it is still settled', () => {
      const board = matchupBoard(matchup('final', noScore), 10);
      expect(board).toMatchObject({ settled: true, resultLine: null });
      expect(board.home.score).toBeNull();
    });
    it('keeps a live Matchup live', () => {
      expect(matchupBoard(matchup('live', noScore), 10)).toMatchObject({ hasStarted: true, settled: false });
    });
  });

  it('reads an empty Matchup as unknown', () => {
    expect(matchupBoard(null, 10)).toMatchObject({ chip: null, hasStarted: null, settled: false, resultLine: null });
  });
});
