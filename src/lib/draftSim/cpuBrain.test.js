import {
  effAdp, positionGroupKey, slotCapacityFor, benchToleranceFor, needMultiplier,
  scarcityBonus, kickersAndDefensesOpen, eligibleCandidates, cpuPick,
  CANDIDATE_POOL_SIZE,
} from './cpuBrain';
import { createSimDraft, applyPick, rosterFor, teamOnClock } from './engine';
import { templateFor } from './templates';
import { mulberry32 } from './rng';
import { buildPool, tinyPool } from './simFixtures';

const NOW = 1_800_000_000_000;

function sim(overrides = {}, players = buildPool()) {
  return createSimDraft(
    { totalTeams: 10, userSlot: 1, leagueType: 'standard', clockSeconds: 0, ...overrides },
    players,
    { now: NOW, seed: 2024 }
  );
}

/** Drive the whole draft with the CPU brain, including the user's seat. */
function autoDraft(state, seed = 99) {
  const rng = mulberry32(seed);
  let current = state;
  let guard = 0;
  while (current.status === 'active' && guard < 5000) {
    guard += 1;
    const team = teamOnClock(current);
    const playerId = cpuPick(current, team.id, rng);
    if (playerId == null) break;
    current = applyPick(current, { playerId, now: NOW });
  }
  return current;
}

describe('effAdp', () => {
  it('uses real market ADP when present', () => {
    expect(effAdp({ position: 'RB', adp: 14.5 })).toBe(14.5);
  });

  it('maps individual defenders onto the ADP scale from production rank', () => {
    expect(effAdp({ position: 'LB', adp: null, positionRank: 1 })).toBe(154);
    expect(effAdp({ position: 'CB', adp: null, positionRank: 20 })).toBe(230);
  });

  it('defaults a rankless defender to the middle of the IDP pack', () => {
    expect(effAdp({ position: 'DE', adp: null, positionRank: null })).toBe(150 + 40 * 4);
  });

  it('falls back to projected points for a non-IDP player with no market', () => {
    expect(effAdp({ position: 'WR', adp: null, projectedPoints: 120 })).toBe(280);
    expect(effAdp({ position: 'WR', adp: null, projectedPoints: null })).toBe(400);
  });

  it('treats a zero/negative ADP as missing, like the server does', () => {
    expect(effAdp({ position: 'WR', adp: 0, projectedPoints: 100 })).toBe(300);
  });
});

describe('positionGroupKey (mirror of draft.service.js positionCapGroup)', () => {
  it('collapses specific defensive codes to their group', () => {
    expect(positionGroupKey('DE')).toBe('DL');
    expect(positionGroupKey('CB')).toBe('DB');
    expect(positionGroupKey('OLB')).toBe('LB');
  });

  it('leaves offensive codes alone', () => {
    expect(positionGroupKey('RB')).toBe('RB');
    expect(positionGroupKey('DEF')).toBe('DEF');
  });
});

describe('capacity and bench tolerance', () => {
  it('counts dedicated plus flex-style slots', () => {
    const standard = templateFor('standard');
    expect(slotCapacityFor(standard, 'RB')).toBe(3); // RB2 + FLEX
    expect(slotCapacityFor(standard, 'QB')).toBe(1);
    expect(slotCapacityFor(standard, 'K')).toBe(1);
  });

  it('lets superflex QB demand emerge from the SFLX slot', () => {
    expect(slotCapacityFor(templateFor('superflex'), 'QB')).toBe(2);
  });

  it('allows depth where depth matters and none at K/DEF', () => {
    expect(benchToleranceFor('RB')).toBe(3);
    expect(benchToleranceFor('WR')).toBe(3);
    expect(benchToleranceFor('QB')).toBe(1);
    expect(benchToleranceFor('TE')).toBe(1);
    expect(benchToleranceFor('K')).toBe(0);
    expect(benchToleranceFor('DEF')).toBe(0);
    expect(benchToleranceFor('LB')).toBe(1);
  });
});

