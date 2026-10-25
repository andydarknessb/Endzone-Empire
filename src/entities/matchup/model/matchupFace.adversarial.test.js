import { matchupFace } from './matchupFace';
import { matchupBoard } from './matchupBoard';
import { formatKickoff } from '../../../shared/lib/instantFormat';

// Adversarial QA for the Matchup face (contract: E:/tmp/matchup-face-contract.md). Each `it` asserts
// the contract's stated outcome. A title starting `QUESTION:` is a case the contract is silent or
// ambiguous on: it pins today's output so the lead can rule on it, and is not a failure claim.

const dock = { teamId: 10, name: 'Duluth Dockworkers', score: '82.2', expectedFinal: '110.5', playersRemaining: 4 };
const frost = { teamId: 20, name: 'Fargo Frostbite', score: '77.0', expectedFinal: '123.9', playersRemaining: 6 };
const KICKOFF = '2026-09-20T17:00:00.000Z';
const live = { id: 7, status: 'live', firstKickoffAt: KICKOFF, home: dock, away: frost };
const at = (status, home = {}, away = {}, over = {}) => ({
  ...live, status, home: { ...dock, ...home }, away: { ...frost, ...away }, ...over,
});
const LIVE_SENTENCE = 'Ahead now, projected to trail by 13.4 · they have 6 players remaining';

describe('adversarial: the viewer', () => {
  it('an away viewer leads every first-side figure', () => {
    const { first, second, game } = matchupFace(live, { viewerTeamId: 20 });
    expect(first).toMatchObject({ teamId: 20, origin: 'away', isViewer: true, scoreLabel: '77.0', figure: '77.0' });
    expect(second).toMatchObject({ teamId: 10, origin: 'home', isViewer: false });
    expect(game).toMatchObject({ firstPct: 64, secondPct: 36, scoreLeader: 'second', leader: 'second', marginText: 'Duluth Dockworkers by 5.2' });
    expect(game.sentence).toBe('Behind now, projected to lead by 13.4 · they have 4 players remaining');
  });

  it.each([
    ['a non-participant', { viewerTeamId: 99 }],
    ['no viewer', { viewerTeamId: null }],
    ['an empty options object', {}],
    ['no options at all', undefined],
  ])('%s reads home first, neither side the viewer', (_name, options) => {
    const { first, second, game } = matchupFace(live, options);
    expect([first.origin, first.isViewer, second.isViewer]).toEqual(['home', false, false]);
    expect(game).toMatchObject({ firstPct: 36, leader: 'first', marginText: 'Duluth Dockworkers by 5.2' });
    expect(game.sentence).toBe(LIVE_SENTENCE);
  });

  it('a non-participant reads a settled result in third person', () => {
    expect(matchupFace(at('final'), { viewerTeamId: 99 }).game.sentence).toBe('Duluth Dockworkers won by 5.2');
  });

  it('a Team id of 0 is a value: viewer 0 on the away side is first', () => {
    const { first } = matchupFace(at('live', {}, { teamId: 0 }), { viewerTeamId: 0 });
    expect(first).toMatchObject({ teamId: 0, origin: 'away', isViewer: true });
  });

  it('QUESTION: a string viewer id never matches a number Team id (strict, today home first)', () => {
    const { first, second } = matchupFace(live, { viewerTeamId: '20' });
    expect([first.origin, first.isViewer, second.isViewer]).toEqual(['home', false, false]);
  });
});

