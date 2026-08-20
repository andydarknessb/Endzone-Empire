const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);
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
            "teams"."owner_id", "teams"."league_id"
       FROM "lineup_entries"
       JOIN "teams" ON "teams"."id" = "lineup_entries"."team_id"
       JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
       JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
      WHERE "lineup_entries"."player_id" = ANY($1::int[])
        AND "lineup_entries"."season" = "leagues"."current_season"
        AND "lineup_entries"."week" = (
          SELECT MAX("latest"."week") FROM "lineup_entries" AS "latest"
           WHERE "latest"."team_id" = "lineup_entries"."team_id"
             AND "latest"."player_id" = "lineup_entries"."player_id"
             AND "latest"."season" = "lineup_entries"."season"
             AND "latest"."week" <= "leagues"."current_week"
        )
        AND "lineup_entries"."slot" = 'IR'`,
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
  sendIrFlagPushes,
};
