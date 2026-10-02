import { buildSuggestionView, calledShotLine, earlierKickoff, factChips, isTooCloseToCall, movePlanWithout, opponentContextText, pointsLeftLine, projectedLeanLine, forecastRecordLine, calledRecordLine } from './suggestionView';

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

  test('a side whose availability reason is no_practice is flagged, any other reason is not (ADR 0056)', () => {
    const view = build(
      side({ availability: { available: true, status: 'Q', reason: 'no_practice' } }),
      side({ playerId: 2, availability: { available: true, status: 'Q', reason: 'questionable' } }),
    );
    expect(view.sit.noPractice).toBe(true);
    expect(view.start.noPractice).toBe(false);
    expect(build(side(), side({ playerId: 2 })).sit.noPractice).toBe(false);
  });

  test('a healthy side, or one with no availability, has no status', () => {
    const view = build(side({ availability: { available: true, status: null } }), side({ playerId: 2 }));
    expect(view.sit.injuryStatus).toBeNull();
    expect(view.start.injuryStatus).toBeNull();
  });
});

describe('buildSuggestionView volatility (#1858)', () => {
  const side = (over = {}) => ({ playerId: 1, name: 'A', projection: 5, ...over });
  const build = (current, suggested) =>
    buildSuggestionView({ slot: 'RB', current, suggested }, new Map());

  test('carries each side\'s tag as its label', () => {
    const view = build(side({ volatility: 'steady' }), side({ playerId: 2, volatility: 'boom_or_bust' }));
    expect(view.sit.volatility).toBe('Steady');
    expect(view.start.volatility).toBe('Boom or bust');
  });

  test('a null, absent or unknown tag has no label', () => {
    const view = build(side({ volatility: null }), side({ playerId: 2, volatility: 'wild' }));
    expect(view.sit.volatility).toBeNull();
    expect(view.start.volatility).toBeNull();
    expect(build(side(), side({ playerId: 2 })).sit.volatility).toBeNull();
  });
});

describe('factChips (#1853)', () => {
  const texts = (input) => factChips(input).map((chip) => chip.text);
  const calm = { indoor: false, windSpeedMph: 5, windGustMph: 9, precipitationProbability: 10, shortForecast: 'Clear' };

  test('High total at 48 or more, with the exact copy', () => {
    expect(texts({ line: { spread: -1, total: 49.5, favoredBy: 1 } })).toEqual(['High total 49.5']);
    expect(texts({ line: { spread: -1, total: 48, favoredBy: 1 } })).toEqual(['High total 48']);
    expect(texts({ line: { spread: -1, total: 47.5, favoredBy: 1 } })).toEqual([]);
  });

  test('Favored by at 7 or more, never for an underdog', () => {
    expect(texts({ line: { spread: -7.5, total: 40, favoredBy: 7.5 } })).toEqual(['Favored by 7.5']);
    expect(texts({ line: { spread: -7, total: 40, favoredBy: 7 } })).toEqual(['Favored by 7']);
    expect(texts({ line: { spread: -6.5, total: 40, favoredBy: 6.5 } })).toEqual([]);
    expect(texts({ line: { spread: 10, total: 40, favoredBy: -10 } })).toEqual([]);
    expect(texts({ line: { spread: null, total: 40, favoredBy: null } })).toEqual([]);
  });

  test('Wind at 20 mph or more and Rain at 60% or more, outdoors', () => {
    expect(texts({ weather: { ...calm, windSpeedMph: 22 } })).toEqual(['Wind 22 mph']);
    expect(texts({ weather: { ...calm, windSpeedMph: 20 } })).toEqual(['Wind 20 mph']);
    expect(texts({ weather: { ...calm, windSpeedMph: 19 } })).toEqual([]);
    expect(texts({ weather: { ...calm, precipitationProbability: 70 } })).toEqual(['Rain 70%']);
    expect(texts({ weather: { ...calm, precipitationProbability: 60 } })).toEqual(['Rain 60%']);
    expect(texts({ weather: { ...calm, precipitationProbability: 59 } })).toEqual([]);
  });

  test('a dome shows no weather chip whatever the numbers say', () => {
    expect(texts({ weather: { ...calm, indoor: true, windSpeedMph: 30, precipitationProbability: 90 } })).toEqual([]);
  });

  test('no line, no weather, or nothing notable is no chips', () => {
    expect(factChips({})).toEqual([]);
    expect(factChips({ line: null, weather: null })).toEqual([]);
    expect(factChips({ line: { spread: -3, total: 44, favoredBy: 3 }, weather: calm })).toEqual([]);
  });

  test('chips read in a fixed order: total, favored, wind, rain', () => {
    expect(texts({
      line: { spread: -8, total: 50, favoredBy: 8 },
      weather: { ...calm, windSpeedMph: 25, precipitationProbability: 80 },
    })).toEqual(['High total 50', 'Favored by 8', 'Wind 25 mph', 'Rain 80%']);
  });

  test("the context-only label follows each Factor's applied flag, line chips the market and weather chips the weather", () => {
    const input = {
      line: { spread: -8, total: 50, favoredBy: 8 },
      weather: { ...calm, windSpeedMph: 25 },
    };
    const contextOnly = (flags) => factChips({ ...input, ...flags }).map((chip) => chip.contextOnly);
    // Under v3.1 both Factors ship unscored: every chip is context only.
    expect(contextOnly({ weatherApplied: false, marketApplied: false })).toEqual([true, true, true]);
    // A Model version that applies the market drops the label on the Line chips only.
    expect(contextOnly({ weatherApplied: false, marketApplied: true })).toEqual([false, false, true]);
    expect(contextOnly({ weatherApplied: true, marketApplied: false })).toEqual([true, true, false]);
    // A payload that does not say is never read as applied.
    expect(contextOnly({})).toEqual([true, true, true]);
  });
});

