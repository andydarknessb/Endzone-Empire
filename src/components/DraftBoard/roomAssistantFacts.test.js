import {
  roundForPick,
  stealReachLabelFor,
  netVsAdpFor,
  factsForOwnPick,
  factsForQueueSnipe,
  factsForPoolBrowse,
  factsForTurnStart,
  factsForClockUrgent,
} from './roomAssistantFacts';
import { TRIGGERS } from '../../lib/draftAssistant';

// One K slot and one DEF slot, the "one K one DEF template" earlyKickerOrDefense
// (issue #785) is pinned against, so a K taken with rounds to spare reads early.
const ONE_K_ONE_DEF_SLOTS = [
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

const ownPick = ({
  pickNumber, id = 500, name = 'A Player', position = 'WR', nfl_team = 'KC', auto = false,
}) => ({ pickNumber, teamId: 1, player: { id, name, position, nfl_team }, auto });

describe('roundForPick', () => {
  it('is 1-based and rolls over every teamCount picks', () => {
    expect(roundForPick(1, 12)).toBe(1);
    expect(roundForPick(12, 12)).toBe(1);
    expect(roundForPick(13, 12)).toBe(2);
    expect(roundForPick(24, 12)).toBe(2);
    expect(roundForPick(25, 12)).toBe(3);
  });

  it('falls back to round 1 when there are no teams yet', () => {
    expect(roundForPick(5, 0)).toBe(1);
  });
});

describe('stealReachLabelFor', () => {
  it('is no-market with a zero score when ADP is unknown', () => {
    expect(stealReachLabelFor({ adp: null, pickNumber: 1, round: 1 })).toEqual({ label: 'no-market', draftValueScore: 0 });
  });

  it('is a steal when the pick lands far later than ADP', () => {
    // round 1 threshold 7.5; adp 1 at pick 20 scores -19.
    expect(stealReachLabelFor({ adp: 1, pickNumber: 20, round: 1 })).toEqual({ label: 'steal', draftValueScore: -19 });
  });

  it('is a reach when the pick lands far earlier than ADP', () => {
    expect(stealReachLabelFor({ adp: 20, pickNumber: 1, round: 1 })).toEqual({ label: 'reach', draftValueScore: 19 });
  });

  it('is plain value inside the threshold band', () => {
    expect(stealReachLabelFor({ adp: 5, pickNumber: 3, round: 1 }).label).toBe('value');
  });

  it('widens the band by round, so a swing that reaches in round 1 is only value in round 12', () => {
    // round 12 threshold 24; a score of 19 is a reach at r1 but inside the band at r12.
    expect(stealReachLabelFor({ adp: 20, pickNumber: 1, round: 1 }).label).toBe('reach');
    expect(stealReachLabelFor({ adp: 20, pickNumber: 1, round: 12 }).label).toBe('value');
  });
});

describe('factsForOwnPick trigger priority', () => {
  const base = {
    priorMyPicks: [], rosterSlots: ONE_K_ONE_DEF_SLOTS, teamCount: 12, draftRounds: 12, netVsAdp: 0,
  };

  it('PICK_AUTO wins outright over any other trigger', () => {
    // A steal payload (adp 1 at pick 20) that also carries the auto flag.
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 20, position: 'RB', auto: true }), poolRow: { adp: 1 },
    });
    expect(facts.trigger).toBe(TRIGGERS.PICK_AUTO);
    expect(facts.auto).toBe(true);
  });

  it('PICK_STEAL over the position triggers', () => {
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 20, position: 'RB' }), poolRow: { adp: 1 },
    });
    expect(facts.trigger).toBe(TRIGGERS.PICK_STEAL);
  });

  it('PICK_REACH over the position triggers', () => {
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 1, position: 'RB' }), poolRow: { adp: 20 },
    });
    expect(facts.trigger).toBe(TRIGGERS.PICK_REACH);
  });

  it('PICK_EARLY_KDEF for a value-priced kicker with rounds still to spare', () => {
    // pick 13 -> round 2 of 12; K at ADP 13 is neither steal nor reach.
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 13, position: 'K' }), poolRow: { adp: 13 },
    });
    expect(facts.trigger).toBe(TRIGGERS.PICK_EARLY_KDEF);
    expect(facts.earlyKickerOrDefense).toBe(true);
  });

  it('PICK_RB for a value-priced running back', () => {
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 5, position: 'RB' }), poolRow: { adp: 5 },
    });
    expect(facts.trigger).toBe(TRIGGERS.PICK_RB);
  });

  it('PICK_GENERIC for everything else', () => {
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 5, position: 'WR' }), poolRow: { adp: 5 },
    });
    expect(facts.trigger).toBe(TRIGGERS.PICK_GENERIC);
  });

  it('carries injury status from the pool row, since the pick payload has none', () => {
    const facts = factsForOwnPick({
      ...base, pick: ownPick({ pickNumber: 5, position: 'WR', name: 'Hurt Guy' }), poolRow: { adp: 5, injury_status: 'Questionable' },
    });
    expect(facts.player).toEqual(expect.objectContaining({ name: 'Hurt Guy', injury_status: 'Questionable' }));
  });

  it('a K with both K and DEF already filled is not early, so it is generic', () => {
    const facts = factsForOwnPick({
      ...base,
      priorMyPicks: [{ pickNumber: 1, position: 'K' }, { pickNumber: 2, position: 'DEF' }],
      pick: ownPick({ pickNumber: 13, position: 'K' }),
      poolRow: { adp: 13 },
    });
    expect(facts.earlyKickerOrDefense).toBe(false);
    expect(facts.trigger).toBe(TRIGGERS.PICK_GENERIC);
  });
});

