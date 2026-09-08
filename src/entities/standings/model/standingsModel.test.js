import {
  teamStandingFromRow,
  standingsFromResponse,
  recordsByTeamId,
  findTeamStanding,
} from './standingsModel';

// A standings row exactly as GET /api/scoring/league/:id/standings delivers it
// (season.service.js computeStandings, decorated with playoffSeed by
// scoring.router.js).
const wireRow = {
  teamId: 10,
  name: 'RAW COLUMN NAME',
  wins: 3,
  losses: 1,
  ties: 0,
  pf: 412.55,
  pa: 388.1,
  rank: 2,
  streak: 'W3',
  winPct: 0.75,
  playoffSeed: 2,
};

describe('teamStandingFromRow: one Team standing, the record computed once', () => {
  test('a wire row becomes the one per-Team shape', () => {
    expect(teamStandingFromRow(wireRow, 0)).toEqual({
      teamId: 10,
      rank: 2,
      position: 1,
      wins: 3,
      losses: 1,
      ties: 0,
      gamesPlayed: 4,
      record: '3-1',
      pointsFor: 412.55,
      pointsAgainst: 388.1,
      streak: 'W3',
      winPct: 0.75,
      playoffSeed: 2,
    });
  });

  // The four record cases the spec (#942) names, as one table. Plain calls, no
  // render. The tie count is never printed as zero (CONTEXT.md, Record).
  test.each([
    ['a tie-less Team drops the tie part', { wins: 3, losses: 1, ties: 0 }, '3-1', 4],
    ['a Team with ties prints all three parts', { wins: 3, losses: 1, ties: 2 }, '3-1-2', 6],
    ['a missing count reads as zero', { wins: 3, losses: 1 }, '3-1', 4],
    ['a Team with no games played still has a record', { wins: 0, losses: 0, ties: 0 }, '0-0', 0],
  ])('%s', (_label, counts, record, gamesPlayed) => {
    const standing = teamStandingFromRow({ teamId: 1, ...counts });
    expect(standing.record).toBe(record);
    expect(standing.gamesPlayed).toBe(gamesPlayed);
  });

  test('a row with no server rank falls back to its position in the order', () => {
    expect(teamStandingFromRow({ teamId: 1 }, 4).rank).toBe(5);
    expect(teamStandingFromRow({ teamId: 1 }, 4).position).toBe(5);
  });

  test('a null row is total: zeroed counts, no Team id', () => {
    expect(teamStandingFromRow(null, 0)).toMatchObject({ teamId: null, record: '0-0', gamesPlayed: 0 });
  });
});

describe('standingsFromResponse: the read as the client knows it', () => {
  test('rows in the server order, with the bracket size beside them', () => {
    const { rows, playoffTeams } = standingsFromResponse({
      league: { current_week: 6, playoff_teams: 6 },
      standings: [wireRow, { teamId: 20, wins: 1, losses: 3, ties: 1, pf: 300, pa: 400 }],
    });
    expect(rows.map((r) => r.record)).toEqual(['3-1', '1-3-1']);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(playoffTeams).toBe(6);
  });

  test('a body with no standings is an empty table, not a throw', () => {
    expect(standingsFromResponse(undefined)).toEqual({ rows: [], playoffTeams: null });
    expect(standingsFromResponse({ standings: 'nope' }).rows).toEqual([]);
  });
});

describe('recordsByTeamId / findTeamStanding: the lookups the surfaces read', () => {
  test('a record lookup keyed by Team id, skipping rows with no id', () => {
    const map = recordsByTeamId([
      { teamId: 1, wins: 3, losses: 1, ties: 0 },
      { teamId: 2, wins: '1', losses: '2', ties: '1' },
      { teamId: null, wins: 9, losses: 9 },
      null,
    ]);
    expect(map.get(1)).toBe('3-1');
    expect(map.get(2)).toBe('1-2-1');
    expect(map.size).toBe(2);
    expect(recordsByTeamId(undefined).size).toBe(0);
  });

  test('a Team standing is found by Team id, and a miss is null', () => {
    const { rows } = standingsFromResponse({ standings: [wireRow] });
    expect(findTeamStanding(rows, 10)).toMatchObject({ record: '3-1' });
    expect(findTeamStanding(rows, 999)).toBeNull();
    expect(findTeamStanding(rows, null)).toBeNull();
  });
});
