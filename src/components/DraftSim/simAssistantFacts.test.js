import { TRIGGERS } from '../../lib/draftAssistant';
import { DEFAULT_ROSTER_SLOTS } from '../../lib/draftSim/templates';
import {
  netVsAdpFor, factsForUserPick, factsForPoolSelection,
  factsForTurnStart, factsForClockUrgent, userTeamId,
} from './simAssistantFacts';

// A minimal, hand-built sim state: pickValues() (src/lib/draftSim/analysis.js)
// only ever reads state.players/state.teams/state.picks/state.teams.length off
// it, so a full engine.createSimDraft() run is not needed to exercise this
// module's own logic in isolation.
const TEAMS = [
  { id: 1, slot: 1, name: 'You', isUser: true },
  { id: 2, slot: 2, name: 'Team 2', isUser: false },
];

function player(playerId, position, adp, extra = {}) {
  return {
    playerId, name: `${position}${playerId} Player`, position, nflTeam: 'KC', adp, injuryStatus: null, ...extra,
  };
}

const PLAYERS = [
  player(1, 'RB', 1),
  player(2, 'WR', 2),
  player(3, 'RB', 20), // far below its ADP if taken pick 1 -> reach
  player(4, 'WR', 1), // taken far later than this ADP (pick 30 in the steal test) -> steal
  player(5, 'K', 3), // an early, market-accurate kicker (label 'value')
  player(6, 'DEF', 4),
  player(7, 'WR', 7),
];

function sim({ picks, rounds = 15, teams = TEAMS, players = PLAYERS } = {}) {
  return {
    config: { leagueType: 'standard' }, teams, players, picks, rounds,
  };
}

describe('netVsAdpFor (miseryStage\'s own sign: negative = steals accumulate)', () => {
  it('sums only the user\'s own picks, unnegated draftValueScore', () => {
    const state = sim({
      picks: [
        { pickNumber: 1, teamId: 1, playerId: 3, auto: false }, // reach: adp 20 - pick 1 = +19
        { pickNumber: 2, teamId: 2, playerId: 2, auto: false }, // another team, excluded
      ],
    });
    expect(netVsAdpFor(state)).toBeCloseTo(19);
  });

  it('is zero before the user has picked at all', () => {
    expect(netVsAdpFor(sim({ picks: [] }))).toBe(0);
  });
});

