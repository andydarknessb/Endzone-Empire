import { matchupBoard, matchupPhase } from './matchupBoard';

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
  // status -> chip, hasStarted, settled, isLive, isFinal, whether a win probability, whether the Expected final survives
  it.each([
    ['scheduled', { label: 'Scheduled', variant: 'neutral', dot: false }, false, false, false, false, false, true],
    ['live', { label: 'LIVE', variant: 'danger', dot: true }, true, false, true, false, true, true],
    ['played', { label: 'Awaiting final', variant: 'warning', dot: false }, true, true, false, false, true, false],
    ['final', { label: 'Final', variant: 'success', dot: false }, true, true, false, true, true, false],
    [null, null, null, false, false, false, false, true],
  ])('status %s', (status, chip, hasStarted, settled, isLive, isFinal, hasProbability, keepsExpected) => {
    const board = matchupBoard(matchup(status), 10);
    expect(board.chip).toEqual(chip);
    expect(board.hasStarted).toBe(hasStarted);
    expect(board.settled).toBe(settled);
    expect(board.isLive).toBe(isLive);
    expect(board.isFinal).toBe(isFinal);
    expect(board.winProbability !== null).toBe(hasProbability);
    expect(board.projectedWinProbability !== null).toBe(status === 'scheduled');
    expect(board.home.expectedFinal).toBe(keepsExpected ? 120 : null);
    expect(board.away.expectedFinal).toBe(keepsExpected ? 110 : null);
    expect(board.resultLine !== null).toBe(settled);
  });

  it('an unrecognised status is unknown, like null', () => {
    const board = matchupBoard(matchup('postponed'), 10);
    expect(board).toMatchObject({ chip: null, hasStarted: null, settled: false, isLive: false, isFinal: false, winProbability: null, projectedWinProbability: null });
  });

  it('carries score and Players remaining through on every side', () => {
    const board = matchupBoard(matchup('live'), 10);
    expect(board.home).toEqual({ score: 100, scoreLabel: '100.0', expectedFinal: 120, playersRemaining: 2, playersRemainingLabel: '2' });
    expect(board.away).toEqual({ score: 90, scoreLabel: '90.0', expectedFinal: 110, playersRemaining: 3, playersRemainingLabel: '3' });
  });

  it('prices the live win probability from the scores and Expected finals', () => {
    const { winProbability } = matchupBoard(matchup('live'), 10);
    expect(winProbability.home).toBeGreaterThan(0.5);
    expect(winProbability.home + winProbability.away).toBeCloseTo(1);
  });

  it('states no Win probability before kickoff, only the projection-priced split', () => {
    const board = matchupBoard(matchup('scheduled', { home: side(10, 0, 130, 9), away: side(20, 0, 100, 9) }), 10);
    expect(board.winProbability).toBeNull();
    expect(board.projectedWinProbability.home).toBeGreaterThan(0.5);
  });

  it('decides a settled Matchup from the scores alone', () => {
    expect(matchupBoard(matchup('final'), 10).winProbability).toEqual({ home: 1, away: 0 });
    expect(matchupBoard(matchup('played', { home: side(10, 80, null, 0), away: side(20, 90, null, 0) }), 10).winProbability)
      .toEqual({ home: 0, away: 1 });
  });

  describe('isFinal on a null status', () => {
    it('falls back to the body\'s `final` flag', () => {
      expect(matchupBoard(matchup(null, { final: true }), 10).isFinal).toBe(true);
      expect(matchupBoard(matchup(undefined, { final: true }), 10).isFinal).toBe(true);
      expect(matchupBoard(matchup(null), 10).isFinal).toBe(false);
    });
    it('never overrides a status the server stated', () => {
      expect(matchupBoard(matchup('live', { final: true }), 10).isFinal).toBe(false);
      expect(matchupBoard(matchup('postponed', { final: true }), 10).isFinal).toBe(false);
    });
  });

  describe('matchupPhase: the status-only reading', () => {
    it.each([
      ['scheduled', false, false, false, false],
      ['live', true, false, true, false],
      ['played', true, true, false, false],
      ['final', true, true, false, true],
    ])('%s', (status, hasStarted, settled, isLive, isFinal) => {
      expect(matchupPhase(status)).toEqual({ chip: matchupBoard({ status }).chip, hasStarted, settled, isLive, isFinal });
    });
    it('reads an unknown status as asserting nothing', () => {
      expect(matchupPhase(null)).toEqual({ chip: null, hasStarted: null, settled: false, isLive: false, isFinal: false });
      expect(matchupPhase('postponed').chip).toBeNull();
    });
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

  describe('viewerSide (#2142)', () => {
    it('picks the side by Team id, never by name', () => {
      const m = matchup('live', { home: { ...side(10, 1, 1, 1), name: 'Same Name' }, away: { ...side(20, 1, 1, 1), name: 'Same Name' } });
      expect(matchupBoard(m, 10).viewerSide).toBe('home');
      expect(matchupBoard(m, 20).viewerSide).toBe('away');
      expect(matchupBoard(m, 99).viewerSide).toBeNull();
      expect(matchupBoard(m, null).viewerSide).toBeNull();
      expect(matchupBoard(m).viewerSide).toBeNull();
    });
    it('does not match a missing Team id to a missing viewer', () => {
      const m = matchup('live', { home: side(null, 1, 1, 1) });
      expect(matchupBoard(m, null).viewerSide).toBeNull();
      expect(matchupBoard(m, undefined).viewerSide).toBeNull();
    });
  });

  describe('scoreLabel (#2142)', () => {
    it('reads 0.0 on both sides for a scheduled Matchup with no score rows', () => {
      const board = matchupBoard(matchup('scheduled', { home: side(10, null, 120, 9), away: side(20, undefined, 110, 9) }), 10);
      expect(board.home.scoreLabel).toBe('0.0');
      expect(board.away.scoreLabel).toBe('0.0');
    });
    it('reads 0.0 for a score that is not a number, and one decimal otherwise', () => {
      const board = matchupBoard(matchup('live', { home: side(10, 'x', 1, 1), away: side(20, '87.46', 1, 1) }), 10);
      expect(board.home.scoreLabel).toBe('0.0');
      expect(board.away.scoreLabel).toBe('87.5');
    });
    it('has no label when there is no Matchup at all (a bye)', () => {
      const board = matchupBoard(null, 10);
      expect(board.home.scoreLabel).toBeNull();
      expect(board.away.scoreLabel).toBeNull();
    });
    it('leaves the raw score and the result line alone: a missing score is still no result', () => {
      const board = matchupBoard(matchup('final', { home: side(10, null, 1, 0) }), 10);
      expect(board.home.score).toBeNull();
      expect(board.resultLine).toBeNull();
    });
  });

  describe('playersRemainingLabel (#2142)', () => {
    it('is the whole count, and null when the server did not say', () => {
      const board = matchupBoard(matchup('live', { home: side(10, 1, 1, 4), away: side(20, 1, 1, null) }), 10);
      expect(board.home.playersRemainingLabel).toBe('4');
      expect(board.away.playersRemainingLabel).toBeNull();
      expect(matchupBoard(matchup('live', { home: side(10, 1, 1, 0) }), 10).home.playersRemainingLabel).toBe('0');
      expect(matchupBoard(matchup('live', { home: side(10, 1, 1, '') }), 10).home.playersRemainingLabel).toBeNull();
    });
  });

  describe('liveLine (#2142)', () => {
    const live = (home, away, v) => matchupBoard(matchup('live', { home, away }), v).liveLine;
    it('is written from the viewer side and only while live', () => {
      expect(live(side(10, 100, 120, 0), side(20, 90, 110, 3), 10)).toBe('Ahead now, projected to lead by 10.0 with 3 of theirs still to play');
      expect(live(side(10, 100, 120, 0), side(20, 90, 110, 3), 20)).toBe('Behind now, projected to trail by 10.0 with 3 of yours still to play');
      expect(matchupBoard(matchup('final'), 10).liveLine).toBeNull();
      expect(matchupBoard(matchup('scheduled'), 10).liveLine).toBeNull();
    });
    it('drops the projection when an Expected final is unknown, and says tied when level', () => {
      expect(live(side(10, 50, null, 0), side(20, 50, 90, 2), 10)).toBe('Tied now with 2 of theirs still to play');
    });
    it('names the viewer own remaining when the opponent has none, and falls back to the home side for a spectator', () => {
      expect(live(side(10, 50, 60, 2), side(20, 40, 60, 0), 10)).toBe('Ahead now, projected to finish even with 2 of yours still to play');
      expect(live(side(10, 50, 60, 2), side(20, 40, 60, 0), null)).toBe('Ahead now, projected to finish even with 2 of yours still to play');
    });
  });
});