describe('adversarial: scores', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ["''", ''],
    ['NaN', NaN],
    ["'abc'", 'abc'],
  ])('live, home score %s: a 0.0 label, no raw leader, the big figure is 0.0', (_name, score) => {
    const { first, game } = matchupFace(at('live', { score }), { viewerTeamId: 10 });
    expect(first).toMatchObject({ scoreLabel: '0.0', figure: '0.0' });
    expect(game.scoreLeader).toBeNull();
    expect(game).toMatchObject({ leader: 'second', scoreGap: 77, marginText: 'Fargo Frostbite by 77.0' });
    expect(game.sentence).toMatch(/^Behind now/);
  });

  it('live, home score 0: zero is a score, the raw leader is away', () => {
    const { first, game } = matchupFace(at('live', { score: 0 }), { viewerTeamId: 10 });
    expect(first).toMatchObject({ score: 0, scoreLabel: '0.0' });
    expect(game).toMatchObject({ scoreLeader: 'second', leader: 'second' });
  });

  it('a raw-score lead that prints as a tie: scoreLeader is raw, leader and marginText are the printed figure', () => {
    const { first, second, game } = matchupFace(at('live', { score: 100.04 }, { score: 99.96 }), { viewerTeamId: 10 });
    expect([first.figure, second.figure]).toEqual(['100.0', '100.0']);
    expect(game).toMatchObject({ scoreLeader: 'first', leader: null, scoreGap: 0, marginText: 'Tied' });
    // The hero's existing wording rounds the raw lead to a tenth: 0.08 is 0.1, "Ahead now".
    expect(game.sentence).toMatch(/^Ahead now/);
  });

  it('a settled raw-score win that prints as a tie: the result line names the win, the margin reads Tied', () => {
    const { game } = matchupFace(at('final', { score: 100.04 }, { score: 99.96 }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ resultLine: 'You won by 0.08', sentence: 'You won by 0.08', scoreLeader: 'first', leader: null, marginText: 'Tied' });
  });

  it('the Home tile basis: the big-figure gap is the printed labels, not the raw scores', () => {
    // 87.44 - 71.16 is 16.28 raw (16.3); the printed 87.4 - 71.2 is 16.2.
    expect(matchupFace(at('live', { score: 87.44 }, { score: 71.16 })).game).toMatchObject({ leader: 'first', scoreGap: 16.2 });
    // 82.24 v 82.16 prints 82.2 v 82.2.
    expect(matchupFace(at('live', { score: 82.24 }, { score: 82.16 })).game).toMatchObject({ scoreLeader: 'first', leader: null, marginText: 'Tied' });
  });
});

describe('adversarial: Expected finals', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ["''", ''],
    ['NaN', NaN],
    ["'n/a'", 'n/a'],
  ])('scheduled, home Expected final %s: not priced, no Proj figure, no margins', (_name, expectedFinal) => {
    const { first, game } = matchupFace(at('scheduled', { expectedFinal }), { viewerTeamId: 10 });
    expect(first).toMatchObject({ expectedFinalLabel: null, figure: null, figureLabel: 'Proj' });
    expect(game).toMatchObject({
      priced: false, projectedWinProbability: null, winProbability: null,
      leader: null, scoreGap: null, marginText: null,
      projectedLeader: null, projectedMargin: null, projectedMarginText: null,
      kickoffLabel: formatKickoff(KICKOFF),
    });
  });

  it.each([
    ['null', null],
    ["''", ''],
    ['NaN', NaN],
  ])('live, away Expected final %s: no win probability, the sentence drops the projection', (_name, expectedFinal) => {
    const { game } = matchupFace(at('live', {}, { expectedFinal }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ priced: false, winProbability: null, projectedLeader: null, projectedMargin: null });
    expect(game.sentence).toBe('Ahead now · they have 6 players remaining');
  });

  it('a zero Expected final is a value on both sides: priced, Even, 0.0', () => {
    const { first, second, game } = matchupFace(at('scheduled', { expectedFinal: 0, score: 0 }, { expectedFinal: '0', score: 0 }), { viewerTeamId: 10 });
    expect([first.expectedFinalLabel, second.expectedFinalLabel, first.figure]).toEqual(['0.0', '0.0', '0.0']);
    expect(game).toMatchObject({ priced: true, projectedMargin: 0, projectedMarginText: 'Projected margin · Even', marginText: 'Tied' });
    expect(game.projectedWinProbability).toMatchObject({ firstPct: 50, secondPct: 50 });
  });

  it('CONTRACT: projectedMargin is the abs Expected-final gap to one decimal, the same number whichever side is first', () => {
    // 100.25 - 100 is exactly 0.25: one decimal of the abs gap is 0.3 (the hero's existing tenth(abs)).
    const matchup = at('scheduled', { expectedFinal: 100 }, { expectedFinal: 100.25 });
    const home = matchupFace(matchup, { viewerTeamId: 10 }).game;
    const away = matchupFace(matchup, { viewerTeamId: 20 }).game;
    expect(away.projectedMargin).toBe(0.3);
    expect(home.projectedMargin).toBe(away.projectedMargin);
    expect(home.projectedMarginText).toBe(away.projectedMarginText);
  });

  it('CONTRACT: the same viewer is not told two margins for one pair of Expected finals before kickoff', () => {
    const { first, second, game } = matchupFace(at('scheduled', { expectedFinal: 110.5 }, { expectedFinal: 120.75 }), { viewerTeamId: 10 });
    expect([first.figure, second.figure]).toEqual(['110.5', '120.8']);
    expect(game.marginText).toBe('Fargo Frostbite by 10.3');
    expect(game.projectedMarginText).toBe('Projected margin · Fargo Frostbite by 10.3');
  });
});