describe('needMultiplier', () => {
  function withRoster(positions, leagueType = 'standard') {
    // Give team 1 exactly these positions by hand-stitching picks.
    const players = positions.map((position, i) => ({
      playerId: 1000 + i, name: `P${i}`, position, nflTeam: 'KC', adp: i + 1,
      positionRank: 1, projectedPoints: 100, byeWeek: 6,
    }));
    const base = sim({ leagueType }, [...players, ...buildPool()]);
    return {
      ...base,
      picks: players.map((p, i) => ({ pickNumber: i + 1, teamId: 1, playerId: p.playerId, auto: false })),
    };
  }

  it('boosts a position with nothing on the roster yet', () => {
    expect(needMultiplier(withRoster([]), 1, 'RB')).toBe(1.15);
  });

  it('is neutral while there is still starting room', () => {
    expect(needMultiplier(withRoster(['RB']), 1, 'RB')).toBe(1.0);
    expect(needMultiplier(withRoster(['RB', 'RB']), 1, 'RB')).toBe(1.0);
  });

  it('softens once starters are covered', () => {
    // RB capacity is 3 (RB2 + FLEX).
    expect(needMultiplier(withRoster(['RB', 'RB', 'RB']), 1, 'RB')).toBe(0.9);
  });

  it('heavily penalizes going past the bench tolerance', () => {
    expect(needMultiplier(withRoster(['RB', 'RB', 'RB', 'RB', 'RB', 'RB']), 1, 'RB')).toBe(0.7);
  });

  it('never wants a second kicker', () => {
    expect(needMultiplier(withRoster(['K']), 1, 'K')).toBe(0.7);
  });

  it('still wants a second QB in superflex', () => {
    expect(needMultiplier(withRoster(['QB'], 'superflex'), 1, 'QB')).toBe(1.0);
    expect(needMultiplier(withRoster(['QB'], 'standard'), 1, 'QB')).toBe(0.9);
  });

  it('counts defensive depth at the group level', () => {
    // A DE fills the DL group, so a DT is no longer "nothing rostered".
    expect(needMultiplier(withRoster(['DE'], 'idp'), 1, 'DT')).toBe(0.9);
    expect(needMultiplier(withRoster(['DE'], 'idp'), 1, 'LB')).toBe(1.15);
  });
});

describe('scarcityBonus', () => {
  it('is zero without a cliff and caps at 0.2', () => {
    expect(scarcityBonus(0)).toBe(0);
    expect(scarcityBonus(null)).toBe(0);
    expect(scarcityBonus(-10)).toBe(0);
    expect(scarcityBonus(2.5)).toBe(0.1);
    expect(scarcityBonus(500)).toBe(0.2);
  });
});

describe('eligibleCandidates', () => {
  it('keeps kickers and defenses off the board until the last three rounds', () => {
    const state = sim();
    expect(kickersAndDefensesOpen(state)).toBe(false);
    const pool = eligibleCandidates(state, 2);
    expect(pool.some((p) => p.position === 'K' || p.position === 'DEF')).toBe(false);
  });

  it('opens K/DEF once the round passes rounds - 3', () => {
    const state = { ...sim(), currentPick: 121 }; // round 13 of 15
    expect(kickersAndDefensesOpen(state)).toBe(true);
    expect(eligibleCandidates(state, 2).some((p) => p.position === 'K')).toBe(true);
  });

  it('forces must-fill picks when picks run out, overriding the K/DEF gate', () => {
    // A team in round 5 of a 15-round draft with only one pick left (rounds
    // hacked down) and an empty K and DEF slot may only take a K or a DEF.
    const base = sim({ totalTeams: 4, userSlot: 1 }, tinyPool());
    const state = {
      ...base,
      rounds: 3,
      totalPicks: 12,
      currentPick: 9, // round 3, team 1 on the clock (snake: 9 -> index 3)
      picks: [
        { pickNumber: 1, teamId: 4, playerId: 1, auto: false },
      ],
    };
    // Team 4 has one pick left (pick 9 is team 4 in a 4-team snake round 3).
    const team = teamOnClock(state);
    const pool = eligibleCandidates(state, team.id);
    expect(pool.length).toBeGreaterThan(0);
    // Every candidate fills one of the still-empty dedicated slots.
    expect(pool.every((p) => ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position))).toBe(true);
  });
});

