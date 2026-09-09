import { lineupModel } from './lineupModel';

// One lineup row exactly as GET /api/team/lineup delivers it
// (server/services/lineup.service.js getLineup: id, name, position,
// nfl_team, slot, projected_points, injury_status, plus the annotation
// fields this model does not read). getLineup never sends an `opponent`
// field, so none is fixtured here.
const row = (overrides = {}) => ({
  id: 1,
  name: 'Josh Allen',
  position: 'QB',
  nfl_team: 'BUF',
  slot: 'QB',
  projected_points: 24.3,
  injury_status: null,
  bye_week: null,
  locked: false,
  onBye: false,
  valid_stash: false,
  ...overrides,
});

// A spentStartingSlots row exactly as lineup.service.js builds it: a
// departed starter's slot-holding record for a settled week, spread into
// getLineup's entries alongside the real rows. It carries no
// `projected_points` key at all (never `null` - simply absent).
const spentRow = (overrides = {}) => ({
  player_id: null,
  id: 300,
  name: 'Departed Starter',
  position: 'WR',
  nfl_team: 'MIA',
  injury_status: null,
  slot: 'WR',
  spent: true,
  ...overrides,
});

describe('lineupModel: the one shape from the lineup body', () => {
  // Nine starters (non-BENCH, non-IR slots), six bench, one IR: sixteen rows
  // total, matching the acceptance fixture (nine starters, six bench, one IR).
  const starterSlots = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K'];
  const starterRows = starterSlots.map((slot, i) =>
    row({ id: i + 1, name: `Starter ${i + 1}`, slot, projected_points: 10 + i })
  );
  const benchRows = Array.from({ length: 6 }, (_, i) =>
    row({ id: 100 + i, name: `Bench ${i + 1}`, slot: 'BENCH', projected_points: 5 + i })
  );
  const irRow = row({ id: 200, name: 'IR Guy', slot: 'IR', projected_points: 3 });

  const body = {
    leagueId: 7,
    teamId: 3,
    season: 2026,
    week: 4,
    currentWeek: 4,
    entries: [...starterRows, ...benchRows, irRow],
  };

  test('maps nine starters, benchCount 6, and the projected points as numbers', () => {
    const model = lineupModel(body);

    expect(model.week).toBe(4);
    expect(model.season).toBe(2026);
    expect(model.teamId).toBe(3);
    expect(model.starters).toHaveLength(9);
    expect(model.benchCount).toBe(6);
    // Sixteen rows total survive onto `entries` (starters, bench and IR
    // together, CONTEXT.md's Roster) even though only nine are starters.
    expect(model.entries).toHaveLength(16);

    // Every starter's projected points arrived (or was coerced) as a number,
    // never a string, never NaN.
    model.starters.forEach((s) => {
      expect(typeof s.projectedPoints).toBe('number');
      expect(Number.isFinite(s.projectedPoints)).toBe(true);
    });

    // One starter's full shape, camelCased off the wire's row. No `opponent`
    // key: getLineup never sends one.
    expect(model.starters[0]).toEqual({
      playerId: 1,
      name: 'Starter 1',
      position: 'QB',
      nflTeam: 'BUF',
      slot: 'QB',
      projectedPoints: 10,
      injuryStatus: null,
      spent: false,
    });
  });

  // Red-tell (AC): dropping the `slot !== 'BENCH'` clause from the starters
  // filter turns THIS case red and no other - bench rows would be seated as
  // starters, inflating the count past nine.
  test('bench and IR rows are excluded from starters', () => {
    const model = lineupModel(body);
    expect(model.starters.some((s) => s.name.startsWith('Bench'))).toBe(false);
    expect(model.starters.some((s) => s.name === 'IR Guy')).toBe(false);
  });

  // A spentStartingSlots row (a departed starter's slot record for a settled
  // week) is seated in `entries` alongside the nine real starters, but it
  // occupies no starting seat today: nine real starters plus one spent row
  // must still read nine starters, never ten (CONTEXT.md's Lineup entry).
  test('a spent row (spentStartingSlots shape) is excluded from starters, never inflating the count', () => {
    const withSpent = { ...body, entries: [...starterRows, ...benchRows, irRow, spentRow()] };
    const model = lineupModel(withSpent);

    expect(model.starters).toHaveLength(9);
    expect(model.starters.some((s) => s.name === 'Departed Starter')).toBe(false);
    // The spent row still survives onto `entries`, marked, for a caller that
    // wants the full roster picture.
    const spentEntry = model.entries.find((e) => e.name === 'Departed Starter');
    expect(spentEntry).toEqual({
      playerId: 300,
      name: 'Departed Starter',
      position: 'WR',
      nflTeam: 'MIA',
      slot: 'WR',
      projectedPoints: null,
      injuryStatus: null,
      spent: true,
    });
  });

  test('a spent starter carrying a Questionable injury_status is not counted in questionable', () => {
    const withSpentQuestionable = {
      ...body,
      entries: [...starterRows, ...benchRows, irRow, spentRow({ injury_status: 'Questionable' })],
    };
    const model = lineupModel(withSpentQuestionable);
    expect(model.questionable).toBe(0);
  });

  test('a starter with injury_status Questionable is counted in questionable', () => {
    const withQuestionable = {
      ...body,
      entries: [
        row({ id: 1, slot: 'QB', injury_status: 'Questionable' }),
        ...starterRows.slice(1),
        ...benchRows,
        irRow,
      ],
    };
    const model = lineupModel(withQuestionable);
    expect(model.questionable).toBe(1);
  });

  test('a healthy lineup (every injury_status null) counts zero questionable', () => {
    const model = lineupModel(body);
    expect(model.questionable).toBe(0);
  });

  // A benched or IR player's injury designation never counts toward
  // `questionable`, which is a STARTERS-only count (CONTEXT.md: Injury
  // designation is a roster fact, but this count is scoped to the lineup a
  // team actually starts).
  test('a questionable bench or IR player does not count toward questionable', () => {
    const withBenchQuestionable = {
      ...body,
      entries: [
        ...starterRows,
        row({ id: 100, slot: 'BENCH', injury_status: 'Questionable' }),
        ...benchRows.slice(1),
        row({ id: 200, slot: 'IR', injury_status: 'Injured Reserve' }),
      ],
    };
    const model = lineupModel(withBenchQuestionable);
    expect(model.questionable).toBe(0);
  });

  test('a null/missing body maps to the empty shape rather than throwing', () => {
    expect(lineupModel(null)).toEqual({
      week: null,
      season: null,
      teamId: null,
      entries: [],
      starters: [],
      benchCount: 0,
      questionable: 0,
    });
    expect(lineupModel(undefined)).toEqual({
      week: null,
      season: null,
      teamId: null,
      entries: [],
      starters: [],
      benchCount: 0,
      questionable: 0,
    });
  });

  test('a projected_points wire string (a pg decimal) coerces to a number', () => {
    const model = lineupModel({
      ...body,
      entries: [row({ id: 1, slot: 'QB', projected_points: '18.50' })],
    });
    expect(model.starters[0].projectedPoints).toBe(18.5);
  });

  test('a null projected_points stays null rather than becoming 0 or NaN', () => {
    const model = lineupModel({
      ...body,
      entries: [row({ id: 1, slot: 'QB', projected_points: null })],
    });
    expect(model.starters[0].projectedPoints).toBeNull();
  });
});
