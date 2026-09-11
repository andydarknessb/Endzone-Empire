import { lineupModel, pairStartersBySlot, locked, eligibleSlots, lineupEntries } from './lineupModel';

// One lineup row exactly as GET /api/team/lineup delivers it
// (server/services/lineup.service.js getLineup: id, name, position,
// nfl_team, slot, projected_points, injury_status, opponent, plus the
// annotation fields this model does not read). `opponent` arrived with
// #1132 (annotateLineupEntries): a Team code or `null` for a bye/unsynced
// slate.
const row = (overrides = {}) => ({
  id: 1,
  name: 'Josh Allen',
  position: 'QB',
  nfl_team: 'BUF',
  slot: 'QB',
  projected_points: 24.3,
  injury_status: null,
  opponent: 'KC',
  bye_week: null,
  locked: false,
  onBye: false,
  valid_stash: false,
  ...overrides,
});

// A spentStartingSlots row exactly as lineup.service.js builds it: a
// departed starter's slot-holding record for a settled week, spread into
// getLineup's entries alongside the real rows. It carries no
// `projected_points` key at all (never `null` - simply absent). It still
// gets annotated with `opponent` like every other row: annotateLineupEntries
// has no spent branch, and spentStartingSlots carries the player's real
// nfl_team, so a settled week's nfl_games row normally resolves to a real
// Team code here too - `null` is the bye/unsynced-slate case, not the
// spent-row case.
const spentRow = (overrides = {}) => ({
  player_id: null,
  id: 300,
  name: 'Departed Starter',
  position: 'WR',
  nfl_team: 'MIA',
  injury_status: null,
  slot: 'WR',
  spent: true,
  opponent: 'NYJ',
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

    // One starter's full shape, camelCased off the wire's row, including
    // `opponent` (#1150) as the wire supplied it.
    expect(model.starters[0]).toEqual({
      playerId: 1,
      name: 'Starter 1',
      position: 'QB',
      nflTeam: 'BUF',
      slot: 'QB',
      projectedPoints: 10,
      injuryStatus: null,
      spent: false,
      opponent: 'KC',
    });
  });

  test('a non-null opponent on the wire produces the same value on the modeled entry and the corresponding starter', () => {
    const model = lineupModel({
      ...body,
      entries: [row({ id: 1, slot: 'QB', opponent: 'NE' }), ...starterRows.slice(1), ...benchRows, irRow],
    });
    expect(model.entries[0].opponent).toBe('NE');
    expect(model.starters[0].opponent).toBe('NE');
  });

  test('opponent: null on the wire stays null rather than being dropped or coerced', () => {
    const model = lineupModel({
      ...body,
      entries: [row({ id: 1, slot: 'QB', opponent: null }), ...starterRows.slice(1), ...benchRows, irRow],
    });
    expect(model.starters[0].opponent).toBeNull();
  });

  test('a wire row without an opponent key at all produces opponent: null', () => {
    const { opponent, ...rowWithoutOpponent } = row({ id: 1, slot: 'QB' });
    const model = lineupModel({
      ...body,
      entries: [rowWithoutOpponent, ...starterRows.slice(1), ...benchRows, irRow],
    });
    expect(model.starters[0].opponent).toBeNull();
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
      opponent: 'NYJ',
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

// #1207 (part of #1198, R1): `pairStartersBySlot`, moved here byte-for-byte
// from `entities/matchup/model/matchupModel.js`, which re-exported it for one
// release; these cases moved with it from that module's test file when #1210
// closed the exception (R5 of #1198: tests replace, not layer).
describe('pairStartersBySlot: starters paired by slot, in the league order', () => {
  const player = (overrides = {}) => ({
    id: 1,
    name: 'P. Mahomes',
    slot: 'QB',
    position: 'QB',
    points: 24.1,
    ...overrides,
  });

  // A standard (offense-only) league order; the pairing needs an explicit order
  // now - there is no silent default.
  const STANDARD = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

  const shortHome = [player({ id: 1, name: "Ja'Marr Chase", slot: 'WR', position: 'WR' })];
  const fullAway = [
    player({ id: 2, name: 'Trevor Lawrence', slot: 'QB' }),
    player({ id: 3, name: 'Jonathan Taylor', slot: 'RB', position: 'RB' }),
    player({ id: 4, name: 'DJ Moore', slot: 'WR', position: 'WR' }),
    player({ id: 5, name: 'Cam Little', slot: 'K', position: 'K' }),
    player({ id: 6, name: 'Los Angeles Rams', slot: 'DEF', position: 'DEF' }),
    player({ id: 7, name: 'Emmanuel Ogbah', slot: 'D LINE', position: 'DL' }),
  ];

  test('pairs by slot key, never by index, and leaves the unfilled side empty', () => {
    const rows = pairStartersBySlot(shortHome, fullAway, STANDARD);
    // 'D LINE' is a slot only the starters carry, so it is appended after the
    // league order rather than dropped.
    expect(rows.map((r) => [r.slot, r.home?.name ?? null, r.away?.name ?? null])).toEqual([
      ['QB', null, 'Trevor Lawrence'],
      ['RB', null, 'Jonathan Taylor'],
      ['WR', "Ja'Marr Chase", 'DJ Moore'],
      ['K', null, 'Cam Little'],
      ['DEF', null, 'Los Angeles Rams'],
      ['D LINE', null, 'Emmanuel Ogbah'],
    ]);
  });

  test('pairs the nth starter of a multi-count slot with the nth on the other side', () => {
    const home = [player({ id: 1, name: 'H RB1', slot: 'RB' }), player({ id: 2, name: 'H RB2', slot: 'RB' })];
    const away = [player({ id: 3, name: 'A RB1', slot: 'RB' })];
    expect(pairStartersBySlot(home, away, ['RB']).map((r) => [r.slot, r.home?.name ?? null, r.away?.name ?? null])).toEqual([
      ['RB', 'H RB1', 'A RB1'],
      ['RB', 'H RB2', null],
    ]);
  });

  test('follows the league slotOrder when given, then appends slots only the starters know about', () => {
    const rows = pairStartersBySlot(shortHome, fullAway, ['QB', 'RB', 'WR', 'D LINE', 'K', 'DEF']);
    expect(rows.map((r) => r.slot)).toEqual(['QB', 'RB', 'WR', 'D LINE', 'K', 'DEF']);
    const extra = pairStartersBySlot([player({ id: 9, name: 'Flex Guy', slot: 'IDP FLEX' })], [], ['QB']);
    expect(extra.map((r) => r.slot)).toEqual(['IDP FLEX']);
  });

  test('under an IDP slot order places defensive starters on their own rows, in order', () => {
    // An IDP league carries defensive slots the fantasy-standard default never
    // knew; they must land on their own rows in the commissioner's order, not
    // sink to the end or share an offensive row.
    const idpOrder = ['QB', 'RB', 'WR', 'DL', 'LB', 'DB'];
    const home = [
      player({ id: 1, name: 'Josh Allen', slot: 'QB' }),
      player({ id: 2, name: 'Myles Garrett', slot: 'DL', position: 'DL' }),
      player({ id: 3, name: 'Fred Warner', slot: 'LB', position: 'LB' }),
      player({ id: 4, name: 'Derwin James', slot: 'DB', position: 'DB' }),
    ];
    const away = [
      player({ id: 5, name: 'Micah Parsons', slot: 'DL', position: 'DL' }),
      player({ id: 6, name: 'Roquan Smith', slot: 'LB', position: 'LB' }),
    ];
    const rows = pairStartersBySlot(home, away, idpOrder);
    expect(rows.map((r) => [r.slot, r.home?.name ?? null, r.away?.name ?? null])).toEqual([
      ['QB', 'Josh Allen', null],
      ['DL', 'Myles Garrett', 'Micah Parsons'],
      ['LB', 'Fred Warner', 'Roquan Smith'],
      ['DB', 'Derwin James', null],
    ]);
  });

  test('pairing with no slot order is refused and returns no rows', () => {
    // Red-tell (AC1): reinstating a default order inside the pairing function
    // turns THIS case red and no other - every other case passes an explicit
    // order, so a default would change only the refusal.
    expect(pairStartersBySlot(shortHome, fullAway)).toEqual([]);
    expect(pairStartersBySlot(shortHome, fullAway, [])).toEqual([]);
    expect(pairStartersBySlot(shortHome, fullAway, null)).toEqual([]);
    expect(pairStartersBySlot(shortHome, fullAway, [null, undefined])).toEqual([]);
  });
});

// #1207 (part of #1198): `locked` as an exported fact (LineupScreen.jsx's
// `entry.locked` reads at :188-202), a plain read of the wire's own boolean -
// CONTEXT.md's Lineup lock is the player's own game's kickoff, decided
// server-side; this fact never recomputes it.
describe('locked: the wire boolean, read as a fact', () => {
  test('an entry whose game has kicked off (locked: true on the wire) is locked', () => {
    expect(locked({ locked: true })).toBe(true);
  });

  test('the same entry with locked: false on the wire is not locked', () => {
    expect(locked({ locked: false })).toBe(false);
  });

  test('a missing locked key reads as not locked, and a null entry does not throw', () => {
    expect(locked({})).toBe(false);
    expect(locked(null)).toBe(false);
  });
});

// #1207 (part of #1198): `eligibleSlots` as an exported fact, mirroring
// LineupScreen.jsx's slotEligiblePositions/isEligibleForSlot (:65-79) minus
// the drag-and-drop swap intent (canResolveLockedIrStash's locked-IR-to-BENCH
// exception, which belongs to the swap interaction, not this fact).
describe('eligibleSlots: every slot key a player may occupy right now', () => {
  const league = {
    roster_slots: [
      { key: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'RB', count: 2, eligiblePositions: ['RB'] },
      { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
      { key: 'DL', count: 1, eligiblePositions: ['DL'] },
    ],
  };

  test('a healthy player is eligible for BENCH and every configured slot naming his position', () => {
    expect(eligibleSlots({ position: 'RB', injuryStatus: null }, league)).toEqual(['BENCH', 'RB', 'FLEX']);
  });

  test('a group key (DL) expands to every specific position Tank01 reports in that group', () => {
    expect(eligibleSlots({ position: 'DE', injuryStatus: null }, league)).toEqual(['BENCH', 'DL']);
  });

  // Red-tell: dropping the IR_ELIGIBLE_DESIGNATIONS check would make IR
  // eligibility fall through to slotEligiblePositions, which never names 'IR'
  // in eligiblePositions, so IR would silently disappear for every player.
  test('a player carrying an IR-eligible injury designation (O or IR) is also eligible for IR', () => {
    expect(eligibleSlots({ position: 'RB', injuryStatus: 'O' }, league)).toEqual(['BENCH', 'IR', 'RB', 'FLEX']);
    expect(eligibleSlots({ position: 'RB', injuryStatus: 'IR' }, league)).toEqual(['BENCH', 'IR', 'RB', 'FLEX']);
  });

  test('a Questionable or Doubtful player is not IR-eligible (only O/IR qualify)', () => {
    expect(eligibleSlots({ position: 'RB', injuryStatus: 'Q' }, league)).toEqual(['BENCH', 'RB', 'FLEX']);
    expect(eligibleSlots({ position: 'RB', injuryStatus: 'D' }, league)).toEqual(['BENCH', 'RB', 'FLEX']);
  });

  test('a position no configured slot names is eligible for BENCH alone', () => {
    expect(eligibleSlots({ position: 'K', injuryStatus: null }, league)).toEqual(['BENCH']);
  });
});

// #1207 (part of #1198): `lineupEntries(rosterWire, league)` normalizes the
// roster wire once into the entry shape a future lineup surface will read
// (playerId, slot, slotIndex, eligibleSlots, locked, availability,
// projectedPoints, ...). Nothing consumes it yet (an expand step); these are
// the red-tells the ticket names.
describe('lineupEntries: normalized roster rows, ordered by the league', () => {
  const league = {
    roster_slots: [
      { key: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'TE', count: 1, eligiblePositions: ['TE'] },
      { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
    ],
  };

  test('a missing league.roster_slots throws rather than falling back to a default order', () => {
    expect(() => lineupEntries([row({ id: 1, slot: 'QB' })], null)).toThrow(/roster_slots/);
    expect(() => lineupEntries([row({ id: 1, slot: 'QB' })], {})).toThrow(/roster_slots/);
    expect(() => lineupEntries([row({ id: 1, slot: 'QB' })], { roster_slots: [] })).toThrow(/roster_slots/);
  });

  // Red-tell (AC): a League ordering FLEX before TE yields entries in that
  // order; the old fantasy-standard default order (never used here at all)
  // would put TE first.
  test('entries come back ordered by the league own roster_slots order, not a default', () => {
    const flexBeforeTe = {
      roster_slots: [
        { key: 'QB', count: 1, eligiblePositions: ['QB'] },
        { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
        { key: 'TE', count: 1, eligiblePositions: ['TE'] },
      ],
    };
    const entries = lineupEntries(
      [
        row({ id: 1, name: 'A TE', slot: 'TE', position: 'TE' }),
        row({ id: 2, name: 'A FLEX', slot: 'FLEX', position: 'WR' }),
        row({ id: 3, name: 'A QB', slot: 'QB', position: 'QB' }),
      ],
      flexBeforeTe
    );
    expect(entries.map((e) => e.slot)).toEqual(['QB', 'FLEX', 'TE']);
    expect(entries.map((e) => e.slotIndex)).toEqual([0, 1, 2]);
  });

  test('a slot the league order does not name (BENCH) is appended after the ordered slots', () => {
    const entries = lineupEntries(
      [
        row({ id: 1, name: 'Benched', slot: 'BENCH', position: 'RB' }),
        row({ id: 2, name: 'A TE', slot: 'TE', position: 'TE' }),
        row({ id: 3, name: 'A QB', slot: 'QB', position: 'QB' }),
      ],
      league
    );
    expect(entries.map((e) => e.slot)).toEqual(['QB', 'TE', 'BENCH']);
  });

  // Red-tell (AC): a starter whose game has kicked off (locked: true on the
  // wire) is locked; the same entry with locked: false is not.
  test('locked reflects the wire boolean per entry', () => {
    const entries = lineupEntries(
      [
        row({ id: 1, slot: 'QB', locked: true }),
        row({ id: 2, name: 'Not locked', slot: 'TE', locked: false }),
      ],
      league
    );
    expect(entries.find((e) => e.playerId === 1).locked).toBe(true);
    expect(entries.find((e) => e.playerId === 2).locked).toBe(false);
  });

  test('availability reports the reason code alone, no label', () => {
    const entries = lineupEntries(
      [
        row({ id: 1, slot: 'QB', onBye: true }),
        row({ id: 2, name: 'Out', slot: 'TE', injury_status: 'O', onBye: false }),
        row({ id: 3, name: 'IR-eligible', slot: 'FLEX', position: 'RB', injury_status: 'IR', onBye: false }),
        row({ id: 4, name: 'Healthy', slot: 'FLEX', position: 'WR', injury_status: null, onBye: false }),
      ],
      league
    );
    const byId = (id) => entries.find((e) => e.playerId === id);
    expect(byId(1).availability).toEqual({ available: false, reason: 'bye' });
    expect(byId(2).availability).toEqual({ available: false, reason: 'out' });
    expect(byId(3).availability).toEqual({ available: false, reason: 'ir' });
    expect(byId(4).availability).toEqual({ available: true, reason: null });
  });

  test('each entry carries its own eligibleSlots, computed the same way the standalone fact does', () => {
    const entries = lineupEntries([row({ id: 1, slot: 'QB', position: 'QB' })], league);
    expect(entries[0].eligibleSlots).toEqual(eligibleSlots({ position: 'QB', injuryStatus: null }, league));
  });

  test('projectedPoints, name, nflTeam and opponent carry through as lineupModel already coerces them', () => {
    const entries = lineupEntries(
      [row({ id: 1, name: 'Josh Allen', nfl_team: 'BUF', slot: 'QB', projected_points: '24.30', opponent: 'MIA' })],
      league
    );
    expect(entries[0]).toMatchObject({
      playerId: 1,
      name: 'Josh Allen',
      nflTeam: 'BUF',
      projectedPoints: 24.3,
      opponent: 'MIA',
    });
  });
});