describe('the other room triggers', () => {
  it('factsForQueueSnipe is a snipe carrying the picked player', () => {
    const facts = factsForQueueSnipe({
      pick: ownPick({ pickNumber: 8, name: 'Sniped Star', position: 'WR' }),
      teamCount: 12, draftRounds: 12, poolRow: undefined, netVsAdp: 0,
    });
    expect(facts.trigger).toBe(TRIGGERS.QUEUE_PICKED_BY_OTHER);
    expect(facts.player.name).toBe('Sniped Star');
    expect(facts.round).toBe(1);
  });

  it('factsForPoolBrowse reads the whole row, emits POOL_PLAYER_BROWSED, and never announces a round', () => {
    const facts = factsForPoolBrowse({
      poolRow: { name: 'Browsed Guy', position: 'TE', nfl_team: 'SF', adp: 40, injury_status: 'Out' },
      teamCount: 12, draftRounds: 12, netVsAdp: 0,
    });
    expect(facts.trigger).toBe(TRIGGERS.POOL_PLAYER_BROWSED);
    expect(facts.player).toEqual({ name: 'Browsed Guy', position: 'TE', nfl_team: 'SF', injury_status: 'Out' });
    expect(facts.pickNumber).toBeNull();
    expect(facts.round).toBeNull();
  });

  it('the contextual triggers carry an empty player and the current round', () => {
    const ctx = { pickNumber: 13, round: 2, draftRounds: 12, netVsAdp: -3 };
    expect(factsForTurnStart(ctx).trigger).toBe(TRIGGERS.TURN_START);
    expect(factsForClockUrgent(ctx).trigger).toBe(TRIGGERS.CLOCK_URGENT);
    expect(factsForTurnStart(ctx).player).toEqual({ name: null, position: null, nfl_team: null, injury_status: null });
    expect(factsForClockUrgent(ctx).round).toBe(2);
  });
});

describe('netVsAdpFor', () => {
  it('sums adp - pickNumber over the viewer picks with a known ADP, skipping the rest', () => {
    const myPicks = [
      { pickNumber: 1, playerId: 100 }, // adp 5 -> +4
      { pickNumber: 2, playerId: 101 }, // adp unknown -> skipped
      { pickNumber: 14, playerId: 102 }, // adp 4 -> -10
    ];
    const adpMap = { 100: 5, 102: 4 };
    const adpForPlayer = (id) => (id in adpMap ? adpMap[id] : null);
    expect(netVsAdpFor({ myPicks, adpForPlayer, teamCount: 12 })).toBe(4 + -10);
  });

  it('is zero when no ADP is known for any pick', () => {
    const myPicks = [{ pickNumber: 1, playerId: 100 }];
    expect(netVsAdpFor({ myPicks, adpForPlayer: () => null, teamCount: 12 })).toBe(0);
  });
});
