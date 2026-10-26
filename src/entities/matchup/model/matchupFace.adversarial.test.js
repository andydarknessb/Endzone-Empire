import { matchupFace } from './matchupFace';

// Independent adversarial cover for the Matchup face (#2514): each case pins an
// edge the table test does not name, through the public `matchupFace` interface.
// A title starting `QUESTION:` records today's answer where the issue is silent.

const dock = { teamId: 10, name: 'Duluth Dockworkers', score: '82.2', expectedFinal: '110.5', playersRemaining: 4 };
const frost = { teamId: 20, name: 'Fargo Frostbite', score: '77.0', expectedFinal: '123.9', playersRemaining: 6 };
const KICKOFF = '2026-09-20T17:00:00.000Z';
const live = { id: 7, status: 'live', firstKickoffAt: KICKOFF, home: dock, away: frost };
const at = (status, home = {}, away = {}, over = {}) => ({
  ...live, status, home: { ...dock, ...home }, away: { ...frost, ...away }, ...over,
});
const LIVE_SENTENCE = 'Ahead now, projected to trail by 13.4 · they have 6 players remaining';

describe('adversarial: the viewer is the Team id', () => {
  it('a Team id of 0 is a value: viewer 0 on the away side comes first', () => {
    const { first } = matchupFace(at('live', {}, { teamId: 0 }), { viewerTeamId: 0 });
    expect(first).toMatchObject({ teamId: 0, origin: 'away', isViewer: true });
  });

  it('a string viewer id never matches a numeric Team id', () => {
    const { first, second } = matchupFace(live, { viewerTeamId: '20' });
    expect([first.origin, first.isViewer, second.isViewer]).toEqual(['home', false, false]);
  });

  it.each([
    ['a non-participant', { viewerTeamId: 99 }],
    ['no viewer', { viewerTeamId: null }],
    ['an empty options object', {}],
    ['no options at all', undefined],
  ])('%s reads home first and neither side the viewer', (_name, options) => {
    const { first, second, game } = matchupFace(live, options);
    expect([first.origin, first.isViewer, second.isViewer]).toEqual(['home', false, false]);
    expect(game.sentence).toBe(LIVE_SENTENCE);
  });

  it('a non-participant reads a settled result in the third person', () => {
    expect(matchupFace(at('final'), { viewerTeamId: 99 }).game.sentence).toBe('Duluth Dockworkers won by 5.2');
  });
});

describe('adversarial: raw scores and printed figures', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ["''", ''],
    ['NaN', NaN],
    ["'abc'", 'abc'],
  ])('live, home score %s: a 0.0 label, no raw leader, the big figure is 0.0', (_name, score) => {
    const { first, game } = matchupFace(at('live', { score }), { viewerTeamId: 10 });
    expect(first).toMatchObject({ scoreLabel: '0.0', figure: '0.0' });
    expect(game).toMatchObject({
      scoreLeader: null, rawMarginText: null, leader: 'second', scoreGap: 77, marginText: 'Fargo Frostbite by 77.0',
    });
    expect(game.sentence).toMatch(/^Behind now/);
  });

  it('a raw lead that prints as a tie: scoreLeader is raw, leader and marginText are the printed figure', () => {
    const { first, second, game } = matchupFace(at('live', { score: 100.04 }, { score: 99.96 }), { viewerTeamId: 10 });
    expect([first.figure, second.figure]).toEqual(['100.0', '100.0']);
    expect(game).toMatchObject({ scoreLeader: 'first', leader: null, scoreGap: 0, marginText: 'Tied' });
    expect(game.sentence).toMatch(/^Ahead now/);
  });

  it('a settled raw-score win that prints as a tie states the raw result line', () => {
    const { game } = matchupFace(at('final', { score: 100.04 }, { score: 99.96 }), { viewerTeamId: 10 });
    expect(game).toMatchObject({
      resultLine: 'You won by 0.08', sentence: 'You won by 0.08', scoreLeader: 'first', leader: null, marginText: 'Tied',
    });
  });

  it('the big-figure gap is the printed labels, not the raw scores', () => {
    expect(matchupFace(at('live', { score: 87.44 }, { score: 71.16 })).game).toMatchObject({ leader: 'first', scoreGap: 16.2 });
    expect(matchupFace(at('live', { score: 82.24 }, { score: 82.16 })).game).toMatchObject({
      scoreLeader: 'first', leader: null, marginText: 'Tied',
    });
  });
});