describe('adversarial: settled Matchups', () => {
  it.each([
    ['played', 'Unofficial: You won by 5.2'],
    ['final', 'You won by 5.2'],
  ])('%s with the raw Expected finals still present: the result line, no Expected final, priced from the raw sides', (status, resultLine) => {
    const { first, second, game } = matchupFace(at(status), { viewerTeamId: 10, expectedFinalFor: () => 120 });
    expect([first.expectedFinal, first.expectedFinalLabel, second.expectedFinal, second.expectedFinalLabel]).toEqual([null, null, null, null]);
    expect([first.figure, first.figureLabel]).toEqual(['82.2', 'Final score']);
    expect(game).toMatchObject({
      settled: true, priced: true, resultLine, sentence: resultLine, kickoffLabel: null,
      projectedLeader: null, projectedMargin: null, projectedMarginText: null,
    });
    // Started and priced: the settled share is the scores' (a win is 100).
    expect(game.winProbability).toEqual({ firstShare: 1, firstPct: 100, secondPct: 0 });
  });

  it('final with one score missing: no result line, no sentence, no raw leader', () => {
    const { first, game } = matchupFace(at('final', { score: null }), { viewerTeamId: 10 });
    expect(first.scoreLabel).toBe('0.0');
    expect(game).toMatchObject({ resultLine: null, sentence: null, scoreLeader: null });
  });

  it('QUESTION: final with one score missing still states a margin and a leader from the 0.0 placeholder', () => {
    const { game } = matchupFace(at('final', { score: null }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ leader: 'second', scoreGap: 77, marginText: 'Fargo Frostbite by 77.0' });
  });

  it('QUESTION: final with one score missing: the strip policy (resultLine == null && firstShare != null) still draws a bar', () => {
    const { game } = matchupFace(at('final', { score: null }), { viewerTeamId: 10 });
    expect(game.resultLine == null && game.firstShare != null).toBe(true);
    expect(game.firstShare).toBe(0);
  });

  it('final with both scores missing: no result, no sentence', () => {
    const { game } = matchupFace(at('final', { score: null }, { score: undefined }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ resultLine: null, sentence: null, scoreLeader: null });
  });

  it('QUESTION: final: true with status null is isFinal but not settled: the Proj figures still show', () => {
    const { first, game } = matchupFace(at(null, {}, {}, { final: true }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ isFinal: true, settled: false, hasStarted: null, chip: null, resultLine: null, sentence: null, kickoffLabel: null });
    expect(first).toMatchObject({ figureLabel: 'Proj', expectedFinalLabel: '110.5', figure: '110.5' });
  });
});

