import { matchupFace } from './matchupFace';
import { matchupBoard } from './matchupBoard';
import { formatKickoff } from '../../../shared/lib/instantFormat';

// The canvas's live Sunday (the hero's fixture): the Dockworkers (home) ahead 82.2-77.0,
// projected to lose 110.5-123.9, four of theirs and six of the Frostbite's still to play.
const dock = { teamId: 10, name: 'Duluth Dockworkers', score: '82.2', expectedFinal: '110.5', playersRemaining: 4 };
const frost = { teamId: 20, name: 'Fargo Frostbite', score: '77.0', expectedFinal: '123.9', playersRemaining: 6 };
const KICKOFF = '2026-09-20T17:00:00.000Z';
const live = { id: 7, status: 'live', firstKickoffAt: KICKOFF, home: dock, away: frost };
const at = (status, over = {}) => ({ ...live, status, ...over });

describe('matchupFace: side order and the viewer', () => {
  it.each([
    ['viewer home', 10, 'home', true, 'away'],
    ['viewer away', 20, 'away', true, 'home'],
    ['non-participant', 99, 'home', false, 'away'],
    ['no viewer', null, 'home', false, 'away'],
  ])('%s', (_name, viewerTeamId, firstOrigin, firstIsViewer, secondOrigin) => {
    const { first, second } = matchupFace(live, { viewerTeamId });
    expect(first).toMatchObject({ origin: firstOrigin, isViewer: firstIsViewer });
    expect(second).toMatchObject({ origin: secondOrigin, isViewer: false });
  });

  it('keeps every board side field', () => {
    const board = matchupBoard(live, 20);
    const face = matchupFace(live, { viewerTeamId: 20 });
    expect(face.first).toMatchObject({ ...board.first, expectedFinal: board.first.expectedFinal });
    expect(face.second).toMatchObject({ ...board.second, expectedFinal: board.second.expectedFinal });
  });

  it('states the win probability and margins from the first side', () => {
    expect(matchupFace(live, { viewerTeamId: 10 }).game).toMatchObject({ firstPct: 36, secondPct: 64, leader: 'first', projectedLeader: 'second' });
    expect(matchupFace(live, { viewerTeamId: 20 }).game).toMatchObject({ firstPct: 64, secondPct: 36, leader: 'second', projectedLeader: 'first' });
  });
});

describe('matchupFace: status', () => {
  // status -> hasStarted, settled, chip label, winProbability?, projected?, sentence, kickoff?
  it.each([
    ['scheduled', false, false, 'Scheduled', false, true, null, true],
    ['live', true, false, 'LIVE', true, false, 'Ahead now, projected to trail by 13.4 · they have 6 players remaining', false],
    ['played', true, true, 'Awaiting final', true, false, 'Unofficial: You won by 5.2', false],
    ['final', true, true, 'Final', true, false, 'You won by 5.2', false],
    [null, null, false, null, false, false, null, false],
    ['postponed', null, false, null, false, false, null, false],
  ])('status %p', (status, hasStarted, settled, chipLabel, hasWin, hasProjected, sentence, hasKickoff) => {
    const { game } = matchupFace(at(status), { viewerTeamId: 10 });
    expect(game.hasStarted).toBe(hasStarted);
    expect(game.settled).toBe(settled);
    expect(game.chip?.label ?? null).toBe(chipLabel);
    expect(game.winProbability !== null).toBe(hasWin);
    expect(game.projectedWinProbability !== null).toBe(hasProjected);
    expect(game.sentence).toBe(sentence);
    expect(game.kickoffLabel).toBe(hasKickoff ? formatKickoff(KICKOFF) : null);
  });

  it('prints the score once started and the Proj before kickoff', () => {
    const liveFace = matchupFace(live, { viewerTeamId: 10 });
    expect([liveFace.first.figure, liveFace.second.figure]).toEqual(['82.2', '77.0']);
    expect(liveFace.game).toMatchObject({ scoreLeader: 'first', leader: 'first', scoreGap: 5.2, marginText: 'Duluth Dockworkers by 5.2' });
    const scheduled = matchupFace(at('scheduled'), { viewerTeamId: 10 });
    expect([scheduled.first.figure, scheduled.second.figure]).toEqual(['110.5', '123.9']);
    expect(scheduled.game).toMatchObject({
      leader: 'second',
      scoreGap: 13.4,
      marginText: 'Fargo Frostbite by 13.4',
      projectedMargin: 13.4,
      projectedMarginText: 'Projected margin · Fargo Frostbite by 13.4',
    });
  });

  it('a settled Matchup states its result and no Expected final figure', () => {
    const { first, second, game } = matchupFace(at('final'), { viewerTeamId: 20 });
    expect(game.resultLine).toBe('You lost by 5.2');
    expect(game.sentence).toBe('You lost by 5.2');
    expect([first.expectedFinal, first.expectedFinalLabel, second.expectedFinalLabel]).toEqual([null, null, null]);
    expect(game.projectedMargin).toBeNull();
  });

  it('a settled Matchup with no score states no result and no live sentence', () => {
    const { game } = matchupFace(at('final', { home: { ...dock, score: null } }), { viewerTeamId: 10 });
    expect(game.resultLine).toBeNull();
    expect(game.sentence).toBeNull();
  });

  it('an empty Matchup survives with no figures', () => {
    const { first, game } = matchupFace(null);
    expect(first).toMatchObject({ origin: 'home', scoreLabel: null, figure: null, record: null });
    expect(game).toMatchObject({ chip: null, hasStarted: null, firstPct: null, marginText: null, sentence: null });
  });
});

