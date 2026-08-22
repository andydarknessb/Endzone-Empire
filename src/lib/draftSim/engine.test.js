import {
  teamIndexForPick, normalizeConfig, createSimDraft, applyPick, canPick,
  teamOnClock, isUserTurn, currentRound, roundOfPick, availablePlayers, rosterFor,
  toBoardShape, secondsLeft, rearmDeadline, deadlineFor, picksRemainingFor,
  unfilledDedicatedSlots, STATE_VERSION,
} from './engine';
import { tinyPool, buildPool } from './simFixtures';

const NOW = 1_800_000_000_000;

function newSim(overrides = {}, players = buildPool()) {
  return createSimDraft(
    { totalTeams: 10, userSlot: 1, leagueType: 'standard', clockSeconds: 60, ...overrides },
    players,
    { now: NOW, seed: 1234 }
  );
}

describe('teamIndexForPick (mirror of draft.service.js)', () => {
  // Parity vector for the server's documented snake behavior: 0-based pick
  // number in, 0-based team index out, even rounds forward, odd rounds back.
  it('snakes: round 1 forward, round 2 reversed, round 3 forward', () => {
    const forward = Array.from({ length: 4 }, (_, i) => teamIndexForPick(i, 4));
    const back = Array.from({ length: 4 }, (_, i) => teamIndexForPick(4 + i, 4));
    const forwardAgain = Array.from({ length: 4 }, (_, i) => teamIndexForPick(8 + i, 4));
    expect(forward).toEqual([0, 1, 2, 3]);
    expect(back).toEqual([3, 2, 1, 0]);
    expect(forwardAgain).toEqual([0, 1, 2, 3]);
  });

  it('gives the turn ends of a snake back-to-back picks', () => {
    // Team index 3 (last in a 4-team league) picks 3 and 4 consecutively.
    expect(teamIndexForPick(3, 4)).toBe(3);
    expect(teamIndexForPick(4, 4)).toBe(3);
  });

  it('handles a single-team degenerate league', () => {
    expect(teamIndexForPick(0, 1)).toBe(0);
    expect(teamIndexForPick(5, 1)).toBe(0);
  });
});

describe('normalizeConfig', () => {
  it('clamps team counts into 4..14 and defaults nonsense to 10', () => {
    expect(normalizeConfig({ totalTeams: 2 }).totalTeams).toBe(4);
    expect(normalizeConfig({ totalTeams: 99 }).totalTeams).toBe(14);
    expect(normalizeConfig({ totalTeams: 'abc' }).totalTeams).toBe(10);
  });

  it('keeps "random" as a slot and clamps numeric slots to the team count', () => {
    expect(normalizeConfig({ userSlot: 'random' }).userSlot).toBe('random');
    expect(normalizeConfig({ totalTeams: 8, userSlot: 20 }).userSlot).toBe(8);
    expect(normalizeConfig({ totalTeams: 8, userSlot: 0 }).userSlot).toBe(1);
  });

  it('only accepts the offered clocks and falls back to 60', () => {
    expect(normalizeConfig({ clockSeconds: 0 }).clockSeconds).toBe(0);
    expect(normalizeConfig({ clockSeconds: 90 }).clockSeconds).toBe(90);
    expect(normalizeConfig({ clockSeconds: 45 }).clockSeconds).toBe(60);
  });

  it('falls back to standard for an unknown league type', () => {
    expect(normalizeConfig({ leagueType: 'best-ball' }).leagueType).toBe('standard');
  });
});

