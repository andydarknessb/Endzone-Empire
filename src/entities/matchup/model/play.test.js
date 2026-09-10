import { playsFromScoreEvent, matchupPlaySide, playLabel } from './play';

const rawPlay = (playerId, over = {}) => ({
  playerId,
  name: `Player ${playerId}`,
  position: 'WR',
  nflTeam: 'KC',
  opponent: 'BUF',
  type: 'rushing',
  isTouchdown: true,
  pointsDelta: 6,
  ...over,
});

describe('playsFromScoreEvent', () => {
  test('an event with no plays field reads as no plays', () => {
    expect(playsFromScoreEvent({})).toEqual([]);
    expect(playsFromScoreEvent(undefined)).toEqual([]);
    expect(playsFromScoreEvent(null)).toEqual([]);
  });

  test('an event with an empty plays array reads as no plays', () => {
    expect(playsFromScoreEvent({ plays: [] })).toEqual([]);
  });

  test('a populated event reads every play into the modelled shape', () => {
    const event = { plays: [rawPlay(1), rawPlay(2, { type: 'receiving', pointsDelta: 6.5 })] };
    const plays = playsFromScoreEvent(event);
    expect(plays).toHaveLength(2);
    expect(plays[0]).toMatchObject({
      playerId: 1,
      name: 'Player 1',
      position: 'WR',
      nflTeam: 'KC',
      opponent: 'BUF',
      type: 'rushing',
      isTouchdown: true,
      pointsDelta: 6,
    });
    expect(plays[1].pointsDelta).toBe(6.5);
  });

  test('a null entry in the wire array is dropped rather than modelled', () => {
    expect(playsFromScoreEvent({ plays: [null, rawPlay(1)] })).toHaveLength(1);
  });

  test('pointsDelta normalises to a number', () => {
    const [play] = playsFromScoreEvent({ plays: [rawPlay(1, { pointsDelta: '6' })] });
    expect(play.pointsDelta).toBe(6);
  });

  // Red-tell: playLabel reads isTouchdown with a strict `=== false`, and a
  // string "false" is not `=== false`, so playLabel on the raw pass-through
  // (as useMatchup used to hand onScores its plays, before this model
  // existed) reads a sack as a touchdown: "sack TD". The model normalises
  // the field to a real boolean first, so playLabel on the SAME entry, once
  // modelled, reads "SACK". Both assertions run playLabel, the production
  // code under test; the first is red before this model existed and stays
  // green now only because the raw entry is unmodelled, not because of
  // anything this module does.
  test('a wire isTouchdown of the string "false" models as false, not a touchdown', () => {
    const rawEntry = rawPlay(1, { isTouchdown: 'false', type: 'sack' });
    expect(playLabel(rawEntry)).toBe('sack TD');

    const [play] = playsFromScoreEvent({ plays: [rawEntry] });
    expect(playLabel(play)).toBe('SACK');
  });
});

describe('matchupPlaySide', () => {
  const sides = { myStarterIds: new Set([1, 2, 3]), oppStarterIds: new Set([9, 10]) };

  test('a play by the viewer\'s own starter is "own"', () => {
    expect(matchupPlaySide(rawPlay(1), sides)).toBe('own');
  });

  test('a play by the opponent\'s starter is "opponent"', () => {
    expect(matchupPlaySide(rawPlay(9), sides)).toBe('opponent');
  });

  test('a play by a bench player or someone in another matchup is "none"', () => {
    expect(matchupPlaySide(rawPlay(555), sides)).toBe('none');
  });

  test('a missing play or starter sets is "none", never a throw', () => {
    expect(matchupPlaySide(null, sides)).toBe('none');
    expect(matchupPlaySide(rawPlay(1), {})).toBe('none');
    expect(matchupPlaySide(rawPlay(1))).toBe('none');
  });
});

describe('playLabel', () => {
  test('describes the TD type', () => {
    expect(playLabel(rawPlay(1, { type: 'receiving' }))).toBe('receiving TD');
    expect(playLabel({})).toBe('scoring TD');
  });

  test('describes a non-touchdown moment play in plain English', () => {
    expect(playLabel(rawPlay(1, { type: 'sack', isTouchdown: false }))).toBe('SACK');
    expect(playLabel(rawPlay(1, { type: 'fieldGoal', isTouchdown: false }))).toBe('FIELD GOAL');
    expect(playLabel(rawPlay(1, { type: 'interception', isTouchdown: false }))).toBe('INTERCEPTED');
  });
});