describe('buildSuggestionView fact chips (#1853)', () => {
  const entriesById = new Map();
  const side = (playerId, extra) => ({ playerId, name: `p${playerId}`, projection: 5, distribution: { p10: 1, p90: 9 }, ...extra });

  test('each side gets the chips for its own game and flags', () => {
    const view = buildSuggestionView({
      slot: 'RB',
      current: side(1, { line: { spread: 9, total: 40, favoredBy: -9 }, marketApplied: false }),
      suggested: side(2, { line: { spread: -9, total: 52, favoredBy: 9 }, marketApplied: true }),
    }, entriesById);
    expect(view.sit.factChips).toEqual([]);
    expect(view.start.factChips).toEqual([
      { key: 'total', text: 'High total 52', contextOnly: false },
      { key: 'favored', text: 'Favored by 9', contextOnly: false },
    ]);
  });

  test('a legacy payload with no line or weather has no chips', () => {
    const view = buildSuggestionView({ slot: 'RB', current: side(1), suggested: side(2) }, entriesById);
    expect(view.sit.factChips).toEqual([]);
    expect(view.start.factChips).toEqual([]);
  });
});

describe('canCallShot (#1856)', () => {
  const side = (playerId) => ({ playerId, name: `p${playerId}`, projection: 10 });
  const build = (over) => buildSuggestionView(
    { slot: 'RB', current: side(1), suggested: side(2), verdict: 'start', probabilityBetter: 0.9, ...over },
    new Map()
  );

  test('a lean with a probability can be called, and carries the probability', () => {
    const view = build();
    expect(view.canCallShot).toBe(true);
    expect(view.probability).toBe(0.9);
  });

  test('a tossup or a missing probability cannot', () => {
    expect(build({ verdict: 'tossup', probabilityBetter: 0.55 }).canCallShot).toBe(false);
    expect(build({ probabilityBetter: null }).canCallShot).toBe(false);
    expect(build({ probabilityBetter: undefined }).canCallShot).toBe(false);
  });
});

