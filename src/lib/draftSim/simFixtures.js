/**
 * TEST-ONLY fixture builder for the Draft Simulator engine.
 *
 * Produces a deterministic, realistically-shaped player pool in exactly the
 * serialized shape GET /api/public/draft-pool returns, so engine/CPU/report
 * tests exercise the same field names the real endpoint sends. Not imported by
 * any application code.
 */

const NFL_TEAMS = ['KC', 'BUF', 'SF', 'DAL', 'PHI', 'DET', 'BAL', 'CIN', 'MIA', 'GB', 'HOU', 'LAR'];
// One bye week per fake team, spread across weeks 5-16.
const BYE_BY_TEAM = NFL_TEAMS.reduce((map, team, i) => ({ ...map, [team]: 5 + (i % 12) }), {});

const BASE_POINTS = { QB: 340, RB: 260, WR: 250, TE: 190, K: 130, DEF: 130 };
const DECAY = { QB: 4, RB: 2.6, WR: 2.2, TE: 4.5, K: 1.5, DEF: 1.8 };
const IDP_CODES = ['DE', 'DT', 'LB', 'CB', 'S'];

/**
 * A deterministic pool. Skill positions are interleaved so ADP order looks like
 * a real board; kickers and defenses sit at the back of it. With `idp: true`,
 * ~60 individual defenders are appended carrying `adp: null` — exactly how the
 * live endpoint serves them.
 */
export function buildPool({ idp = false } = {}) {
  const players = [];
  let nextId = 1;
  let adp = 0;

  const make = (position, rank, marketAdp) => {
    const nflTeam = NFL_TEAMS[nextId % NFL_TEAMS.length];
    const player = {
      playerId: nextId,
      name: `${position}${rank} Player`,
      position,
      nflTeam,
      photoUrl: null,
      injuryStatus: null,
      adp: marketAdp,
      positionRank: rank,
      projectedPoints: Math.round(
        Math.max(20, (BASE_POINTS[position] || 120) - rank * (DECAY[position] || 2)) * 10
      ) / 10,
      byeWeek: BYE_BY_TEAM[nflTeam],
    };
    nextId += 1;
    return player;
  };

  const LIMITS = { QB: 40, RB: 70, WR: 90, TE: 30 };
  const CYCLE = ['RB', 'WR', 'WR', 'RB', 'QB', 'WR', 'TE', 'RB', 'WR', 'RB'];
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  let step = 0;
  while (Object.keys(LIMITS).some((pos) => counts[pos] < LIMITS[pos])) {
    const position = CYCLE[step % CYCLE.length];
    step += 1;
    if (counts[position] >= LIMITS[position]) continue;
    counts[position] += 1;
    adp += 1;
    players.push(make(position, counts[position], adp));
  }

  for (let rank = 1; rank <= 24; rank++) {
    adp += 1;
    players.push(make('K', rank, adp));
  }
  for (let rank = 1; rank <= 24; rank++) {
    adp += 1;
    players.push(make('DEF', rank, adp));
  }

  if (idp) {
    for (let rank = 1; rank <= 12; rank++) {
      for (const code of IDP_CODES) {
        players.push(make(code, rank, null));
      }
    }
  }

  return players;
}

/** A small hand-written pool for tests that need to reason about every row. */
export function tinyPool() {
  return [
    { playerId: 1, name: 'Ace Back', position: 'RB', nflTeam: 'KC', adp: 1, positionRank: 1, projectedPoints: 300, byeWeek: 6 },
    { playerId: 2, name: 'Bolt Wide', position: 'WR', nflTeam: 'BUF', adp: 2, positionRank: 1, projectedPoints: 280, byeWeek: 6 },
    { playerId: 3, name: 'Cann Arm', position: 'QB', nflTeam: 'SF', adp: 3, positionRank: 1, projectedPoints: 340, byeWeek: 6 },
    { playerId: 4, name: 'Dash Back', position: 'RB', nflTeam: 'DAL', adp: 4, positionRank: 2, projectedPoints: 260, byeWeek: 6 },
    { playerId: 5, name: 'Edge Wide', position: 'WR', nflTeam: 'PHI', adp: 5, positionRank: 2, projectedPoints: 250, byeWeek: 9 },
    { playerId: 6, name: 'Flat End', position: 'TE', nflTeam: 'DET', adp: 6, positionRank: 1, projectedPoints: 190, byeWeek: 9 },
    { playerId: 7, name: 'Gale Wide', position: 'WR', nflTeam: 'BAL', adp: 7, positionRank: 3, projectedPoints: 240, byeWeek: 9 },
    { playerId: 8, name: 'Hail Back', position: 'RB', nflTeam: 'CIN', adp: 8, positionRank: 3, projectedPoints: 235, byeWeek: 10 },
    { playerId: 9, name: 'Iron Foot', position: 'K', nflTeam: 'MIA', adp: 140, positionRank: 1, projectedPoints: 130, byeWeek: 10 },
    { playerId: 10, name: 'Jade Defense', position: 'DEF', nflTeam: 'GB', adp: 150, positionRank: 1, projectedPoints: 128, byeWeek: 10 },
  ];
}

export default buildPool;