describe('createSimDraft', () => {
  it('builds a versioned, fully-specified state', () => {
    const state = newSim();
    expect(state.version).toBe(STATE_VERSION);
    expect(state.seed).toBe(1234);
    expect(state.rounds).toBe(15);
    expect(state.totalPicks).toBe(150);
    expect(state.teams).toHaveLength(10);
    expect(state.currentPick).toBe(1);
    expect(state.status).toBe('active');
    expect(state.startedAt).toBe(NOW);
  });

  it('names the user team and keeps draft slots 1..N', () => {
    const state = newSim({ userSlot: 4 });
    expect(state.teams.map((t) => t.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(state.teams.filter((t) => t.isUser)).toHaveLength(1);
    expect(state.teams[3].isUser).toBe(true);
    expect(state.teams[3].name).toBe('You');
    expect(state.teams[0].name).toBe('Team 1');
  });

  it('resolves a random slot deterministically from the seed', () => {
    const a = createSimDraft({ totalTeams: 12, userSlot: 'random' }, tinyPool(), { now: NOW, seed: 777 });
    const b = createSimDraft({ totalTeams: 12, userSlot: 'random' }, tinyPool(), { now: NOW, seed: 777 });
    expect(a.config.userSlot).toBe(b.config.userSlot);
    expect(a.config.userSlot).toBeGreaterThanOrEqual(1);
    expect(a.config.userSlot).toBeLessThanOrEqual(12);
  });

  it('arms the clock when the user has the very first pick', () => {
    const state = newSim({ userSlot: 1, clockSeconds: 30 });
    expect(state.deadline).toBe(NOW + 30_000);
    expect(secondsLeft(state, NOW)).toBe(30);
  });

  it('leaves the clock unarmed when a CPU is on the clock', () => {
    const state = newSim({ userSlot: 5, clockSeconds: 30 });
    expect(state.deadline).toBeNull();
    expect(secondsLeft(state, NOW)).toBeNull();
  });

  it('never arms a clock in an untimed draft', () => {
    const state = newSim({ userSlot: 1, clockSeconds: 0 });
    expect(state.deadline).toBeNull();
    expect(deadlineFor(state, NOW)).toBeNull();
  });
});

describe('applyPick', () => {
  it('records the pick against the team on the clock and advances', () => {
    const state = newSim({ totalTeams: 4, userSlot: 1 }, tinyPool());
    const next = applyPick(state, { playerId: 1, now: NOW + 1000 });

    expect(next).not.toBe(state);
    expect(state.picks).toHaveLength(0); // original untouched
    expect(next.picks).toEqual([{ pickNumber: 1, teamId: 1, playerId: 1, auto: false }]);
    expect(next.currentPick).toBe(2);
    expect(teamOnClock(next).id).toBe(2);
    expect(next.updatedAt).toBe(NOW + 1000);
  });

  it('rejects an already-drafted player by returning the same state', () => {
    const first = applyPick(newSim({ totalTeams: 4 }, tinyPool()), { playerId: 1, now: NOW });
    expect(applyPick(first, { playerId: 1, now: NOW })).toBe(first);
  });

  it('rejects a player who is not in the pool at all', () => {
    const state = newSim({ totalTeams: 4 }, tinyPool());
    expect(applyPick(state, { playerId: 9999, now: NOW })).toBe(state);
    expect(canPick(state, 9999)).toBe(false);
  });

  it('flags autopicks so the report can call them out', () => {
    const next = applyPick(newSim({ totalTeams: 4 }, tinyPool()), { playerId: 2, auto: true, now: NOW });
    expect(next.picks[0].auto).toBe(true);
  });

  it('arms the clock only on the user\'s turns', () => {
    // 4 teams, user in slot 2: pick 1 is CPU, pick 2 is the user.
    const state = newSim({ totalTeams: 4, userSlot: 2, clockSeconds: 90 }, tinyPool());
    expect(state.deadline).toBeNull();
    const afterCpu = applyPick(state, { playerId: 1, now: NOW });
    expect(isUserTurn(afterCpu)).toBe(true);
    expect(afterCpu.deadline).toBe(NOW + 90_000);
    const afterUser = applyPick(afterCpu, { playerId: 2, now: NOW });
    expect(isUserTurn(afterUser)).toBe(false);
    expect(afterUser.deadline).toBeNull();
  });

  it('completes at totalPicks and stops accepting picks', () => {
    // 2 rounds is impossible via config; drive a tiny state directly instead.
    let state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 0 }, tinyPool());
    state = { ...state, rounds: 2, totalPicks: 8 };
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const playerId of ids) state = applyPick(state, { playerId, now: NOW });

    expect(state.status).toBe('complete');
    expect(state.picks).toHaveLength(8);
    expect(teamOnClock(state)).toBeNull();
    expect(state.deadline).toBeNull();
    expect(applyPick(state, { playerId: 9, now: NOW })).toBe(state);
  });
});

