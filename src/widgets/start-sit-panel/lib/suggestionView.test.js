import { buildSuggestionView, earlierKickoff, isTooCloseToCall, movePlanWithout, opponentContextText, projectedLeanLine } from './suggestionView';

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

  // #1485: the matchup line reads as descriptive-only (never applied to the
  // number above it) when the engine's own opponent factor did not fire, even
  // though a raw points-allowed figure is still displayable.
  test('marks the line context-only when the engine did not apply the opponent factor', () => {
    expect(opponentContextText({
      opponent: 'CIN', opponentPointsAllowed: 28.6, position: 'WR', opponentApplied: false,
    })).toBe('vs CIN (allows 28.6 to WR, context only)');
  });

  test('reads as an applied matchup when opponentApplied is true', () => {
    expect(opponentContextText({
      opponent: 'CIN', opponentPointsAllowed: 28.6, position: 'WR', opponentApplied: true,
    })).toBe('vs CIN (allows 28.6 to WR)');
  });

  test('a legacy payload with no opponentApplied field keeps the old, unqualified text', () => {
    expect(opponentContextText({ opponent: 'CIN', opponentPointsAllowed: 28.6, position: 'WR' }))
      .toBe('vs CIN (allows 28.6 to WR)');
  });

  test('context-only never applies to the bare-opponent fallback (no points allowed to qualify)', () => {
    expect(opponentContextText({
      opponent: 'CIN', opponentPointsAllowed: null, position: 'RB', opponentApplied: false,
    })).toBe('vs CIN');
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

  test('forwards side.opponentApplied into opponentContext (#1485)', () => {
    const seeded = {
      ...suggestion,
      current: { ...suggestion.current, opponentApplied: false },
      suggested: { ...suggestion.suggested, opponentApplied: true },
    };
    const view = buildSuggestionView(seeded, entriesById);
    expect(view.sit.opponentContext).toBe('vs CIN (allows 12.1 to RB, context only)');
    expect(view.start.opponentContext).toBe('vs NYJ (allows 21.4 to RB)');
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

describe('movePlanWithout', () => {
  const movePlan = [
    { playerId: 2, fromSlot: 'BENCH', toSlot: 'RB' },
    { playerId: 1, fromSlot: 'RB', toSlot: 'BENCH' },
    { playerId: 4, fromSlot: 'BENCH', toSlot: 'WR' },
    { playerId: 3, fromSlot: 'WR', toSlot: 'BENCH' },
    { playerId: 9, fromSlot: 'BENCH', toSlot: 'FLEX' },
  ];
  const view = (sitId, startId) => ({ sit: { playerId: sitId }, start: { playerId: startId } });

  test('drops both moves of a dismissed pair and keeps every other move', () => {
    expect(movePlanWithout(movePlan, [view(1, 2)])).toEqual([
      { playerId: 4, fromSlot: 'BENCH', toSlot: 'WR' },
      { playerId: 3, fromSlot: 'WR', toSlot: 'BENCH' },
      { playerId: 9, fromSlot: 'BENCH', toSlot: 'FLEX' },
    ]);
  });

  test('nothing dismissed returns the plan unchanged', () => {
    expect(movePlanWithout(movePlan, [])).toEqual(movePlan);
  });

  test('a pair whose players are not in the plan leaves it unchanged', () => {
    expect(movePlanWithout(movePlan, [view(77, 78)])).toEqual(movePlan);
  });
});

describe('projectedLeanLine (#1852)', () => {
  test('a gap of 10 or more with the manager behind leans toward Ceiling, with the rounded gap', () => {
    expect(projectedLeanLine({ mine: 88, theirs: 100 })).toBe('Projected to trail by 12: lean toward Ceiling');
    expect(projectedLeanLine({ mine: 90, theirs: 100 })).toBe('Projected to trail by 10: lean toward Ceiling');
  });

  test('a gap of 10 or more with the manager ahead leans toward Floor', () => {
    expect(projectedLeanLine({ mine: 112.4, theirs: 100 })).toBe('Projected to lead by 12: lean toward Floor');
  });

  test('a closer Matchup has no line, even when the gap rounds up to 10', () => {
    expect(projectedLeanLine({ mine: 95, theirs: 88 })).toBeNull();
    expect(projectedLeanLine({ mine: 90.5, theirs: 100 })).toBeNull();
    expect(projectedLeanLine({ mine: 100, theirs: 100 })).toBeNull();
  });

  test('a missing Expected final on either side has no line (a 0 is a value, not a miss)', () => {
    expect(projectedLeanLine({ mine: null, theirs: 100 })).toBeNull();
    expect(projectedLeanLine({ mine: 88, theirs: undefined })).toBeNull();
    expect(projectedLeanLine(null)).toBeNull();
    expect(projectedLeanLine({ mine: 0, theirs: 10 })).toBe('Projected to trail by 10: lean toward Ceiling');
  });

  test('the copy says Floor and Ceiling, never "range", and has no em-dash', () => {
    const line = projectedLeanLine({ mine: 80, theirs: 100 });
    expect(line).not.toMatch(/range/i);
    expect(line).not.toMatch(/—/);
  });
});

describe('buildSuggestionView injury designation (#1852)', () => {
  const side = (over = {}) => ({ playerId: 1, name: 'A', projection: 5, ...over });
  const build = (current, suggested) =>
    buildSuggestionView({ slot: 'RB', current, suggested }, new Map());

  test('carries each side\'s availability status for the shared injury tag', () => {
    const view = build(
      side({ availability: { available: true, status: 'Q' } }),
      side({ playerId: 2, availability: { available: false, status: 'O' } }),
    );
    expect(view.sit.injuryStatus).toBe('Q');
    expect(view.start.injuryStatus).toBe('O');
  });

  test('a healthy side, or one with no availability, has no status', () => {
    const view = build(side({ availability: { available: true, status: null } }), side({ playerId: 2 }));
    expect(view.sit.injuryStatus).toBeNull();
    expect(view.start.injuryStatus).toBeNull();
  });
});