describe('adversarial: counts', () => {
  it('counts with no first key: the sentence reads the opponent count, no throw', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, counts: { second: { remaining: 5, yet: 2 } } });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4 · they have 5 players remaining, 2 yet to play');
  });

  it('counts with no second key replace the wire counts whole: none of theirs, so the viewer own is named', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, counts: { first: { remaining: 2, yet: 1 } } });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4 · you have 2 players remaining, 1 yet to play');
  });

  it('empty counts: no remaining clause, never the wire counts', () => {
    expect(matchupFace(live, { viewerTeamId: 10, counts: {} }).game.sentence).toBe('Ahead now, projected to trail by 13.4');
  });

  it('countsPending with a missing key: no remaining clause', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, countsPending: true, counts: { second: { remaining: 5 } } });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4');
  });

  it('countsPending with no counts: no remaining clause', () => {
    expect(matchupFace(live, { viewerTeamId: 10, countsPending: true }).game.sentence).toBe('Ahead now, projected to trail by 13.4');
  });

  it('counts as strings are read as numbers', () => {
    const counts = { first: { remaining: '2', yet: '1' }, second: { remaining: '5', yet: '3' } };
    expect(matchupFace(live, { viewerTeamId: 10, counts }).game.sentence)
      .toBe('Ahead now, projected to trail by 13.4 · they have 5 players remaining, 3 yet to play');
  });

  it('a non-number count is unknown, so the other side is named', () => {
    const counts = { first: { remaining: 3 }, second: { remaining: 'abc', yet: 2 } };
    expect(matchupFace(live, { viewerTeamId: 10, counts }).game.sentence)
      .toBe('Ahead now, projected to trail by 13.4 · you have 3 players remaining');
  });

  it('the hero counts never reach a settled or scheduled sentence, nor the side lines', () => {
    const counts = { first: { remaining: 2, yet: 1 }, second: { remaining: 5, yet: 2 } };
    expect(matchupFace(at('final'), { viewerTeamId: 10, counts }).game.sentence).toBe('You won by 5.2');
    expect(matchupFace(at('scheduled'), { viewerTeamId: 10, counts }).game.sentence).toBeNull();
    const { first, second } = matchupFace(live, { viewerTeamId: 10, counts });
    expect([first.remainingText, second.remainingText]).toEqual(['4 players remaining', '6 players remaining']);
  });

  it('per-side lines at 0 and 1 are values, not unknown', () => {
    const { first, second } = matchupFace(at('live', { playersRemaining: 0 }, { playersRemaining: '1' }));
    expect([first.remainingText, first.setToPlayText]).toEqual(['0 players remaining', '0 starters set to play']);
    expect([second.remainingText, second.setToPlayText]).toEqual(['1 player remaining', '1 starter set to play']);
  });
});

