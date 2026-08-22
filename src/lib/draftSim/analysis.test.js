import {
  draftPickValue, gradeTeams, gradeDraftValues, optimalLineup, stealReachThreshold,
  pickValues, overallGrade, positionBalance, byeStacking, rosterConstruction,
  benchQuality, analyzeDraft, applyGradeCap,
} from './analysis';
import { createSimDraft, applyPick, teamOnClock } from './engine';
import { cpuPick } from './cpuBrain';
import { mulberry32 } from './rng';
import { buildPool, tinyPool } from './simFixtures';
import { templateFor } from './templates';

const NOW = 1_800_000_000_000;

function sim(overrides = {}, players = buildPool()) {
  return createSimDraft(
    { totalTeams: 10, userSlot: 1, leagueType: 'standard', clockSeconds: 0, ...overrides },
    players,
    { now: NOW, seed: 2024 }
  );
}

function autoDraft(state, seed = 7) {
  const rng = mulberry32(seed);
  let current = state;
  while (current.status === 'active') {
    const id = cpuPick(current, teamOnClock(current).id, rng);
    if (id == null) break;
    current = applyPick(current, { playerId: id, now: NOW });
  }
  return current;
}

/** Hand-stitch a roster onto team 1 so a check can be tested in isolation. */
function withUserPicks(state, playerIds) {
  return {
    ...state,
    picks: playerIds.map((playerId, i) => ({
      pickNumber: 1 + i * state.teams.length, teamId: 1, playerId, auto: false,
    })),
  };
}

describe('draftPickValue (parity with draftgrade.service.js)', () => {
  // The server's own documented vectors: "a player taken at 45 with ADP 12 is
  // -33 (a steal), while a player taken at 10 with ADP 80 is +70 (a reach)".
  it('reproduces the server\'s documented steal and reach examples', () => {
    expect(draftPickValue({ pickNumber: 45, marketAdp: 12 })).toEqual({
      marketAdp: 12, draftValueScore: -33, adpFallback: false,
    });
    expect(draftPickValue({ pickNumber: 10, marketAdp: 80 })).toEqual({
      marketAdp: 80, draftValueScore: 70, adpFallback: false,
    });
  });

  it('is neutral at the actual pick when there is no market ADP', () => {
    for (const missing of [null, undefined, 0, -3, 'abc']) {
      expect(draftPickValue({ pickNumber: 24, marketAdp: missing })).toEqual({
        marketAdp: 24, draftValueScore: 0, adpFallback: true,
      });
    }
  });

  it('rounds to two decimals like the server', () => {
    expect(draftPickValue({ pickNumber: 10, marketAdp: 12.345 }).draftValueScore).toBe(2.35);
  });
});