describe('calledShotLine (#1856)', () => {
  const base = {
    status: 'pending',
    outcome: null,
    canWithdraw: true,
    probability: 0.925,
    starter: { playerId: 1, name: 'Kept', projection: 8, points: null },
    benched: { playerId: 2, name: 'Passed', projection: 14.5, points: null },
  };

  test('no shot, no line', () => {
    expect(calledShotLine(null)).toBeNull();
    expect(calledShotLine(undefined)).toBeNull();
    expect(calledShotLine({ status: 'pending' })).toBeNull();
  });

  test('pending: the pair, the numbers as called, open status, withdrawable', () => {
    expect(calledShotLine(base)).toEqual({
      text: 'Kept over Passed',
      numbers: 'Proj 8.0 vs 14.5 · 93% lean to Passed',
      status: 'Open until the first of the two kicks off',
      state: 'pending',
      canWithdraw: true,
    });
  });

  test('locked is not withdrawable', () => {
    const line = calledShotLine({ ...base, status: 'locked', canWithdraw: false });
    expect(line.state).toBe('locked');
    expect(line.status).toMatch(/^Locked/);
    expect(line.canWithdraw).toBe(false);
  });

  test('resolved hit, miss and void each read their own outcome', () => {
    const resolved = (outcome) => calledShotLine({
      ...base,
      status: 'resolved',
      outcome,
      canWithdraw: false,
      starter: { ...base.starter, points: 12.5 },
      benched: { ...base.benched, points: 9 },
    });
    expect(resolved('hit')).toMatchObject({ state: 'resolved-hit', status: 'Hit: Kept scored 12.5, Passed 9.0' });
    expect(resolved('miss')).toMatchObject({ state: 'resolved-miss', status: 'Miss: Kept scored 12.5, Passed 9.0' });
    expect(resolved('void')).toMatchObject({ state: 'resolved-void' });
    expect(resolved('void').status).toMatch(/^Void/);
  });

  test('a missing probability drops that clause rather than printing NaN', () => {
    expect(calledShotLine({ ...base, probability: null }).numbers).toBe('Proj 8.0 vs 14.5');
  });
});

// #1861
describe('pointsLeftLine', () => {
  test('the season total and the rank among the league\'s teams', () => {
    expect(pointsLeftLine({ total: 41.2, rank: 3, teams: 10 })).toBe('Left on the bench this season: 41.2 (3rd fewest of 10)');
    expect(pointsLeftLine({ total: 8, rank: 1, teams: 12 })).toBe('Left on the bench this season: 8.0 (1st fewest of 12)');
    expect(pointsLeftLine({ total: 0, rank: 11, teams: 12 })).toBe('Left on the bench this season: 0.0 (11th fewest of 12)');
  });

  test('no standing, or an unreadable one, is no line', () => {
    expect(pointsLeftLine(null)).toBeNull();
    expect(pointsLeftLine(undefined)).toBeNull();
    expect(pointsLeftLine({ total: null, rank: 2, teams: 10 })).toBeNull();
    expect(pointsLeftLine({ total: 4, rank: null, teams: 10 })).toBeNull();
  });
});

describe('forecastRecordLine and calledRecordLine (#1862)', () => {
  test('the Override record reads hits-misses, the Called shot record reads hits of resolved and the streak', () => {
    expect(forecastRecordLine({ hits: 5, misses: 3 })).toBe('You vs the Forecast: 5-3');
    expect(forecastRecordLine({ hits: 0, misses: 2 })).toBe('You vs the Forecast: 0-2');
    expect(calledRecordLine({ hits: 2, resolved: 3, streak: 2 })).toBe('Called shots this season: 2 of 3 · streak 2');
    expect(calledRecordLine({ hits: 0, resolved: 1, streak: 0 })).toBe('Called shots this season: 0 of 1 · streak 0');
  });

  test('nothing resolved, or a payload it cannot read, is no line', () => {
    expect(forecastRecordLine(null)).toBeNull();
    expect(forecastRecordLine({ hits: 0, misses: 0 })).toBeNull();
    expect(forecastRecordLine({ hits: 'x', misses: 1 })).toBeNull();
    expect(calledRecordLine(undefined)).toBeNull();
    expect(calledRecordLine({ hits: 0, resolved: 0, streak: 0 })).toBeNull();
  });
});
