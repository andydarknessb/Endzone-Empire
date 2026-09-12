import { buildSuggestionView, earlierKickoff, isTooCloseToCall, opponentContextText } from './suggestionView';

describe('opponentContextText', () => {
  test('names the opponent and the points it allows the position', () => {
    expect(opponentContextText({ opponent: 'CIN', opponentPointsAllowed: 15.2, position: 'RB' }))
      .toBe('vs CIN (allows 15.2 to RB)');
  });

  test('falls back to a bare opponent when the allowed figure or position is unknown', () => {
    expect(opponentContextText({ opponent: 'CIN', opponentPointsAllowed: null, position: 'RB' })).toBe('vs CIN');
    expect(opponentContextText({ opponent: 'CIN', opponentPointsAllowed: 15.2, position: null })).toBe('vs CIN');
  });

  test('no opponent (a bye) reads as null, never a guessed line', () => {
    expect(opponentContextText({ opponent: null, opponentPointsAllowed: 15.2, position: 'RB' })).toBeNull();
  });
});

describe('earlierKickoff', () => {
  test('picks the earlier of two instants', () => {
    expect(earlierKickoff('2026-09-14T17:00:00Z', '2026-09-14T20:00:00Z')).toBe('2026-09-14T17:00:00Z');
  });

  test('a missing side never blocks the other from deciding', () => {
    expect(earlierKickoff(null, '2026-09-14T20:00:00Z')).toBe('2026-09-14T20:00:00Z');
    expect(earlierKickoff('2026-09-14T17:00:00Z', null)).toBe('2026-09-14T17:00:00Z');
    expect(earlierKickoff(null, null)).toBeNull();
  });
});

describe('isTooCloseToCall', () => {
  test('a tossup verdict reads as too close to call', () => {
    expect(isTooCloseToCall({ verdict: 'tossup' })).toBe(true);
    expect(isTooCloseToCall({ verdict: 'start' })).toBe(false);
  });
});

describe('buildSuggestionView', () => {
  const entriesById = new Map([
    [1, { playerId: 1, position: 'RB', kickoff: '2026-09-14T17:00:00Z' }],
    [2, { playerId: 2, position: 'RB', kickoff: '2026-09-14T20:00:00Z' }],
  ]);

  const suggestion = {
    slot: 'RB',
    gain: 6.5,
    verdict: 'start',
    current: {
      playerId: 1, name: 'Sit Guy', projection: 8, opponent: 'CIN', opponentPointsAllowed: 12.1,
      distribution: { p10: 3, p90: 13 },
    },
    suggested: {
      playerId: 2, name: 'Start Guy', projection: 14.5, opponent: 'NYJ', opponentPointsAllowed: 21.4,
      distribution: { p10: 9, p90: 20 },
    },
  };

  test('shapes both sides with Floor/Ceiling from the distribution and kickoff/position from the lineup entries', () => {
    const view = buildSuggestionView(suggestion, entriesById);
    expect(view.sit).toMatchObject({
      playerId: 1, name: 'Sit Guy', projection: 8, floor: 3, ceiling: 13,
      position: 'RB', kickoff: '2026-09-14T17:00:00Z', opponentContext: 'vs CIN (allows 12.1 to RB)',
    });
    expect(view.start).toMatchObject({
      playerId: 2, name: 'Start Guy', projection: 14.5, floor: 9, ceiling: 20,
      position: 'RB', kickoff: '2026-09-14T20:00:00Z', opponentContext: 'vs NYJ (allows 21.4 to RB)',
    });
  });

  test('decideBy is the earlier of the two kickoffs', () => {
    expect(buildSuggestionView(suggestion, entriesById).decideBy).toBe('2026-09-14T17:00:00Z');
  });

  test('the two sides share one domain wide enough for both Ceilings', () => {
    const view = buildSuggestionView(suggestion, entriesById);
    expect(view.domainMin).toBe(0);
    expect(view.domainMax).toBe(20);
  });

  test('a missing lineup entry degrades to no position/kickoff rather than throwing', () => {
    const view = buildSuggestionView(suggestion, new Map());
    expect(view.sit.position).toBeNull();
    expect(view.sit.kickoff).toBeNull();
    expect(view.decideBy).toBeNull();
  });

  test('a stable key identifies the pairing', () => {
    expect(buildSuggestionView(suggestion, entriesById).key).toBe('RB-1-2');
  });
});