describe('adversarial: page lookups', () => {
  it.each([
    ['an object hit', { 10: '2-0' }, '2-0'],
    ['an object keyed by string', { '10': '2-0' }, '2-0'],
    ['a function hit', () => '4-1', '4-1'],
    ['an object miss', { 30: '2-0' }, null],
    ['a function miss (undefined)', () => undefined, null],
    ["an empty-string record", { 10: '' }, null],
    ["a function returning ''", () => '', null],
    ['a number record', { 10: 0 }, '0'],
    ['no lookup', null, null],
  ])('records: %s', (_name, records, expected) => {
    expect(matchupFace(live, { records }).first.record).toBe(expected);
  });

  it('a side with no Team id has no record, rank or CPU flag, whatever the lookups hold', () => {
    const { first } = matchupFace(at('live', { teamId: null }), { records: () => '9-9', ranks: () => 1, cpuTeamIds: [null] });
    expect(first).toMatchObject({ record: null, rank: null, rankLabel: null, isCpu: false });
  });

  it.each([
    [1, 1, '1st in league'],
    [2, 2, '2nd in league'],
    [3, 3, '3rd in league'],
    [11, 11, '11th in league'],
    [12, 12, '12th in league'],
    [13, 13, '13th in league'],
    [21, 21, '21st in league'],
    ['3', 3, '3rd in league'],
    [0, 0, null],
    [-1, -1, null],
    ['abc', null, null],
    ['', null, null],
  ])('rank %p is %p, %p', (raw, rank, rankLabel) => {
    expect(matchupFace(live, { ranks: { 10: raw } }).first).toMatchObject({ rank, rankLabel });
  });

  it.each([
    ['a Set', new Set([20]), true],
    ['an array', [20], true],
    ['an empty Set', new Set(), false],
    ['null', null, false],
  ])('CPU ids as %s', (_name, cpuTeamIds, expected) => {
    expect(matchupFace(live, { viewerTeamId: 10, cpuTeamIds }).second.isCpu).toBe(expected);
  });

  it.each([
    ['a Set of string ids', new Set(['20'])],
    ['an array of string ids', ['20']],
    ['a bare string id', '20'],
    ['a bare number id', 20],
  ])('QUESTION: CPU ids as %s do not match the number Team id 20 (today false)', (_name, cpuTeamIds) => {
    expect(matchupFace(live, { viewerTeamId: 10, cpuTeamIds }).second.isCpu).toBe(false);
  });
});

describe('adversarial: server win probability', () => {
  it.each([
    ['0', 0, 0, 0, 100],
    ['1', 1, 1, 100, 0],
    ['1.4 (clamped)', 1.4, 1, 100, 0],
    ['-0.2 (clamped)', -0.2, 0, 0, 100],
    ["'0.73'", '0.73', 0.73, 73, 27],
  ])('live and priced, server %s wins', (_name, serverWinProbability, firstShare, firstPct, secondPct) => {
    const { game } = matchupFace(live, { viewerTeamId: 10, serverWinProbability });
    expect(game).toMatchObject({ firstShare, firstPct, secondPct });
    expect(game.winProbability).toEqual({ firstShare, firstPct, secondPct });
  });

  it.each([
    ["''", ''],
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ["'abc'", 'abc'],
  ])('live and priced, server %s falls back to the board share', (_name, serverWinProbability) => {
    const board = Math.round(matchupBoard(live, 10).winProbability.first * 100);
    expect(matchupFace(live, { viewerTeamId: 10, serverWinProbability }).game).toMatchObject({ firstPct: board, secondPct: 100 - board });
  });

  it('server 0 is a value: a 0% split, not a fallback, not null', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, serverWinProbability: 0 });
    expect(game.firstPct).toBe(0);
    expect(game.firstPct == null).toBe(false);
  });

  it('live, no Expected finals: the server figure is the share, never a priced win probability', () => {
    const unpriced = at('live', { expectedFinal: null }, { expectedFinal: null });
    expect(matchupFace(unpriced, { serverWinProbability: 0.8 }).game).toMatchObject({ priced: false, winProbability: null, projectedWinProbability: null, firstPct: 80 });
    expect(matchupFace(unpriced, { serverWinProbability: 0 }).game).toMatchObject({ winProbability: null, firstPct: 0 });
  });

  it('scheduled and priced: the server figure is the projected win probability', () => {
    const { game } = matchupFace(at('scheduled'), { viewerTeamId: 10, serverWinProbability: 0.8 });
    expect(game.projectedWinProbability).toEqual({ firstShare: 0.8, firstPct: 80, secondPct: 20 });
    expect(game.winProbability).toBeNull();
  });

  it('scheduled, one Expected final missing: no projected win probability even with a server figure', () => {
    const { game } = matchupFace(at('scheduled', {}, { expectedFinal: null }), { serverWinProbability: 0.8 });
    expect(game).toMatchObject({ priced: false, projectedWinProbability: null, firstPct: 80 });
  });

  it('QUESTION: an unknown status with a server figure states a share but no bar', () => {
    const { game } = matchupFace(at(null), { serverWinProbability: 0.8 });
    expect(game).toMatchObject({ hasStarted: null, winProbability: null, projectedWinProbability: null, firstPct: 80 });
  });

  it('QUESTION: a settled win with a server figure of 0.3 states 30%, over the scores 100', () => {
    const { game } = matchupFace(at('final'), { viewerTeamId: 10, serverWinProbability: 0.3 });
    expect(game.winProbability).toEqual({ firstShare: 0.3, firstPct: 30, secondPct: 70 });
  });

  it('the two percents always sum to 100', () => {
    [0.004, 0.005, 0.125, 0.335, 0.5, 0.665, 0.995].forEach((share) => {
      const { game } = matchupFace(live, { serverWinProbability: share });
      expect(game.firstPct + game.secondPct).toBe(100);
    });
  });
});

