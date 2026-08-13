'use strict';

/**
 * Roster construction for `holdout-confirm-2026` (PREREGISTRATION.md §6):
 * the pit-sweep §5.1 rules pointed at the ledger cohort.
 *
 * Model-independent by construction - nothing here reads a projection - and
 * seeded, so both arms of Candidate A share the exact same 50 rosters per
 * week and the contrast is purely the ranking rule.
 */

const model = require('../../../server/services/projectionModel');

const ROSTER_QUOTAS = Object.freeze({ QB: 20, RB: 50, WR: 50, TE: 20, K: 10, DEF: 10 });
const TEAM_CAPS = Object.freeze({ QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 });
const TEAMS = 10;
const ROUNDS = 16;
const REPLICATES = 5;
const RECENCY_HALF_LIFE_WEEKS = 8;
/** Production's season boundary: 2025 week w is (W + 26 - w) weeks stale in 2026 week W. */
const SEASON_WEEK_SPAN = 26;

/**
 * The model-independent pre-week ranking value: recency-weighted mean of
 * prior league-scored points, weight 0.5^(weeksAgo / 8), two-season window,
 * at least one prior game. `actuals` maps 'season:week:playerId' -> points
 * (final, re-scored under the primary profile).
 */
function preWeekRanking({ playerIds, season, week, actuals, priorSeason }) {
  const values = new Map();
  for (const playerId of playerIds) {
    let num = 0;
    let den = 0;
    for (let w = 1; w < week; w++) {
      const pts = actuals.get(`${season}:${w}:${playerId}`);
      if (pts === undefined) continue;
      const weight = 0.5 ** ((week - w) / RECENCY_HALF_LIFE_WEEKS);
      num += weight * Number(pts);
      den += weight;
    }
    for (let w = 1; w <= 18; w++) {
      const pts = actuals.get(`${priorSeason}:${w}:${playerId}`);
      if (pts === undefined) continue;
      const weight = 0.5 ** ((week + SEASON_WEEK_SPAN - w) / RECENCY_HALF_LIFE_WEEKS);
      num += weight * Number(pts);
      den += weight;
    }
    if (den > 0) values.set(playerId, num / den);
  }
  return values;
}

/** Seeded Fisher-Yates permutation of [0..n-1]. */
function seededPermutation(n, rand) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The week's 50 rosters: a 160-player pool (quotas per position, best-ranked
 * first), snake-drafted into 10 legal 16-man rosters, 5 replicates whose
 * draft orders are seeded permutations derived from
 * `seedFrom(rosterSeed, season, week, replicate)`.
 *
 * Ties in the ranking break by ascending playerId - a deliberate, named
 * simplification of pit-sweep §5.1's collation-artifact tie-break, which
 * needed name orderings the ledger does not carry (prereg §6 names it).
 *
 * Fails loud when a position cannot fill its quota: a cohort that thin is a
 * structural anomaly the study must adjudicate, never silently reshape.
 */
function buildWeekRosters({ cohortRows, season, week, actuals, rosterSeed, priorSeason }) {
  const byPosition = new Map();
  for (const row of cohortRows) {
    if (!(row.position in ROSTER_QUOTAS)) continue;
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(row.playerId);
  }
  const ranking = preWeekRanking({
    playerIds: cohortRows.map((r) => r.playerId), season, week, actuals, priorSeason,
  });

  const pool = [];
  for (const [position, quota] of Object.entries(ROSTER_QUOTAS)) {
    const ranked = (byPosition.get(position) || [])
      .filter((id) => ranking.has(id))
      .sort((a, b) => (ranking.get(b) - ranking.get(a)) || (a - b));
    if (ranked.length < quota) {
      throw new Error(
        `holdout rosters ${season} week ${week}: position ${position} has ${ranked.length} rankable ` +
        `players against a quota of ${quota} - a structural cohort anomaly, refusing to reshape the pool`
      );
    }
    for (const id of ranked.slice(0, quota)) pool.push({ playerId: id, position });
  }
  // Draft order over the pool: best ranking first, position only breaking
  // ties through the ranking values themselves.
  pool.sort((a, b) => (ranking.get(b.playerId) - ranking.get(a.playerId)) || (a.playerId - b.playerId));

  const rosters = [];
  for (let replicate = 0; replicate < REPLICATES; replicate++) {
    const rand = model.mulberry32(model.seedFrom(rosterSeed, season, week, replicate));
    const slotOrder = seededPermutation(TEAMS, rand);
    const teams = Array.from({ length: TEAMS }, () => ({ players: [], counts: {} }));
    const taken = new Set();
    for (let round = 0; round < ROUNDS; round++) {
      const forward = round % 2 === 0;
      for (let s = 0; s < TEAMS; s++) {
        const teamIndex = slotOrder[forward ? s : TEAMS - 1 - s];
        const team = teams[teamIndex];
        const pick = pool.find((p) => !taken.has(p.playerId)
          && (team.counts[p.position] || 0) < TEAM_CAPS[p.position]);
        if (!pick) {
          throw new Error(`holdout rosters ${season} week ${week}: draft deadlock at round ${round + 1} - caps and quotas disagree`);
        }
        taken.add(pick.playerId);
        team.counts[pick.position] = (team.counts[pick.position] || 0) + 1;
        team.players.push(pick);
      }
    }
    teams.forEach((team, teamIndex) => {
      rosters.push({ season, week, replicate, teamIndex, players: team.players });
    });
  }
  return { rosters, ranking, poolSize: pool.length };
}

module.exports = {
  ROSTER_QUOTAS,
  TEAM_CAPS,
  TEAMS,
  ROUNDS,
  REPLICATES,
  preWeekRanking,
  seededPermutation,
  buildWeekRosters,
};