describe('factsForUserPick', () => {
  it('labels a reach pick PICK_REACH and carries the real player/pick facts', () => {
    const state = sim({ picks: [{ pickNumber: 1, teamId: 1, playerId: 3, auto: false }] });
    const facts = factsForUserPick({ sim: state, pickNumber: 1, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.trigger).toBe(TRIGGERS.PICK_REACH);
    expect(facts.label).toBe('reach');
    expect(facts.player).toEqual({
      name: 'RB3 Player', position: 'RB', nfl_team: 'KC', injury_status: null,
    });
    expect(facts.pickNumber).toBe(1);
    expect(facts.round).toBe(1);
    expect(facts.draftRounds).toBe(15);
    expect(facts.adp).toBe(20);
    expect(facts.auto).toBe(false);
    expect(facts.earlyKickerOrDefense).toBe(false);
    expect(facts.netVsAdp).toBeCloseTo(19);
  });

  it('labels a steal pick PICK_STEAL', () => {
    // ADP 1, taken at pick 30 (round 15 of 15, threshold 28.5): draftValueScore
    // -29 clears the -28.5 steal cutoff.
    const state = sim({ picks: [{ pickNumber: 30, teamId: 1, playerId: 4, auto: false }] });
    const facts = factsForUserPick({ sim: state, pickNumber: 30, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.trigger).toBe(TRIGGERS.PICK_STEAL);
    expect(facts.label).toBe('steal');
  });

  it('fires PICK_AUTO instead of a steal/reach label the pick would otherwise carry', () => {
    const state = sim({ picks: [{ pickNumber: 1, teamId: 1, playerId: 3, auto: true }] });
    const facts = factsForUserPick({ sim: state, pickNumber: 1, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.trigger).toBe(TRIGGERS.PICK_AUTO);
    expect(facts.auto).toBe(true);
  });

  it('reads PICK_EARLY_KDEF off the shipped earlyKickerOrDefense(), for a market-accurate K/DEF pick with slack left', () => {
    // Round 13 of 15: 2 rounds remain, exactly the 2 unfilled dedicated K+DEF
    // slots (DEFAULT_ROSTER_SLOTS carries one of each) -> early per #785.
    const teams = TEAMS;
    const pickNumber = 25; // round ceil(25/2) = 13
    const state = sim({
      picks: [{ pickNumber, teamId: 1, playerId: 5, auto: false }],
      teams,
    });
    const facts = factsForUserPick({ sim: state, pickNumber, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.label).not.toBe('steal');
    expect(facts.label).not.toBe('reach');
    expect(facts.trigger).toBe(TRIGGERS.PICK_EARLY_KDEF);
    expect(facts.earlyKickerOrDefense).toBe(true);
  });

  it('does not count another team\'s picks toward the user\'s own K/DEF slots', () => {
    // The user has already filled K in an earlier pick; only DEF (1 slot) is
    // still open, so 1 round of slack (not 2) reads as early here. Another
    // team also drafting a DEF changes nothing about the user's own roster.
    const pickNumber = 27; // round ceil(27/2) = 14 of 15 -> 1 round remains
    const state = sim({
      picks: [
        { pickNumber: 1, teamId: 1, playerId: 5, auto: false }, // user's own K, already filled
        { pickNumber: 2, teamId: 2, playerId: 6, auto: false }, // another team's DEF - irrelevant to the user's slots
        { pickNumber, teamId: 1, playerId: 8, auto: false }, // user's DEF pick under review
      ],
      players: [...PLAYERS, player(8, 'DEF', 27)],
    });
    const facts = factsForUserPick({ sim: state, pickNumber, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.earlyKickerOrDefense).toBe(true);
  });

  it('labels a plain running back pick PICK_RB once steal/reach/early are all ruled out', () => {
    const state = sim({ picks: [{ pickNumber: 1, teamId: 1, playerId: 1, auto: false }] });
    const facts = factsForUserPick({ sim: state, pickNumber: 1, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.label).toBe('value');
    expect(facts.trigger).toBe(TRIGGERS.PICK_RB);
  });

  it('falls back to PICK_GENERIC for a market-accurate non-RB, non-K/DEF pick', () => {
    const state = sim({ picks: [{ pickNumber: 2, teamId: 1, playerId: 2, auto: false }] });
    const facts = factsForUserPick({ sim: state, pickNumber: 2, rosterSlots: DEFAULT_ROSTER_SLOTS });
    expect(facts.label).toBe('value');
    expect(facts.trigger).toBe(TRIGGERS.PICK_GENERIC);
  });

  it('returns null for a pick number the sim has no record of', () => {
    const state = sim({ picks: [] });
    expect(factsForUserPick({ sim: state, pickNumber: 1, rosterSlots: DEFAULT_ROSTER_SLOTS })).toBeNull();
  });
});

describe('factsForPoolSelection', () => {
  it('builds POOL_PLAYER_SELECTED facts for another team\'s pick', () => {
    const state = sim({ picks: [{ pickNumber: 1, teamId: 2, playerId: 7, auto: false }] });
    const facts = factsForPoolSelection({ sim: state, pickNumber: 1 });
    expect(facts.trigger).toBe(TRIGGERS.POOL_PLAYER_SELECTED);
    expect(facts.player.name).toBe('WR7 Player');
    expect(facts.pickNumber).toBe(1);
  });
});

describe('factsForTurnStart / factsForClockUrgent', () => {
  it('carry the current pick/round context with no player attached', () => {
    const state = { ...sim({ picks: [] }), currentPick: 1 };
    const turn = factsForTurnStart({ sim: state });
    expect(turn.trigger).toBe(TRIGGERS.TURN_START);
    expect(turn.player).toEqual({
      name: null, position: null, nfl_team: null, injury_status: null,
    });
    expect(turn.auto).toBe(false);
    expect(turn.label).toBeNull();

    const urgent = factsForClockUrgent({ sim: state });
    expect(urgent.trigger).toBe(TRIGGERS.CLOCK_URGENT);
  });
});

describe('userTeamId', () => {
  it('finds the isUser team\'s id', () => {
    expect(userTeamId(sim({ picks: [] }))).toBe(1);
  });

  it('is null when no team is the user (should not happen in a real sim)', () => {
    expect(userTeamId(sim({ picks: [], teams: [{ id: 9, isUser: false }] }))).toBeNull();
  });
});