describe('adversarial: names', () => {
  const long = 'The Extraordinarily Long Named Fantasy Football Franchise Of Duluth';

  it('a long name is carried whole in both margin texts', () => {
    expect(matchupFace(at('live', { name: long })).game.marginText).toBe(`${long} by 5.2`);
    expect(matchupFace(at('scheduled', { expectedFinal: 130, name: long })).game.projectedMarginText).toBe(`Projected margin · ${long} by 6.1`);
  });

  it.each([
    ['null', null],
    ["''", ''],
    ['undefined', undefined],
  ])('a %s name falls back to Home / Away in the margin texts', (_name, name) => {
    expect(matchupFace(at('live', { name }, { name })).game.marginText).toBe('Home by 5.2');
    expect(matchupFace(at('live', { name, score: 70 }, { name })).game.marginText).toBe('Away by 7.0');
    expect(matchupFace(at('scheduled', { name }, { name })).game.projectedMarginText).toBe('Projected margin · Away by 13.4');
  });

  it('the face side keeps the raw name; the fallback is the margin text alone', () => {
    const { first, second } = matchupFace(at('live', { name: null }, { name: '' }));
    expect([first.name, second.name]).toEqual([null, '']);
  });

  it('QUESTION: a whitespace-only name is kept, so the margin reads "   by 5.2"', () => {
    expect(matchupFace(at('live', { name: '   ' })).game.marginText).toBe('    by 5.2');
  });
});

describe('adversarial: empty Matchups', () => {
  it('an empty object: 0.0 labels, no figure, no claim', () => {
    const { first, second, game } = matchupFace({});
    expect([first.scoreLabel, second.scoreLabel, first.figure]).toEqual(['0.0', '0.0', null]);
    expect(game).toMatchObject({
      chip: null, hasStarted: null, settled: false, priced: false, winProbability: null, projectedWinProbability: null,
      firstShare: null, firstPct: null, scoreLeader: null, leader: null, marginText: null, sentence: null, resultLine: null, kickoffLabel: null,
    });
  });

  it.each([['null', null], ['undefined', undefined]])('%s: null labels (the board distinction from {})', (_name, matchup) => {
    const { first, game } = matchupFace(matchup);
    expect([first.scoreLabel, first.figure, first.figureLabel]).toEqual([null, null, 'Proj']);
    expect(game.marginText).toBeNull();
  });

  it.each([
    ['empty sides', { status: 'live', home: {}, away: {} }],
    ['no sides', { status: 'live' }],
  ])('live with %s: Tied on 0.0, no price, a 50/50 share, no counts', (_name, matchup) => {
    const { first, game } = matchupFace(matchup);
    expect([first.scoreLabel, first.figure, first.remainingText, first.record, first.isCpu]).toEqual(['0.0', '0.0', null, null, false]);
    expect(game).toMatchObject({ scoreLeader: null, leader: null, marginText: 'Tied', priced: false, winProbability: null, firstPct: 50 });
    expect(game.sentence).toBe('Tied now');
  });

  it('QUESTION: an unknown status states a margin from the Expected finals (the strip today), no projected caption', () => {
    const { first, game } = matchupFace(at('postponed'), { viewerTeamId: 10 });
    expect(first).toMatchObject({ figure: '110.5', figureLabel: 'Proj' });
    expect(game).toMatchObject({ leader: 'second', marginText: 'Fargo Frostbite by 13.4', projectedMarginText: null, projectedMargin: 13.4, kickoffLabel: null });
  });
});

