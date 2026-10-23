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
    expect(board.first.expectedFinal).toBe(keepsExpected ? 120 : null);
    expect(board.second.expectedFinal).toBe(keepsExpected ? 110 : null);
    expect(board.resultLine !== null).toBe(settled);
  });

  it('an unrecognised status is unknown, like null', () => {
    const board = matchupBoard(matchup('postponed'), 10);
    expect(board).toMatchObject({ chip: null, hasStarted: null, settled: false, isLive: false, isFinal: false, winProbability: null, projectedWinProbability: null });
  });

  it('carries score and Players remaining through on every side', () => {
    const board = matchupBoard(matchup('live'), 10);
    expect(board.first).toMatchObject({ score: 100, scoreLabel: '100.0', expectedFinal: 120, playersRemaining: 2, playersRemainingLabel: '2', yetToPlay: null });
    expect(board.second).toMatchObject({ score: 90, scoreLabel: '90.0', expectedFinal: 110, playersRemaining: 3, playersRemainingLabel: '3', yetToPlay: null });
  });

  it('prices the live win probability from the scores and Expected finals', () => {
    const { winProbability } = matchupBoard(matchup('live'), 10);
    expect(winProbability.first).toBeGreaterThan(0.5);
    expect(winProbability.first + winProbability.second).toBeCloseTo(1);
  });

  it('states no Win probability before kickoff, only the projection-priced split', () => {
    const board = matchupBoard(matchup('scheduled', { home: side(10, 0, 130, 9), away: side(20, 0, 100, 9) }), 10);
    expect(board.winProbability).toBeNull();
    expect(board.projectedWinProbability.first).toBeGreaterThan(0.5);
  });

  it('decides a settled Matchup from the scores alone', () => {
    expect(matchupBoard(matchup('final'), 10).winProbability).toEqual({ first: 1, second: 0 });
    expect(matchupBoard(matchup('played', { home: side(10, 80, null, 0), away: side(20, 90, null, 0) }), 10).winProbability)
      .toEqual({ first: 0, second: 1 });
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
      expect(board.first.score).toBeNull();
    });
    it('keeps a live Matchup live', () => {
      expect(matchupBoard(matchup('live', noScore), 10)).toMatchObject({ hasStarted: true, settled: false });
    });
  });

  it('reads an empty Matchup as unknown', () => {
    expect(matchupBoard(null, 10)).toMatchObject({ chip: null, hasStarted: null, settled: false, resultLine: null });
  });

  describe('Viewer first (spec #2402)', () => {
    const m = matchup('live', {
      home: { ...side(10, 100, 120, 2), avatarUrl: 'h.png' },
      away: { ...side(20, 90, 110, 3), avatarUrl: 'a.png' },
    });
    // viewer Team id -> first Team id, origin of first, isViewer of first and second
    it.each([
      ['viewer is home', 10, 10, 'home', true, false],
      ['viewer is away', 20, 20, 'away', true, false],
      ['neutral reader (Team not in the Matchup)', 99, 10, 'home', false, false],
      ['no viewer', null, 10, 'home', false, false],
      ['viewer omitted', undefined, 10, 'home', false, false],
    ])('%s', (_name, viewer, firstId, origin, firstIsViewer, secondIsViewer) => {
      const board = matchupBoard(m, viewer);
      expect(board.first).toMatchObject({ teamId: firstId, origin, isViewer: firstIsViewer });
      expect(board.second.isViewer).toBe(secondIsViewer);
      expect(board.second.teamId).toBe(firstId === 10 ? 20 : 10);
      expect(board.first.name).toBe("Team " + firstId);
      expect(board.first.avatarUrl).toBe(firstId === 10 ? 'h.png' : 'a.png');
      expect(board.first.score).toBe(firstId === 10 ? 100 : 90);
      const { first, second } = board.winProbability;
      expect(first + second).toBeCloseTo(1);
      expect(first > 0.5).toBe(firstId === 10);
      expect(board.winProbability.first).toBe(matchupBoard(m, firstId).winProbability.first);
    });
    it('keys the projected win probability the same way before kickoff', () => {
      const pre = matchup('scheduled', { home: side(10, 0, 130, 9), away: side(20, 0, 100, 9) });
      expect(matchupBoard(pre, 10).projectedWinProbability.first).toBeGreaterThan(0.5);
      expect(matchupBoard(pre, 20).projectedWinProbability.first).toBeLessThan(0.5);
    });
    it('picks the side by Team id, never by name', () => {
      const same = matchup('live', { home: { ...side(10, 1, 1, 1), name: 'Same Name' }, away: { ...side(20, 1, 1, 1), name: 'Same Name' } });
      expect(matchupBoard(same, 20).first.origin).toBe('away');
    });
    it('does not match a missing Team id to a missing viewer', () => {
      const noId = matchup('live', { home: side(null, 1, 1, 1) });
      expect(matchupBoard(noId, null).first.isViewer).toBe(false);
      expect(matchupBoard(noId, undefined).first.isViewer).toBe(false);
    });
    it('no longer exposes home, away or viewerSide', () => {
      const board = matchupBoard(m, 20);
      expect(board).not.toHaveProperty('home');
      expect(board).not.toHaveProperty('away');
      expect(board).not.toHaveProperty('viewerSide');
    });
  });

  describe('scoreLabel (#2142)', () => {
    it('reads 0.0 on both sides for a scheduled Matchup with no score rows', () => {
      const board = matchupBoard(matchup('scheduled', { home: side(10, null, 120, 9), away: side(20, undefined, 110, 9) }), 10);
      expect(board.first.scoreLabel).toBe('0.0');
      expect(board.second.scoreLabel).toBe('0.0');
    });
    it('reads 0.0 for a score that is not a number, and one decimal otherwise', () => {
      const board = matchupBoard(matchup('live', { home: side(10, 'x', 1, 1), away: side(20, '87.46', 1, 1) }), 10);
      expect(board.first.scoreLabel).toBe('0.0');
      expect(board.second.scoreLabel).toBe('87.5');
    });
    it('has no label when there is no Matchup at all (a bye)', () => {
      const board = matchupBoard(null, 10);
      expect(board.first.scoreLabel).toBeNull();
      expect(board.second.scoreLabel).toBeNull();
    });
    it('leaves the raw score and the result line alone: a missing score is still no result', () => {
      const board = matchupBoard(matchup('final', { home: side(10, null, 1, 0) }), 10);
      expect(board.first.score).toBeNull();
      expect(board.resultLine).toBeNull();
    });
  });

  test('carries the server yetToPlay through beside playersRemaining, null when the server sent none', () => {
    const board = matchupBoard(matchup('live', { home: { ...side(10, 1, 1, 4), yetToPlay: 2 }, away: side(20, 1, 1, 3) }), 10);
    expect(board.first.yetToPlay).toBe(2);
    expect(board.second.yetToPlay).toBeNull();
  });

  describe('playersRemainingLabel (#2142)', () => {
    it('is the whole count, and null when the server did not say', () => {
      const board = matchupBoard(matchup('live', { home: side(10, 1, 1, 4), away: side(20, 1, 1, null) }), 10);
      expect(board.first.playersRemainingLabel).toBe('4');
      expect(board.second.playersRemainingLabel).toBeNull();
      expect(matchupBoard(matchup('live', { home: side(10, 1, 1, 0) }), 10).first.playersRemainingLabel).toBe('0');
      expect(matchupBoard(matchup('live', { home: side(10, 1, 1, '') }), 10).first.playersRemainingLabel).toBeNull();
    });
  });
});