describe('gradeTeams (parity with draftgrade.service.js)', () => {
  it('applies the [1.0, 0.33, -0.33, -1.0] z-score matrix', () => {
    const rows = gradeTeams([
      { teamId: 1, name: 'A', rosterValue: 200 },
      { teamId: 2, name: 'B', rosterValue: 150 },
      { teamId: 3, name: 'C', rosterValue: 150 },
      { teamId: 4, name: 'D', rosterValue: 100 },
    ]);
    expect(rows.map((r) => r.grade)).toEqual(['A', 'C', 'C', 'F']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('grades everyone B when the spread is zero', () => {
    const rows = gradeTeams([
      { teamId: 1, name: 'A', rosterValue: 100 },
      { teamId: 2, name: 'B', rosterValue: 100 },
    ]);
    expect(rows.map((r) => r.grade)).toEqual(['B', 'B']);
  });

  it('breaks exact ties by team id, deterministically', () => {
    const rows = gradeTeams([
      { teamId: 9, name: 'Late', rosterValue: 100 },
      { teamId: 2, name: 'Early', rosterValue: 100 },
    ]);
    expect(rows.map((r) => r.teamId)).toEqual([2, 9]);
  });

  it('returns nothing for no teams', () => {
    expect(gradeTeams([])).toEqual([]);
  });
});

describe('gradeDraftValues (parity with draftgrade.service.js)', () => {
  it('negates the cumulative delta, so more steals means a better grade', () => {
    const rows = gradeDraftValues([
      { teamId: 1, name: 'Steals', rosterValue: 100, draftValueScore: -40 },
      { teamId: 2, name: 'Even', rosterValue: 100, draftValueScore: 0 },
      { teamId: 3, name: 'Reaches', rosterValue: 100, draftValueScore: 40 },
    ]);
    expect(rows[0].teamId).toBe(1);
    expect(rows[0].grade).toBe('A');
    expect(rows[2].teamId).toBe(3);
    expect(rows[2].grade).toBe('F');
    // The original roster value survives the grading round-trip.
    expect(rows[0].rosterValue).toBe(100);
  });
});

describe('optimalLineup (parity with lineup.service.js)', () => {
  const slots = templateFor('standard').slots;

  it('fills the most-restrictive slot first, so FLEX gets the leftover', () => {
    const players = [
      { playerId: 1, position: 'RB' },
      { playerId: 2, position: 'RB' },
      { playerId: 3, position: 'RB' },
      { playerId: 4, position: 'WR' },
      { playerId: 5, position: 'WR' },
      { playerId: 6, position: 'QB' },
      { playerId: 7, position: 'TE' },
    ];
    const points = new Map(players.map((p) => [p.playerId, 100 - p.playerId]));
    const { starters, total } = optimalLineup(players, slots, points);
    const flex = starters.find((s) => s.slot === 'FLEX');
    expect(flex.playerId).toBe(3); // third-best RB lands in FLEX
    expect(total).toBe(starters.reduce((s, x) => s + x.points, 0));
  });

  it('leaves a slot empty rather than starting an ineligible player', () => {
    const { starters } = optimalLineup([{ playerId: 1, position: 'RB' }], slots, new Map([[1, 10]]));
    expect(starters.map((s) => s.slot)).toEqual(['RB']);
  });

  it('treats a missing projection as zero, never NaN', () => {
    const { total } = optimalLineup([{ playerId: 1, position: 'QB' }], slots, new Map());
    expect(total).toBe(0);
  });
});

describe('stealReachThreshold', () => {
  it('widens with the round', () => {
    expect(stealReachThreshold(1)).toBe(7.5);
    expect(stealReachThreshold(10)).toBe(21);
  });
});

describe('pickValues', () => {
  it('labels a big fall a steal and a big jump a reach, scaled by round', () => {
    const base = sim({ totalTeams: 10 }, tinyPool());
    // Pick 1 takes the player whose ADP is 8: +7 vs. a round-1 threshold of 7.5
    // is NOT a reach; pick 1 taking the ADP-150 defense certainly is.
    const nearMiss = { ...base, picks: [{ pickNumber: 1, teamId: 1, playerId: 8, auto: false }] };
    expect(pickValues(nearMiss)[0].label).toBe('value');

    const reach = { ...base, picks: [{ pickNumber: 1, teamId: 1, playerId: 10, auto: false }] };
    expect(pickValues(reach)[0].label).toBe('reach');
    expect(pickValues(reach)[0].draftValueScore).toBe(149);

    const steal = { ...base, picks: [{ pickNumber: 20, teamId: 1, playerId: 1, auto: false }] };
    expect(pickValues(steal)[0].label).toBe('steal');
    expect(pickValues(steal)[0].draftValueScore).toBe(-19);
  });

  it('labels a market-less pick no-market and never a steal or a reach', () => {
    const players = [
      { playerId: 500, name: 'Star Backer', position: 'LB', nflTeam: 'KC', adp: null, positionRank: 1, projectedPoints: 200, byeWeek: 6 },
      ...tinyPool(),
    ];
    const base = sim({ totalTeams: 10, leagueType: 'idp' }, players);
    const state = { ...base, picks: [{ pickNumber: 1, teamId: 1, playerId: 500, auto: false }] };
    const [row] = pickValues(state);
    expect(row.label).toBe('no-market');
    expect(row.adpFallback).toBe(true);
    expect(row.draftValueScore).toBe(0);
  });

  it('carries the display fields the report table needs', () => {
    const base = sim({ totalTeams: 10 }, tinyPool());
    const state = { ...base, picks: [{ pickNumber: 1, teamId: 1, playerId: 1, auto: true }] };
    expect(pickValues(state)[0]).toMatchObject({
      round: 1, teamName: 'You', isUser: true, auto: true,
      name: 'Ace Back', position: 'RB', nflTeam: 'KC', byeWeek: 6,
    });
  });
});

describe('overallGrade', () => {
  const finished = autoDraft(sim());

  it('grades and ranks every team', () => {
    const rows = overallGrade(finished);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const row of rows) {
      expect('ABCDF').toContain(row.grade);
      expect(Number.isFinite(row.rosterValue)).toBe(true);
      expect(Number.isFinite(row.starterPoints)).toBe(true);
    }
  });

  it('weights the bench at a quarter, matching the server roster value', () => {
    const rows = overallGrade(finished);
    for (const row of rows) {
      expect(row.rosterValue).toBeCloseTo(row.starterPoints + 0.25 * row.benchPoints, 1);
    }
  });
});

describe('positionBalance', () => {
  it('flags a position below its dedicated starting requirement as critical', () => {
    const state = withUserPicks(sim({ totalTeams: 10 }, tinyPool()), [1, 2]); // one RB, one WR
    const rows = positionBalance(state, 1);
    const byPosition = Object.fromEntries(rows.map((r) => [r.position, r]));
    expect(byPosition.QB).toMatchObject({ count: 0, min: 1, status: 'critical' });
    expect(byPosition.RB).toMatchObject({ count: 1, min: 2, status: 'critical' });
    expect(byPosition.WR).toMatchObject({ count: 1, min: 2, status: 'critical' });
  });

  it('flags going past the max as a warning, not a failure', () => {
    // Six kickers: capacity 1 + tolerance 0 -> max 1.
    const players = Array.from({ length: 6 }, (_, i) => ({
      playerId: 900 + i, name: `K${i}`, position: 'K', nflTeam: 'KC', adp: 140 + i,
      positionRank: i + 1, projectedPoints: 120, byeWeek: 6,
    }));
    const state = withUserPicks(sim({ totalTeams: 10 }, players), players.map((p) => p.playerId));
    const kicker = positionBalance(state, 1).find((r) => r.position === 'K');
    expect(kicker).toMatchObject({ count: 6, max: 1, status: 'warn' });
  });

  it('adds DL/LB/DB rows only in an IDP league', () => {
    const standard = positionBalance(sim({ totalTeams: 10 }, tinyPool()), 1).map((r) => r.position);
    expect(standard).toEqual(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    const idp = positionBalance(sim({ totalTeams: 10, leagueType: 'idp' }, buildPool({ idp: true })), 1)
      .map((r) => r.position);
    expect(idp).toEqual(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']);
  });
});

describe('byeStacking', () => {
  function stackedPool(byeWeek, count) {
    return Array.from({ length: count }, (_, i) => ({
      playerId: 700 + i,
      name: `Stack ${i}`,
      position: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'][i % 6],
      nflTeam: 'KC',
      adp: i + 1,
      positionRank: i + 1,
      projectedPoints: 200 - i,
      byeWeek,
    }));
  }

  it('says nothing about two shared byes', () => {
    const players = stackedPool(8, 2);
    const state = withUserPicks(sim({ totalTeams: 10 }, players), players.map((p) => p.playerId));
    expect(byeStacking(state, 1)).toEqual([]);
  });

  it('warns at three starters and escalates to critical at four', () => {
    const three = stackedPool(8, 3);
    const threeState = withUserPicks(sim({ totalTeams: 10 }, three), three.map((p) => p.playerId));
    expect(byeStacking(threeState, 1)[0]).toMatchObject({ week: 8, count: 3, severity: 'warn' });

    const four = stackedPool(8, 4);
    const fourState = withUserPicks(sim({ totalTeams: 10 }, four), four.map((p) => p.playerId));
    expect(byeStacking(fourState, 1)[0]).toMatchObject({ week: 8, count: 4, severity: 'critical' });
  });

  it('ignores bench byes — only starters cost you a week', () => {
    // Six kickers all on the same bye: only one can start.
    const players = Array.from({ length: 6 }, (_, i) => ({
      playerId: 800 + i, name: `K${i}`, position: 'K', nflTeam: 'KC',
      adp: 140 + i, positionRank: i + 1, projectedPoints: 120, byeWeek: 11,
    }));
    const state = withUserPicks(sim({ totalTeams: 10 }, players), players.map((p) => p.playerId));
    expect(byeStacking(state, 1)).toEqual([]);
  });
});

describe('rosterConstruction', () => {
  function issueIds(state) {
    return rosterConstruction(state, 1).map((i) => i.id);
  }

  it('every issue carries a severity, a title, a detail and a suggestion', () => {
    const state = withUserPicks(sim({ totalTeams: 10 }, tinyPool()), [9, 10]);
    for (const issue of rosterConstruction(state, 1)) {
      expect(issue.id).toBeTruthy();
      expect(['critical', 'warn', 'info']).toContain(issue.severity);
      expect(issue.title.length).toBeGreaterThan(0);
      expect(issue.detail.length).toBeGreaterThan(0);
      expect(issue.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('sorts critical before warn before info', () => {
    const state = withUserPicks(sim({ totalTeams: 10 }, tinyPool()), [3, 9, 10]);
    const severities = rosterConstruction(state, 1).map((i) => i.severity);
    const order = { critical: 0, warn: 1, info: 2 };
    expect(severities.map((s) => order[s])).toEqual([...severities.map((s) => order[s])].sort());
  });

  it('flags an early kicker and an early defense', () => {
    const state = withUserPicks(sim({ totalTeams: 10 }, tinyPool()), [9, 10]);
    expect(issueIds(state)).toEqual(expect.arrayContaining(['early-kicker', 'early-def']));
  });

  it('does not flag a kicker taken in the last two rounds', () => {
    const base = sim({ totalTeams: 10 }, tinyPool());
    const state = {
      ...base,
      picks: [{ pickNumber: 141, teamId: 1, playerId: 9, auto: false }], // round 15
    };
    expect(issueIds(state)).not.toContain('early-kicker');
  });

  it('flags an early QB in a one-QB league but not in superflex', () => {
    const oneQb = withUserPicks(sim({ totalTeams: 10 }, tinyPool()), [3]);
    expect(issueIds(oneQb)).toContain('early-qb');

    const superflex = withUserPicks(
      sim({ totalTeams: 10, leagueType: 'superflex' }, tinyPool()), [3]
    );
    expect(issueIds(superflex)).not.toContain('early-qb');
  });

  it('flags fewer than two running backs through six rounds', () => {
    const base = sim({ totalTeams: 10 }, tinyPool());
    const state = {
      ...base,
      picks: [2, 3, 5, 6, 7, 4].map((playerId, i) => ({
        pickNumber: 1 + i * 10, teamId: 1, playerId, auto: false,
      })),
    };
    // Only one RB (playerId 4) in the first six rounds.
    expect(issueIds(state)).toContain('late-rb');
  });

  it('flags no bench depth at RB or WR', () => {
    // Exactly two RB and two WR: every one of them starts.
    const state = withUserPicks(sim({ totalTeams: 10 }, tinyPool()), [1, 4, 2, 5]);
    const issue = rosterConstruction(state, 1).find((i) => i.id === 'no-depth');
    expect(issue).toBeTruthy();
    expect(issue.title).toContain('RB');
  });

  it('flags over-investing at tight end', () => {
    const players = Array.from({ length: 3 }, (_, i) => ({
      playerId: 600 + i, name: `TE${i}`, position: 'TE', nflTeam: 'KC',
      adp: 30 + i, positionRank: i + 1, projectedPoints: 180 - i, byeWeek: 6 + i,
    }));
    const state = withUserPicks(sim({ totalTeams: 10 }, players), players.map((p) => p.playerId));
    expect(issueIds(state)).toContain('te-overinvest');
  });

  it('says nothing alarming about a complete, well-built roster', () => {
    const finished = autoDraft(sim());
    const critical = rosterConstruction(finished, 1).filter((i) => i.severity === 'critical');
    expect(critical.map((i) => i.id)).toEqual([]);
  });
});

describe('benchQuality', () => {
  const rows = [
    { teamId: 1, benchPoints: 300 },
    { teamId: 2, benchPoints: 200 },
    { teamId: 3, benchPoints: 100 },
  ];

  it('scores the user bench against the league', () => {
    expect(benchQuality(rows, 1)).toMatchObject({ benchPoints: 300, leagueMean: 200, label: 'among the best in the league' });
    expect(benchQuality(rows, 3).label).toBe('the thinnest in the league');
    expect(benchQuality(rows, 2).label).toBe('about average');
  });

  it('does not divide by zero when every bench is identical', () => {
    const flat = [{ teamId: 1, benchPoints: 50 }, { teamId: 2, benchPoints: 50 }];
    expect(benchQuality(flat, 1)).toMatchObject({ z: 0, stddev: 0, label: 'about average' });
  });

  it('returns null for a team that is not in the league', () => {
    expect(benchQuality(rows, 99)).toBeNull();
  });
});

describe('applyGradeCap', () => {
  const critical = [{ id: 'unfilled-QB', severity: 'critical' }];
  const warns = [{ id: 'late-rb', severity: 'warn' }, { id: 'early-qb', severity: 'info' }];

  it('caps A and B to C when any critical issue exists', () => {
    expect(applyGradeCap('A', critical)).toEqual({ grade: 'C', valueGrade: 'A', capped: true, criticalCount: 1 });
    expect(applyGradeCap('B', critical)).toEqual({ grade: 'C', valueGrade: 'B', capped: true, criticalCount: 1 });
  });

  it('leaves C, D and F alone — the cap never raises a grade', () => {
    expect(applyGradeCap('C', critical).grade).toBe('C');
    expect(applyGradeCap('C', critical).capped).toBe(false);
    expect(applyGradeCap('D', critical).grade).toBe('D');
    expect(applyGradeCap('F', critical).grade).toBe('F');
  });

  it('does nothing without criticals, whatever else is flagged', () => {
    expect(applyGradeCap('A', warns)).toEqual({ grade: 'A', valueGrade: 'A', capped: false, criticalCount: 0 });
    expect(applyGradeCap('A', [])).toEqual({ grade: 'A', valueGrade: 'A', capped: false, criticalCount: 0 });
  });

  it('counts every critical for the report subtitle', () => {
    const three = [
      { severity: 'critical' }, { severity: 'critical' }, { severity: 'critical' }, { severity: 'warn' },
    ];
    expect(applyGradeCap('A', three).criticalCount).toBe(3);
  });
});

describe('analyzeDraft', () => {
  const report = analyzeDraft(autoDraft(sim({ totalTeams: 10, userSlot: 4 })));

  it('returns the full report contract', () => {
    expect(Object.keys(report).sort()).toEqual([
      'allPicks', 'criticalCount', 'grade', 'gradeCapped', 'issues', 'picks',
      'positionBalance', 'rank', 'teamCount', 'teams', 'valueGrade', 'totals',
    ].sort());
    expect('ABCDF').toContain(report.grade);
    expect(report.rank).toBeGreaterThanOrEqual(1);
    expect(report.rank).toBeLessThanOrEqual(10);
    expect(report.teamCount).toBe(10);
  });

  it('caps the letter grade at C while critical roster gaps exist', () => {
    // A CPU-run draft fills every dedicated slot, so no criticals and no cap.
    expect(report.criticalCount).toBe(0);
    expect(report.gradeCapped).toBe(false);
    expect(report.grade).toBe(report.valueGrade);
  });

  it('reports only the user\'s picks in picks[] and all of them in allPicks[]', () => {
    expect(report.picks).toHaveLength(15);
    expect(report.picks.every((p) => p.isUser)).toBe(true);
    expect(report.allPicks).toHaveLength(150);
  });

  it('counts steals and reaches without counting market-less picks', () => {
    const { steals, reaches, noMarket } = report.totals;
    expect(steals + reaches + noMarket).toBeLessThanOrEqual(report.picks.length);
    expect(report.picks.filter((p) => p.label === 'steal')).toHaveLength(steals);
  });

  it('includes a bench-quality read', () => {
    expect(report.totals.benchQuality.label).toEqual(expect.any(String));
  });
});
