const { rosterCapacity } = require('./irPolicy.service');
const { POSITION_GROUPS } = require('./lineup.service');

/**
 * Roster fit (spec #2681, 7/16): does a Team stay within its Roster capacity and
 * every Position cap after a set of adds and drops? The one answer every roster
 * path asks - the roster gate's acquisition check, waiver claim submit, edit and
 * processing, and trade execute.
 *
 * Drops are netted first. The roster is checked after the adds and drops, so a
 * like-for-like swap at a full roster fits, and a Team already over capacity
 * refuses only a move that leaves it over. A Position cap refuses only a move
 * that GAINS players in a group, so a Team already over a cap keeps its players
 * but adds none at that position.
 *
 * Returns null when the Team fits, else the refusal reason in the wording the
 * roster paths already show. The position cap is checked before capacity, so a
 * claim that never fit its cap does not read as "roster full" once a sibling win
 * fills the roster (siblingReason in waiver.service.js).
 */

/**
 * Position caps are keyed at the same granularity as positionCapsFeasible's
 * POSITION_KEYS: literal offense positions plus the three IDP group keys
 * (DL/LB/DB) rather than every specific position Tank01 reports. A 'CB' must
 * therefore be checked (and counted) against the 'DB' cap, not a literal
 * 'CB' cap that would never be set.
 */
function positionCapGroup(position) {
  return Object.keys(POSITION_GROUPS).find((key) => POSITION_GROUPS[key].includes(position)) || position;
}

/** A league's position_caps column as an object (it may arrive as a JSON string). */
const parsePositionCaps = (positionCaps) => (
  typeof positionCaps === 'string' ? JSON.parse(positionCaps) : positionCaps || {}
);

/** How many players a team rosters in one cap group (the group key is the position itself when it is not a group). */
async function countAtPositionGroup(client, { teamId, group }) {
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players"
     JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1 AND "players"."position" = ANY($2::text[])`,
    [teamId, POSITION_GROUPS[group] || [group]]
  );
  return countResult.rows[0].n;
}

/** Each player's position: the caller's known ones, and the players table for the rest. */
async function positionsFor(client, { ids, known }) {
  const positionOf = new Map(known);
  const missing = ids.filter((id) => !positionOf.has(id));
  if (missing.length > 0) {
    const result = await client.query(
      `SELECT "id", "position" FROM "players" WHERE "id" = ANY($1::int[])`,
      [missing]
    );
    for (const p of result.rows) positionOf.set(p.id, p.position);
  }
  return positionOf;
}

/** Net change per cap group: +1 for each add, -1 for each drop, keyed by the player's group. */
async function netChangeByGroup(client, { adds, drops, known }) {
  const positionOf = await positionsFor(client, { ids: [...adds, ...drops], known });
  const net = new Map();
  const bump = (id, delta) => {
    const group = positionCapGroup(positionOf.get(id));
    net.set(group, (net.get(group) || 0) + delta);
  };
  adds.forEach((id) => bump(id, 1));
  drops.forEach((id) => bump(id, -1));
  return net;
}

async function positionCapRefusal(client, { league, teamId, adds, drops, knownPositions }) {
  const caps = parsePositionCaps(league.position_caps);
  if (adds.length === 0 || !Object.values(caps).some(Number.isInteger)) return null;
  const net = await netChangeByGroup(client, { adds, drops, known: knownPositions });
  for (const [group, change] of net) {
    const cap = caps[group];
    if (!Number.isInteger(cap) || change <= 0) continue;
    if (await countAtPositionGroup(client, { teamId, group }) + change > cap) {
      return `position cap reached: max ${cap} ${group}`;
    }
  }
  return null;
}

async function capacityRefusal(client, { league, teamId, adds, drops }) {
  // A move with nothing in it never refuses, even on a Team already over capacity.
  if (adds.length === 0 && drops.length === 0) return null;
  const count = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
    [teamId]
  );
  // Roster capacity, not the static roster limit: an eligible IR stash grants a
  // spot, and a dropped player's own stash grants nothing (#97).
  const capacity = await rosterCapacity(client, { league, teamId, excludePlayerIds: drops });
  if (count.rows[0].n + adds.length - drops.length > capacity) return `roster capacity of ${capacity} reached`;
  return null;
}

/**
 * The refusal for these adds and drops on this Team, or null. `checkCapacity`
 * and `checkPositionCap` let the roster gate honour its own bypass tokens; every
 * other caller checks both.
 */
async function rosterFit(client, {
  league, teamId, adds = [], drops = [], checkCapacity = true, checkPositionCap = true, knownPositions = new Map(),
}) {
  if (checkPositionCap) {
    const capped = await positionCapRefusal(client, { league, teamId, adds, drops, knownPositions });
    if (capped) return capped;
  }
  if (checkCapacity) {
    const full = await capacityRefusal(client, { league, teamId, adds, drops });
    if (full) return full;
  }
  return null;
}

module.exports = { rosterFit, positionCapGroup, parsePositionCaps, countAtPositionGroup };
