const { isOnWaivers } = require('./waiver.service');
const { rosterCapacity } = require('./irPolicy.service');
const { POSITION_GROUPS } = require('./lineup.service');
const { DraftError } = require('./draftError');

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

/** Enforce a team's per-position draft cap (if the league sets one for this player's cap group). Throws DraftError(409) when full. */
async function assertPositionCapNotReached(client, { teamId, positionCaps, position }) {
  const caps = typeof positionCaps === 'string' ? JSON.parse(positionCaps) : positionCaps || {};
  const group = positionCapGroup(position);
  const cap = caps[group];
  if (!Number.isInteger(cap)) return;
  const members = POSITION_GROUPS[group] || [position];
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players"
     JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1 AND "players"."position" = ANY($2::text[])`,
    [teamId, members]
  );
  if (countResult.rows[0].n >= cap) {
    throw new DraftError(409, `position cap reached: max ${cap} ${group}`);
  }
}

/**
 * The roster-acquisition checks shared by a Pick (pick.service.commitPick) and a
 * post-draft free-agent add (draft.service.js's addFreeAgent), #782 ruling 2: roster capacity,
 * the per-position cap, and - for a completed draft only - the on-waivers gate.
 * The order matches what the single pre-#782 commit ran before it was split into
 * pick.service.commitPick and addFreeAgent, so both callers refuse for the same
 * reason in the same order they always did.
 *
 * Roster capacity is the IR-policy capacity, not the static roster limit: a draft
 * pick and a post-draft add both land here, and an eligible IR stash grants a
 * spot beyond the draft roster size (#97). The added player himself earns no
 * restored credit - an add benches him (undoDrop is the one restore).
 */
async function assertRosterAcquisitionAllowed(client, { league, teamId, playerId, position }) {
  const rosterCountResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
    [teamId]
  );
  const capacity = await rosterCapacity(client, { league, teamId });
  if (rosterCountResult.rows[0].n >= capacity) {
    throw new DraftError(409, `roster capacity of ${capacity} reached`);
  }

  await assertPositionCapNotReached(client, { teamId, positionCaps: league.position_caps, position });

  // Post-draft pickups are free agency: players still on waivers must be claimed
  // through the waiver process instead. An active draft never reaches this branch
  // (a Pick is not a waiver claim), so it is a no-op for pick.service.commitPick.
  if (league.draft_status === 'complete' &&
      await isOnWaivers(client, { league, playerId })) {
    throw new DraftError(409, 'player is on waivers; submit a waiver claim instead');
  }
}

module.exports = {
  assertRosterAcquisitionAllowed,
  assertPositionCapNotReached,
};