describe('cpuPick', () => {
  it('is deterministic for a seed', () => {
    const state = sim();
    expect(cpuPick(state, 2, mulberry32(5))).toBe(cpuPick(state, 2, mulberry32(5)));
  });

  it('only ever returns an available player', () => {
    let state = sim();
    const rng = mulberry32(11);
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const id = cpuPick(state, teamOnClock(state).id, rng);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      state = applyPick(state, { playerId: id, now: NOW });
    }
  });

  it('picks near the top of the board early (inside the candidate slice)', () => {
    const state = sim();
    const id = cpuPick(state, 1, mulberry32(3));
    const rank = state.players.findIndex((p) => p.playerId === id);
    expect(rank).toBeLessThan(CANDIDATE_POOL_SIZE);
  });

  it('returns null when there is nothing left to take', () => {
    const base = sim({ totalTeams: 2 }, tinyPool());
    const drained = {
      ...base,
      picks: tinyPool().map((p, i) => ({ pickNumber: i + 1, teamId: 1, playerId: p.playerId, auto: false })),
      currentPick: 11,
    };
    expect(cpuPick(drained, 1, mulberry32(1))).toBeNull();
  });
});

describe('a full CPU-vs-CPU draft', () => {
  const finished = autoDraft(sim({ totalTeams: 10, userSlot: 1 }));

  it('runs every pick to completion without deadlocking', () => {
    expect(finished.status).toBe('complete');
    expect(finished.picks).toHaveLength(150);
    expect(new Set(finished.picks.map((p) => p.playerId)).size).toBe(150);
  });

  it('leaves every team able to field a legal lineup', () => {
    for (const team of finished.teams) {
      const roster = rosterFor(finished, team.id);
      const counts = roster.reduce((acc, p) => ({ ...acc, [p.position]: (acc[p.position] || 0) + 1 }), {});
      expect(roster).toHaveLength(15);
      expect(counts.QB || 0).toBeGreaterThanOrEqual(1);
      expect(counts.RB || 0).toBeGreaterThanOrEqual(2);
      expect(counts.WR || 0).toBeGreaterThanOrEqual(2);
      expect(counts.TE || 0).toBeGreaterThanOrEqual(1);
      expect(counts.K || 0).toBeGreaterThanOrEqual(1);
      expect(counts.DEF || 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('never takes a kicker or defense before the last three rounds', () => {
    const early = finished.picks.filter((pick) => Math.ceil(pick.pickNumber / 10) <= finished.rounds - 3);
    const byId = new Map(finished.players.map((p) => [p.playerId, p]));
    expect(early.some((pick) => ['K', 'DEF'].includes(byId.get(pick.playerId).position))).toBe(false);
  });

  it('fills IDP starters in an IDP league', () => {
    const idpDraft = autoDraft(sim({ leagueType: 'idp', totalTeams: 10 }, buildPool({ idp: true })), 42);
    expect(idpDraft.status).toBe('complete');
    for (const team of idpDraft.teams) {
      const roster = rosterFor(idpDraft, team.id);
      const groups = roster.map((p) => positionGroupKey(p.position));
      expect(groups).toContain('DL');
      expect(groups).toContain('LB');
      expect(groups).toContain('DB');
    }
  });

  it('replays identically from the same seed', () => {
    const again = autoDraft(sim({ totalTeams: 10, userSlot: 1 }));
    expect(again.picks).toEqual(finished.picks);
  });
});