describe('adversarial: projections', () => {
  it('a half-tenth gap rounds the absolute gap the same for both viewers', () => {
    const matchup = at('scheduled', { expectedFinal: 100 }, { expectedFinal: 100.25 });
    const home = matchupFace(matchup, { viewerTeamId: 10 }).game;
    const away = matchupFace(matchup, { viewerTeamId: 20 }).game;
    expect(home.projectedMargin).toBe(0.3);
    expect(away.projectedMargin).toBe(0.3);
    expect(home.projectedMarginText).toBe(away.projectedMarginText);
  });

  it('a projection under a tenth reads Even in the margin and the sentence', () => {
    const { game } = matchupFace(at('live', { expectedFinal: 100.01 }, { expectedFinal: 100 }), { viewerTeamId: 10 });
    expect(game).toMatchObject({ projectedMargin: 0, projectedLeader: null, projectedMarginText: null });
    expect(game.sentence).toMatch(/projected to finish even/);
  });

  it('QUESTION: an unknown status states a big-figure margin but no projected caption', () => {
    const { first, game } = matchupFace(at('postponed'), { viewerTeamId: 10 });
    expect(first).toMatchObject({ figure: '110.5' });
    expect(game).toMatchObject({
      leader: 'second', marginText: 'Fargo Frostbite by 13.4', projectedMargin: 13.4, projectedMarginText: null, kickoffLabel: null,
    });
  });
});

describe('adversarial: settled Matchups', () => {
  it('final with one score missing states no result, no sentence and no raw leader', () => {
    const { first, game } = matchupFace(at('final', { score: null }), { viewerTeamId: 10 });
    expect(first.scoreLabel).toBe('0.0');
    expect(game).toMatchObject({ resultLine: null, sentence: null, scoreLeader: null, rawMarginText: null });
  });

  it('QUESTION: final: true with status null is isFinal but not settled, so the Proj figure still shows', () => {
    const { first, game } = matchupFace(at(null, {}, {}, { final: true }), { viewerTeamId: 10 });
    expect(game).toMatchObject({
      isFinal: true, settled: false, hasStarted: null, chip: null, resultLine: null, sentence: null, kickoffLabel: null,
    });
    expect(first).toMatchObject({ expectedFinalLabel: '110.5', figure: '110.5' });
  });
});

