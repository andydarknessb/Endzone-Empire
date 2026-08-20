const { draftRosterSize, irSlotCount } = require('./rosterShape');

const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);

/**
 * The current IR stashes, shared by the enforcement scan and the capacity
 * count so the two can never drift: each (team, player)'s latest lineup entry
 * at or before the league's current week, still rostered, sitting in the IR
 * slot. Callers append their own scoping predicates and select list.
 *
 * `restoredPlaceholder` (a `$n` naming an int[] param) relaxes the
 * still-rostered join for players being added back in the same transaction —
 * but only for a CURRENT-week entry, because that is the one case where the
 * add really does return the player to his slot (the entry survives the drop
 * and materialization leaves same-week rows alone). An older surviving IR
 * entry proves nothing: cross-week materialization copies slots from the
 * team's latest week, where a long-gone player has no row, so he lands on
 * the bench and his stale entry must not grant capacity.
 */
const fromCurrentIrStashes = (restoredPlaceholder = null) => `
       FROM "lineup_entries"
       JOIN "teams" ON "teams"."id" = "lineup_entries"."team_id"
       JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
      WHERE ("team_players"."player_id" IS NOT NULL${restoredPlaceholder ? `
         OR ("lineup_entries"."player_id" = ANY(${restoredPlaceholder}::int[])
             AND "lineup_entries"."week" = "leagues"."current_week")` : ''})
        AND "lineup_entries"."season" = "leagues"."current_season"
        AND "lineup_entries"."week" = (
          SELECT MAX("latest"."week") FROM "lineup_entries" AS "latest"
           WHERE "latest"."team_id" = "lineup_entries"."team_id"
             AND "latest"."player_id" = "lineup_entries"."player_id"
             AND "latest"."season" = "lineup_entries"."season"
             AND "latest"."week" <= "leagues"."current_week"
        )
        AND "lineup_entries"."slot" = 'IR'`;
const INJURY_DESIGNATION_NAMES = {
  Q: 'questionable',
  D: 'doubtful',
  O: 'out',
  IR: 'injured reserve',
};

function isIrEligible(injuryDesignation) {
  return IR_ELIGIBLE_DESIGNATIONS.has(injuryDesignation);
}

function injuryDesignationName(injuryDesignation) {
  return INJURY_DESIGNATION_NAMES[injuryDesignation] || injuryDesignation || 'healthy';
}

/**
 * A team's **roster capacity**: how many players it may hold right now.
 * Draft roster size plus one per IR-eligible player currently stashed in an
 * IR slot, capped at the league's IR slot count. Only eligible occupants
 * grant capacity, so a stash whose occupant recovered leaves the team over
 * capacity — a derived condition that blocks adds until resolved, never a
 * stored flag.
 *
 * `excludePlayerIds` names players leaving the roster in the same
 * transaction (a waiver drop, an outgoing trade piece): their stashes grant
 * nothing, since the move that needs the capacity also empties them.
 * `restoredPlayerIds` names players the transaction is adding: a current-week
 * stash of theirs counts even though they are not on the roster yet, because
 * the add puts them straight back into it — without this, undoing the drop
 * of a stashed player on a full roster would be wrongly rejected.
 *
 * `league` must carry `roster_limit` and `ir_slots`; season and week come
 * from the team's league row inside the query, like the enforcement scan.
 */
async function rosterCapacity(client, { league, teamId, excludePlayerIds = [], restoredPlayerIds = [] }) {
  const base = draftRosterSize(league);
  const irSlots = irSlotCount(league);
  if (irSlots === 0) return base;

  const stash = await client.query(
    `SELECT COUNT(*)::int AS n${fromCurrentIrStashes('$4')}
        AND "lineup_entries"."team_id" = $1
        AND "players"."injury_status" = ANY($2::text[])
        AND NOT ("lineup_entries"."player_id" = ANY($3::int[]))`,
    [teamId, [...IR_ELIGIBLE_DESIGNATIONS], excludePlayerIds, restoredPlayerIds]
  );
  return base + Math.min(irSlots, stash.rows[0].n);
}

async function flagRecoveredIrStashes(client, transitions) {
  const transitionedPlayerIds = [...new Set(
    transitions
      .filter(({ previousDesignation, currentDesignation }) => (
        isIrEligible(previousDesignation) && !isIrEligible(currentDesignation)
      ))
      .map((transition) => transition.playerId)
  )];
  if (transitionedPlayerIds.length === 0) return [];

  const stashes = await client.query(
    `SELECT "lineup_entries"."player_id", "players"."name" AS "player_name",
            "players"."injury_status", "teams"."id" AS "team_id",
            "teams"."owner_id", "teams"."league_id"${fromCurrentIrStashes()}
        AND "lineup_entries"."player_id" = ANY($1::int[])`,
    [transitionedPlayerIds]
  );

  const { notify } = require('./activity.service');
  const irFlags = [];
  for (const stash of stashes.rows) {
    const message = `${stash.player_name} is no longer IR-eligible (${injuryDesignationName(stash.injury_status)}). Move him out of IR before saving your lineup.`;
    await notify(client, {
      userId: stash.owner_id,
      leagueId: stash.league_id,
      type: 'ir_flag',
      message,
      data: { playerId: stash.player_id, teamId: stash.team_id },
    });
    irFlags.push({
      userId: stash.owner_id,
      leagueId: stash.league_id,
      playerId: stash.player_id,
      playerName: stash.player_name,
      message,
    });
  }
  return irFlags;
}

async function sendIrFlagPushes(irFlags) {
  if (irFlags.length === 0) return { sent: 0 };
  const { usersWanting } = require('./prefs.service');
  const push = require('./push.service');
  const userIds = [...new Set(irFlags.map((flag) => flag.userId))];
  const wanted = new Set(await usersWanting(userIds, 'irAlerts'));
  let sent = 0;
  for (const flag of irFlags) {
    if (!wanted.has(flag.userId)) continue;
    const result = await push.sendPushToUsers([flag.userId], {
      title: 'IR roster action required',
      body: flag.message,
      url: `/#/league/${flag.leagueId}/lineup`,
    });
    sent += result.sent;
  }
  return { sent };
}

module.exports = {
  flagRecoveredIrStashes,
  injuryDesignationName,
  isIrEligible,
  rosterCapacity,
  sendIrFlagPushes,
};