describe('selectors', () => {
  it('derives the round from the pick number', () => {
    const state = newSim({ totalTeams: 10 });
    expect(currentRound(state)).toBe(1);
    expect(roundOfPick(state, 10)).toBe(1);
    expect(roundOfPick(state, 11)).toBe(2);
    expect(roundOfPick(state, 150)).toBe(15);
  });

  it('removes drafted players from the available pool', () => {
    const state = applyPick(newSim({ totalTeams: 4 }, tinyPool()), { playerId: 3, now: NOW });
    expect(availablePlayers(state).map((p) => p.playerId)).not.toContain(3);
    expect(availablePlayers(state)).toHaveLength(9);
  });

  it('builds a roster in pick order', () => {
    // 4 teams: picks 1 and 8 both belong to team 1 (snake turn).
    let state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 0 }, tinyPool());
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((playerId) => {
      state = applyPick(state, { playerId, now: NOW });
    });
    const roster = rosterFor(state, 1);
    expect(roster.map((p) => p.playerId)).toEqual([1, 8]);
    expect(roster[0].name).toBe('Ace Back');
  });

  it('counts a team\'s remaining picks including the one on the clock', () => {
    const state = newSim({ totalTeams: 10, userSlot: 1 });
    expect(picksRemainingFor(state, 1)).toBe(15);
    expect(picksRemainingFor(state, 7)).toBe(15);
    const after = applyPick(state, { playerId: state.players[0].playerId, now: NOW });
    expect(picksRemainingFor(after, 1)).toBe(14);
  });

  it('reports unfilled dedicated starter slots, ignoring FLEX', () => {
    let state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 0 }, tinyPool());
    expect([...unfilledDedicatedSlots(state, 1).entries()].sort()).toEqual([
      ['DEF', 1], ['K', 1], ['QB', 1], ['RB', 2], ['TE', 1], ['WR', 2],
    ]);
    state = applyPick(state, { playerId: 1, now: NOW }); // Ace Back, RB, to team 1
    expect(unfilledDedicatedSlots(state, 1).get('RB')).toBe(1);
  });
});

describe('rearmDeadline', () => {
  it('re-arms a stale user clock relative to now', () => {
    const state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 60 }, tinyPool());
    const later = NOW + 3_600_000;
    expect(rearmDeadline(state, later).deadline).toBe(later + 60_000);
  });

  it('is identity when nothing changes', () => {
    const state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 60 }, tinyPool());
    expect(rearmDeadline(state, NOW)).toBe(state);
  });

  it('leaves an untimed draft alone', () => {
    const state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 0 }, tinyPool());
    expect(rearmDeadline(state, NOW + 999_999).deadline).toBeNull();
  });
});

describe('toBoardShape', () => {
  it('adapts to the snake_case props DraftBoardMatrix already speaks', () => {
    let state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 0 }, tinyPool());
    state = applyPick(state, { playerId: 1, now: NOW });
    state = applyPick(state, { playerId: 3, now: NOW });

    const board = toBoardShape(state);
    expect(board.teams[0]).toEqual({ id: 1, name: 'You', draft_position: 1 });
    expect(board.draftRounds).toBe(15);
    expect(board.onTheClock).toEqual({ id: 3, name: 'Team 3' });
    // Newest pick first, matching the live draft room the matrix was built for.
    expect(board.picks[0]).toEqual({
      pick_number: 2, team_id: 2, player_id: 3,
      name: 'Cann Arm', position: 'QB', nfl_team: 'SF',
    });
    expect(board.picks[1].pick_number).toBe(1);
  });

  it('has no team on the clock once the draft completes', () => {
    let state = newSim({ totalTeams: 4, userSlot: 1, clockSeconds: 0 }, tinyPool());
    state = { ...state, rounds: 1, totalPicks: 4 };
    [1, 2, 3, 4].forEach((playerId) => {
      state = applyPick(state, { playerId, now: NOW });
    });
    expect(toBoardShape(state).onTheClock).toBeNull();
  });
});
