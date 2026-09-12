import {
  isPickemStandings,
  seasonView,
  isFrozenPickemSeason,
  allTimeRowFromRow,
  allTimeFromResponse,
} from './seasonArchiveModel';

describe('isPickemStandings', () => {
  test('true for a pick\'em standings shape (points, no wins)', () => {
    expect(isPickemStandings([{ teamId: 1, points: 10 }])).toBe(true);
  });

  test('false for a fantasy standings shape (wins present)', () => {
    expect(isPickemStandings([{ teamId: 1, wins: 3, points: undefined }])).toBe(false);
  });

  test('false for an empty array', () => {
    expect(isPickemStandings([])).toBe(false);
  });
});

describe('seasonView', () => {
  test('matches each champion to its archived standings row by teamId', () => {
    const view = seasonView({
      season: 2026,
      outcome: 'champion',
      champions: [{ teamId: 1, name: 'Sunday Ballers' }],
      standings: [{ teamId: 1, name: 'Sunday Ballers', wins: 8, losses: 4, ties: 0 }],
    });
    expect(view.champions[0].standing).toEqual({ teamId: 1, name: 'Sunday Ballers', wins: 8, losses: 4, ties: 0 });
  });

  // Cory's 2026-09-11 ruling: a champion missing from its own season's
  // archived standings is a data defect, not a gap in the champions[] shape.
  // This model reports it as `standing: null` rather than inventing one.
  test('reports a champion with no matching standings row as standing: null, and leaves the other champion untouched', () => {
    const view = seasonView({
      season: 2026,
      outcome: 'champions',
      champions: [
        { teamId: 1, name: 'Sunday Ballers' },
        { teamId: 99, name: 'Gone Co-Champ' },
      ],
      standings: [{ teamId: 1, name: 'Sunday Ballers', points: 171, correct: 120 }],
    });
    expect(view.champions.find((c) => c.teamId === 1).standing).not.toBeNull();
    expect(view.champions.find((c) => c.teamId === 99).standing).toBeNull();
  });

  test('pickem is true for a declared champions outcome even with empty standings', () => {
    expect(seasonView({ season: 2026, outcome: 'champions', champions: [], standings: [] }).pickem).toBe(true);
  });

  test('pickem is true for a legacy undeclared season whose standings carry the pick\'em shape', () => {
    const view = seasonView({
      season: 2020,
      outcome: 'no_champion',
      champions: [],
      standings: [{ teamId: 1, points: 100 }],
    });
    expect(view.pickem).toBe(true);
  });

  test('coChampions is true only with more than one champion', () => {
    expect(seasonView({ season: 2026, champions: [{ teamId: 1 }] }).coChampions).toBe(false);
    expect(seasonView({ season: 2026, champions: [{ teamId: 1 }, { teamId: 2 }] }).coChampions).toBe(true);
  });

  test('a null/malformed season yields empty, non-throwing defaults', () => {
    expect(seasonView(null)).toEqual({
      season: undefined,
      standings: [],
      trophies: [],
      draftGrades: null,
      trophiesErrored: false,
      draftGradesErrored: false,
      champions: [],
      pickem: false,
      coChampions: false,
      explicitNoChampion: false,
    });
  });
});

describe('isFrozenPickemSeason', () => {
  test('frozen for a declared champions result', () => {
    expect(isFrozenPickemSeason({ outcome: 'champions', standings: [] })).toBe(true);
  });

  test('frozen for a declared no_champion result identified by pick\'em standings shape', () => {
    expect(isFrozenPickemSeason({ outcome: 'no_champion', standings: [{ teamId: 1, points: 10 }] })).toBe(true);
  });

  test('not frozen for a champion-less fantasy season sharing the same outcome string', () => {
    expect(isFrozenPickemSeason({ outcome: 'no_champion', standings: [{ teamId: 1, wins: 5 }] })).toBe(false);
  });

  test('not frozen for a legacy undeclared pick\'em season (outcome null)', () => {
    expect(isFrozenPickemSeason({ outcome: null, standings: [{ teamId: 1, points: 10 }] })).toBe(false);
  });
});

describe('allTimeRowFromRow', () => {
  test('a fantasy Team keeps its numeric wins/losses/ties', () => {
    expect(allTimeRowFromRow({ teamId: 1, name: 'Ballers', avatarUrl: null, championships: 2, wins: 20, losses: 10, ties: 1 }))
      .toEqual({ teamId: 1, name: 'Ballers', avatarUrl: null, championships: 2, wins: 20, losses: 10, ties: 1 });
  });

  // R2 (server/services/seasonArchive.service.js): a pick'em Team never had a
  // finalized regular-season Matchup, so wins/losses/ties stay null - never
  // coerced to zero, which would invent a Record that never happened.
  test('a pick\'em Team\'s wins/losses/ties stay null, never coerced to zero', () => {
    expect(allTimeRowFromRow({ teamId: 2, name: 'Pickers', avatarUrl: null, championships: 0, wins: null, losses: null, ties: null }))
      .toEqual({ teamId: 2, name: 'Pickers', avatarUrl: null, championships: 0, wins: null, losses: null, ties: null });
  });

  test('a gone Team (R4) still gets a row, with name/avatarUrl null', () => {
    expect(allTimeRowFromRow({ teamId: 3, name: null, avatarUrl: null, championships: 1, wins: 5, losses: 5, ties: 0 }).name).toBeNull();
  });

  test('a null row yields a zeroed, non-throwing row', () => {
    expect(allTimeRowFromRow(null)).toEqual({
      teamId: null, name: null, avatarUrl: null, championships: 0, wins: null, losses: null, ties: null,
    });
  });
});

describe('allTimeFromResponse', () => {
  test('normalizes every row and preserves the server\'s order', () => {
    const rows = allTimeFromResponse({
      allTime: [
        { teamId: 1, name: 'A', avatarUrl: null, championships: 2, wins: 20, losses: 10, ties: 0 },
        { teamId: 2, name: 'B', avatarUrl: null, championships: 1, wins: null, losses: null, ties: null },
      ],
    });
    expect(rows.map((r) => r.teamId)).toEqual([1, 2]);
    expect(rows[1].wins).toBeNull();
  });

  test('a body with no allTime array is an empty roster, never a throw', () => {
    expect(allTimeFromResponse({})).toEqual([]);
    expect(allTimeFromResponse(null)).toEqual([]);
  });
});
