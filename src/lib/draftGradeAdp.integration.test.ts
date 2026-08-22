/** @jest-environment node */

jest.mock('../../server/modules/pool', () => ({ query: jest.fn() }));
jest.mock('../../server/services/projection.service', () => ({
  getWeekProjections: jest.fn(),
}));

const fixture = require('./fixtures/completed-15-round-draft.json');
const pool = require('../../server/modules/pool');
const { getWeekProjections } = require('../../server/services/projection.service');
const { normalizeAdpEntry, buildAdpUpdates } = require('../../server/services/adp.service');
const {
  draftPickValue,
  getOrComputeDraftGrades,
  gradeDraftValues,
} = require('../../server/services/draftgrade.service');

type FixturePick = {
  pickNumber: number;
  teamId: number;
  playerId: number;
  name: string;
  position: string;
};

const picks: FixturePick[] = fixture.picks;
const teamsById = new Map(fixture.teams.map((team: { id: number; name: string }) => [team.id, team]));

function marketRows() {
  return picks.map((pick) => ({
    name: pick.name,
    position: pick.position,
    adp: String(fixture.marketAdpByPlayer[pick.playerId]),
  }));
}

function databasePickRows() {
  return picks.map((pick) => ({
    team_id: pick.teamId,
    player_id: pick.playerId,
    pick_number: pick.pickNumber,
    position: pick.position,
    team_name: teamsById.get(pick.teamId).name,
    adp: pick.playerId === 10044 ? null : fixture.marketAdpByPlayer[pick.playerId],
  }));
}

beforeEach(() => {
  pool.query.mockReset();
  getWeekProjections.mockReset();
});

test('the fixture is a complete three-team, 15-round draft matrix', () => {
  expect(fixture.league.rounds).toBe(15);
  expect(picks).toHaveLength(fixture.league.rounds * fixture.league.teamCount);
  expect(picks.map((pick) => pick.pickNumber)).toEqual(
    Array.from({ length: 45 }, (_, index) => index + 1)
  );
  for (const team of fixture.teams) {
    expect(picks.filter((pick) => pick.teamId === team.id)).toHaveLength(15);
  }
});

test('market ADP strings normalize and match every drafted player without live HTTP', () => {
  const normalized = marketRows().map(normalizeAdpEntry);
  expect(normalized).not.toContain(null);

  const updates = buildAdpUpdates(
    picks.map(({ playerId: id, name, position }) => ({ id, name, position })),
    normalized
  );
  expect(updates).toHaveLength(45);
  expect(updates).toContainEqual({ id: 10045, adp: 12 });
  expect(updates).toContainEqual({ id: 10010, adp: 80 });
});

test('pick 45 at ADP 12 is -33 while pick 10 at ADP 80 is a +70 reach', () => {
  const steal = picks.find((pick) => pick.pickNumber === 45)!;
  const reach = picks.find((pick) => pick.pickNumber === 10)!;

  expect(draftPickValue({
    pickNumber: steal.pickNumber,
    marketAdp: fixture.marketAdpByPlayer[steal.playerId],
  })).toMatchObject({ marketAdp: 12, draftValueScore: -33, adpFallback: false });
  expect(draftPickValue({
    pickNumber: reach.pickNumber,
    marketAdp: fixture.marketAdpByPlayer[reach.playerId],
  })).toMatchObject({ marketAdp: 80, draftValueScore: 70, adpFallback: false });
  expect(draftPickValue({ pickNumber: 44, marketAdp: null })).toEqual({
    marketAdp: 44,
    draftValueScore: 0,
    adpFallback: true,
  });
});

test('the A-F matrix gives identical decimal scores identical grades with deterministic ranks', () => {
  const graded = gradeDraftValues(fixture.gradeMatrix.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    rosterValue: 100,
    draftValueScore: team.draftValueScore,
    picks: [],
  })));
  const byId = new Map(graded.map((team) => [team.teamId, team]));

  expect(byId.get(91).grade).toBe('A');
  expect(byId.get(92).grade).toBe('B');
  expect(byId.get(93).grade).toBe('C');
  expect(byId.get(96).grade).toBe('C');
  expect(byId.get(94).grade).toBe('D');
  expect(byId.get(95).grade).toBe('F');
  expect(byId.get(93).draftValueScore).toBe(0.25);
  expect(byId.get(96).draftValueScore).toBe(0.25);
  expect(byId.get(93).rank).toBeLessThan(byId.get(96).rank);
});

test('mathematically equal floating-point composites remain deterministic ties', () => {
  const graded = gradeDraftValues([
    { teamId: 2, name: 'Second', rosterValue: 100, draftValueScore: 0.3, picks: [] },
    { teamId: 1, name: 'First', rosterValue: 100, draftValueScore: 0.1 + 0.2, picks: [] },
  ]);

  expect(graded.map(({ teamId, grade, rank, draftValueScore }) => ({
    teamId,
    grade,
    rank,
    draftValueScore,
  }))).toEqual([
    { teamId: 1, grade: 'B', rank: 1, draftValueScore: 0.3 },
    { teamId: 2, grade: 'B', rank: 2, draftValueScore: 0.3 },
  ]);
});

test('completed-draft grading consumes synced ADP and exposes composite draft value scores', async () => {
  let picksSql = '';
  let cachedPayload: any;
  pool.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT * FROM "leagues"')) {
      return {
        rows: [{
          id: fixture.league.id,
          current_season: fixture.league.season,
          current_week: 1,
          draft_status: 'complete',
          roster_slots: [{
            key: 'FLEX',
            count: 15,
            eligiblePositions: ['QB', 'RB', 'WR', 'TE'],
          }],
        }],
      };
    }
    if (sql.includes('FROM "league_analytics"')) return { rows: [] };
    if (sql.includes('FROM "draft_picks"')) {
      picksSql = sql;
      return { rows: databasePickRows() };
    }
    if (sql.includes('INSERT INTO "league_analytics"')) {
      cachedPayload = JSON.parse(values[2] as string);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected database query: ${sql}`);
  });
  getWeekProjections.mockResolvedValue(
    new Map(picks.map((pick) => [pick.playerId, { points: 10 }]))
  );

  const result = await getOrComputeDraftGrades({ leagueId: fixture.league.id });

  expect(picksSql).toContain('"players"."adp"');
  expect(result.grades).toEqual(expect.arrayContaining([
    expect.objectContaining({ teamId: 83, draftValueScore: -33, grade: 'A' }),
    expect.objectContaining({ teamId: 82, draftValueScore: 0, grade: 'C' }),
    expect.objectContaining({ teamId: 81, draftValueScore: 70, grade: 'F' }),
  ]));
  const fallbackPick = result.grades
    .find((team) => team.teamId === 82)
    .picks.find((pick) => pick.playerId === 10044);
  expect(fallbackPick).toMatchObject({
    pickNumber: 44,
    marketAdp: 44,
    draftValueScore: 0,
    adpFallback: true,
  });
  expect(cachedPayload).toEqual(result);
});