describe('matchupFace: ties and zeros', () => {
  it('a live tie: no score leader, Tied in words', () => {
    const { game } = matchupFace(at('live', { home: { ...dock, score: 80 }, away: { ...frost, score: '80.0' } }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ scoreLeader: null, leader: null, scoreGap: 0, marginText: 'Tied' });
    expect(game.sentence).toMatch(/^Tied now, projected to trail by 13\.4/);
  });

  it('a settled tie states Tied', () => {
    const { game } = matchupFace(at('final', { home: { ...dock, score: 80 }, away: { ...frost, score: 80 } }), { viewerTeamId: 10 });
    expect(game.sentence).toBe('Tied');
    expect(game.leader).toBeNull();
  });

  it('even projections read Even before kickoff', () => {
    const { game } = matchupFace(at('scheduled', { away: { ...frost, expectedFinal: 110.5 } }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ projectedLeader: null, projectedMargin: 0, projectedMarginText: 'Projected margin · Even', marginText: 'Tied' });
  });

  it('0-0 before kickoff: zero is a score, nobody leads it, the Proj is the figure', () => {
    const { first, game } = matchupFace(at('scheduled', { home: { ...dock, score: 0 }, away: { ...frost, score: 0 } }), { viewerTeamId: 10 });
    expect(first).toMatchObject({ score: 0, scoreLabel: '0.0', figure: '110.5' });
    expect(game.scoreLeader).toBeNull();
  });

  it('0-0 live: the figure is 0.0 and the margin is Tied', () => {
    const { first, game } = matchupFace(at('live', { home: { ...dock, score: 0 }, away: { ...frost, score: 0 } }), { viewerTeamId: 10 });
    expect(first.figure).toBe('0.0');
    expect(game).toMatchObject({ scoreLeader: null, marginText: 'Tied' });
  });

  it('a zero Expected final is a value, not unknown', () => {
    const { first, game } = matchupFace(at('scheduled', { home: { ...dock, expectedFinal: 0 } }), { viewerTeamId: 10 });
    expect(first.expectedFinalLabel).toBe('0.0');
    expect(game.priced).toBe(true);
  });
});

describe('matchupFace: missing Expected finals', () => {
  it.each([
    ['both', null, null],
    ['home', null, '123.9'],
    ['away', '110.5', ''],
  ])('live, %s missing: no win probability, the sentence drops the projection', (_name, homeFinal, awayFinal) => {
    const { game } = matchupFace(at('live', { home: { ...dock, expectedFinal: homeFinal }, away: { ...frost, expectedFinal: awayFinal } }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ priced: false, winProbability: null });
    expect(game.sentence).toBe('Ahead now · they have 6 players remaining');
  });

  it('scheduled, one missing: no projected win probability, no Proj figure, no margins', () => {
    const { first, game } = matchupFace(at('scheduled', { away: { ...frost, expectedFinal: undefined } }), { viewerTeamId: 10 });
    expect(game).toMatchObject({
      priced: false, projectedWinProbability: null, leader: null, marginText: null, projectedMargin: null, projectedMarginText: null,
    });
    expect(first.figure).toBe('110.5');
  });

  it('a half-tenth projection rounds the absolute gap, the same for both viewers', () => {
    const matchup = at('scheduled', { home: { ...dock, expectedFinal: 100 }, away: { ...frost, expectedFinal: 100.25 } });
    expect(matchupFace(matchup, { viewerTeamId: 10 }).game.projectedMargin).toBe(0.3);
    expect(matchupFace(matchup, { viewerTeamId: 20 }).game.projectedMargin).toBe(0.3);
  });

  it('a projection under a tenth reads Even in the margin and the sentence', () => {
    const matchup = at('live', { home: { ...dock, expectedFinal: 100.01 }, away: { ...frost, expectedFinal: 100 } });
    const { game } = matchupFace(matchup, { viewerTeamId: 10 });
    expect(game.projectedMargin).toBe(0);
    expect(game.projectedLeader).toBeNull();
    expect(game.sentence).toMatch(/projected to finish even/);
  });
});