describe('adversarial: counts', () => {
  it('counts with only the opponent key name the opponent, with yetToPlay', () => {
    const { game } = matchupFace(live, { viewerTeamId: 10, counts: { second: { remaining: 5, yet: 2 } } });
    expect(game.sentence).toBe('Ahead now, projected to trail by 13.4 · they have 5 players remaining, 2 yet to play');
  });

  it('empty counts drop the remaining clause rather than falling back to the wire', () => {
    expect(matchupFace(live, { viewerTeamId: 10, counts: {} }).game.sentence).toBe('Ahead now, projected to trail by 13.4');
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

  it('the wire counts never reach a settled sentence or the side lines', () => {
    const counts = { first: { remaining: 2, yet: 1 }, second: { remaining: 5, yet: 2 } };
    expect(matchupFace(at('final'), { viewerTeamId: 10, counts }).game.sentence).toBe('You won by 5.2');
    const { first, second } = matchupFace(live, { viewerTeamId: 10, counts });
    expect([first.remainingText, second.remainingText]).toEqual(['4 players remaining', '6 players remaining']);
  });
});

describe('adversarial: page lookups', () => {
  it.each([
    ['an object hit', { 10: '2-0' }, '2-0'],
    ['a function hit', () => '4-1', '4-1'],
    ['an object miss', { 30: '2-0' }, null],
    ['a function miss', () => undefined, null],
    ["an empty-string record", { 10: '' }, null],
    ['a number record', { 10: 0 }, '0'],
    ['no lookup', null, null],
  ])('records: %s', (_name, records, expected) => {
    expect(matchupFace(live, { records }).first.record).toBe(expected);
  });

  it('a side with no Team id has no record whatever the lookup holds', () => {
    const { first } = matchupFace(at('live', { teamId: null }), { records: () => '9-9' });
    expect(first.record).toBeNull();
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
    expect(game.winProbability).toEqual({ firstShare, firstPct, secondPct });
  });

  it.each([
    ["''", ''],
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ["'abc'", 'abc'],
  ])('live and priced, server %s falls back to the board share', (_name, serverWinProbability) => {
    expect(matchupFace(live, { viewerTeamId: 10, serverWinProbability }).game.firstPct).toBe(36);
  });

  it('server 0 is a value, not a fallback and not null', () => {
    expect(matchupFace(live, { viewerTeamId: 10, serverWinProbability: 0 }).game.firstPct).toBe(0);
  });

  it('live and unpriced: the server figure is a share, never a priced bar', () => {
    const unpriced = at('live', { expectedFinal: null }, { expectedFinal: null });
    expect(matchupFace(unpriced, { serverWinProbability: 0.8 }).game).toMatchObject({
      priced: false, winProbability: null, projectedWinProbability: null, firstPct: 80,
    });
  });

  it('scheduled and priced: the server figure is the projected bar', () => {
    const { game } = matchupFace(at('scheduled'), { viewerTeamId: 10, serverWinProbability: 0.8 });
    expect(game.projectedWinProbability).toEqual({ firstShare: 0.8, firstPct: 80, secondPct: 20 });
    expect(game.winProbability).toBeNull();
  });

  it('QUESTION: an unknown status states a share but neither bar', () => {
    expect(matchupFace(at(null), { serverWinProbability: 0.8 }).game).toMatchObject({
      hasStarted: null, winProbability: null, projectedWinProbability: null, firstPct: 80,
    });
  });

  it('the two percents always sum to 100', () => {
    [0.004, 0.005, 0.125, 0.335, 0.5, 0.665, 0.995].forEach((share) => {
      const { game } = matchupFace(live, { serverWinProbability: share });
      expect(game.firstPct + game.secondPct).toBe(100);
    });
  });
});

describe('adversarial: names, empty Matchups and kickoff', () => {
  const long = 'The Extraordinarily Long Named Fantasy Football Franchise Of Duluth';

  it('a long name is carried whole in both margin texts', () => {
    expect(matchupFace(at('live', { name: long })).game.marginText).toBe(`${long} by 5.2`);
    expect(matchupFace(at('scheduled', { expectedFinal: 130, name: long })).game.projectedMarginText)
      .toBe(`Projected margin · ${long} by 6.1`);
  });

  it('a missing name reads Home / Away in the big margin and Former manager in the raw one', () => {
    expect(matchupFace(at('live', { name: null }, { name: null })).game.marginText).toBe('Home by 5.2');
    expect(matchupFace(at('live', { name: null }, { name: null })).game.rawMarginText).toBe('Former manager by 5.2');
  });

  it('an empty object reads 0.0 labels with no claim, while null reads null labels', () => {
    const empty = matchupFace({});
    expect([empty.first.scoreLabel, empty.first.figure]).toEqual(['0.0', null]);
    expect(empty.game).toMatchObject({ chip: null, hasStarted: null, firstShare: null, marginText: null, sentence: null });
    const absent = matchupFace(null);
    expect([absent.first.scoreLabel, absent.first.figure]).toEqual([null, null]);
  });

  it.each([
    ['empty sides', { status: 'live', home: {}, away: {} }],
    ['no sides', { status: 'live' }],
  ])('live with %s reads Tied on 0.0 with no price', (_name, matchup) => {
    const { first, game } = matchupFace(matchup);
    expect([first.scoreLabel, first.figure, first.remainingText, first.record]).toEqual(['0.0', '0.0', null, null]);
    expect(game).toMatchObject({ scoreLeader: null, leader: null, marginText: 'Tied', priced: false, firstPct: 50 });
    expect(game.sentence).toBe('Tied now');
  });

  it.each([
    ['scheduled, no kickoff', at('scheduled', {}, {}, { firstKickoffAt: null })],
    ['scheduled, a bad kickoff', at('scheduled', {}, {}, { firstKickoffAt: 'soon' })],
    ['live with a kickoff', live],
    ['final with a kickoff', at('final')],
    ['unknown with a kickoff', at(null)],
  ])('kickoffLabel is null for %s', (_name, matchup) => {
    expect(matchupFace(matchup).game.kickoffLabel).toBeNull();
  });
});