describe('adversarial: caller seams', () => {
  it('the preview without expectedFinalFor reads the board Expected finals', () => {
    const scheduled = matchupFace(at('scheduled'), { viewerTeamId: 20 });
    expect([scheduled.first.expectedFinal, scheduled.first.expectedFinalLabel]).toEqual(['123.9', '123.9']);
    const liveFace = matchupFace(live, { viewerTeamId: 20 });
    expect(liveFace.first.expectedFinalLabel).toBe('123.9');
    expect(matchupFace(at('final'), { viewerTeamId: 20 }).first.expectedFinal).toBeNull();
  });

  it.each([
    ['undefined', undefined, null, null],
    ['null', null, null, null],
    ['0', 0, 0, '0.0'],
    ["'98.25'", '98.25', '98.25', '98.3'],
  ])('expectedFinalFor returning %s', (_name, value, expectedFinal, expectedFinalLabel) => {
    const { first } = matchupFace(at('scheduled'), { viewerTeamId: 10, expectedFinalFor: () => value });
    expect(first).toMatchObject({ expectedFinal, expectedFinalLabel });
  });

  it('QUESTION: expectedFinalFor returning null while the raw sides price: a projected bar with no margin caption', () => {
    const { game } = matchupFace(at('scheduled'), { viewerTeamId: 10, expectedFinalFor: () => null });
    expect(game).toMatchObject({ priced: true, projectedLeader: null, projectedMarginText: null, marginText: null });
    expect(game.projectedWinProbability).not.toBeNull();
  });

  it('the strip missing-final bar: the board figure still draws, the priced objects stay null', () => {
    const scheduled = at('scheduled', {}, { expectedFinal: null });
    const s = matchupFace(scheduled, { viewerTeamId: 10 }).game;
    expect(s.resultLine == null && s.firstShare != null).toBe(true);
    expect(s.firstShare).toBeCloseTo(matchupBoard(scheduled, 10).projectedWinProbability.first, 10);
    expect(s.projectedWinProbability).toBeNull();
    const liveUnpriced = at('live', { expectedFinal: null });
    const l = matchupFace(liveUnpriced, { viewerTeamId: 10 }).game;
    expect(l.resultLine == null && l.firstShare != null).toBe(true);
    expect(l.firstShare).toBeCloseTo(matchupBoard(liveUnpriced, 10).winProbability.first, 10);
    expect(l.winProbability).toBeNull();
    const final = matchupFace(at('final'), { viewerTeamId: 10 }).game;
    expect(final.resultLine == null && final.firstShare != null).toBe(false);
    expect(matchupFace(at(null)).game.firstShare).toBeNull();
  });

  it.each([
    ['scheduled, no kickoff', at('scheduled', {}, {}, { firstKickoffAt: null }), null],
    ['scheduled, a bad kickoff', at('scheduled', {}, {}, { firstKickoffAt: 'soon' }), null],
    ['live with a kickoff', live, null],
    ['final with a kickoff', at('final'), null],
    ['unknown with a kickoff', at(null), null],
  ])('kickoffLabel: %s', (_name, matchup, expected) => {
    expect(matchupFace(matchup).game.kickoffLabel).toBe(expected);
  });
});