describe('matchupFace: counts', () => {
  it('reads the server counts, opponent first, with yetToPlay', () => {
    const { game } = matchupFace(at('live', { away: { ...frost, yetToPlay: 3 } }), { viewerTeamId: 10 });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4 · they have 6 players remaining, 3 yet to play');
  });

  it('with none of theirs left it names the viewer own players, singular for one', () => {
    const { game } = matchupFace(at('live', { home: { ...dock, playersRemaining: 1, yetToPlay: 1 }, away: { ...frost, playersRemaining: 0 } }), { viewerTeamId: 10 });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4 · you have 1 player remaining, 1 yet to play');
  });

  it('counts override the board counts for the sentence alone, never mixed', () => {
    const counts = { first: { remaining: 2, yet: 0 }, second: { remaining: 5, yet: 2 } };
    const { first, second, game } = matchupFace(at('live', { away: { ...frost, yetToPlay: 9 } }), { viewerTeamId: 10, counts });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4 · they have 5 players remaining, 2 yet to play');
    expect([first.remainingText, second.remainingText]).toEqual(['4 players remaining', '6 players remaining']);
  });

  it('counts are keyed first/second in the face order: an away viewer is counts.first', () => {
    const counts = { first: { remaining: 3, yet: 1 }, second: { remaining: 0, yet: 0 } };
    const { first, game } = matchupFace(live, { viewerTeamId: 20, counts });
    expect(first.teamId).toBe(20);
    expect(game.sentence).toBe('Behind now, projected to lead by 13.4 · you have 3 players remaining, 1 yet to play');
  });

  it('countsPending holds the remaining clause back', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, countsPending: true, counts: { first: { remaining: 2 }, second: { remaining: 5 } } });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4');
  });

  it('prints the per-side count line, null when unknown', () => {
    const { first, second } = matchupFace(at('scheduled', { home: { ...dock, playersRemaining: 1 }, away: { ...frost, playersRemaining: null } }));
    expect(first).toMatchObject({ remainingText: '1 player remaining' });
    expect(second).toMatchObject({ remainingText: null });
  });
});

describe('matchupFace: page lookups', () => {
  it.each([
    ['object', { 10: '2-0', 20: '1-1' }, '2-0', '1-1'],
    ['function', (teamId) => (teamId === 10 ? '3-0' : null), '3-0', null],
    ['empty object', {}, null, null],
    ['none', null, null, null],
  ])('records by %s', (_name, records, home, away) => {
    const { first, second } = matchupFace(live, { records });
    expect([first.record, second.record]).toEqual([home, away]);
  });
});

describe('matchupFace: raw margin', () => {
  it('reads the raw-score words for the compact bar', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10 });
    expect(game).toMatchObject({ scoreLeader: 'first', rawMarginText: 'Duluth Dockworkers by 5.2' });
  });

  it('a raw tie reads Tied', () => {
    const { game } = matchupFace(at('live', { home: { ...dock, score: 80 }, away: { ...frost, score: 80 } }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ scoreLeader: null, rawMarginText: 'Tied' });
  });

  it('a missing raw score has no raw margin', () => {
    const { game } = matchupFace(at('live', { home: { ...dock, score: null } }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ scoreLeader: null, rawMarginText: null });
  });
});

describe('matchupFace: server win probability', () => {
  it('wins over the board share when priced', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, serverWinProbability: 0.8 });
    expect(game).toMatchObject({ firstShare: 0.8, firstPct: 80, secondPct: 20 });
    expect(game.winProbability).toEqual({ firstShare: 0.8, firstPct: 80, secondPct: 20 });
  });

  it('is clamped, and a non-number falls back to the board share', () => {
    expect(matchupFace(live, { serverWinProbability: 1.4 }).game.firstPct).toBe(100);
    expect(matchupFace(live, { viewerTeamId: 10, serverWinProbability: '' }).game.firstPct).toBe(36);
  });

  it('never invents a win probability when the Matchup is not priced', () => {
    const unpriced = at('live', { home: { ...dock, expectedFinal: null } });
    const { game } = matchupFace(unpriced, { serverWinProbability: 0.8 });
    expect(game).toMatchObject({ priced: false, winProbability: null, firstPct: 80 });
  });

  it('without a server figure an unpriced share is still the board one; an unknown status has none', () => {
    const unpriced = at('live', { home: { ...dock, expectedFinal: null } });
    expect(matchupFace(unpriced).game.firstPct).toBe(Math.round(matchupBoard(unpriced).winProbability.first * 100));
    expect(matchupFace(at(null)).game).toMatchObject({ firstShare: null, firstPct: null, secondPct: null });
  });
});
