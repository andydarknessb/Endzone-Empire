const { draftRosterSize, irSlotCount } = require('./rosterShape');

const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);

/**
 * The current IR stashes, shared by the enforcement scan and the capacity
 * count so the two can never drift: each (team, player)'s latest lineup entry
 * at or before the league's current week, still rostered, sitting in the IR
 * slot. Callers append their own scoping predicates and select list.
 *
 * `restoredPlaceholder` (a `$n` naming an int[] param) relaxes the
 * still-rostered join for a player an undo is putting back in the same
 * transaction, but only through the entry the undo really returns him to —
 * the one `lineup.service`'s materialization will show him in:
 *   - his current-week row: it survived the drop and materialization leaves
 *     existing rows alone, so he sits straight back in it;
 *   - his row in the team's latest earlier week: that week is the
 *     copy-forward source for a not-yet-touched current week (and for any
 *     player missing from an already-touched one), so the stash is revived.
 * Anything older grants nothing: the copy-forward has no row for him there
 * and benches him. Every other acquisition benches the player explicitly
 * (`benchAcquiredPlayer`), so it passes no restored ids at all.
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
             AND ("lineup_entries"."week" = "leagues"."current_week"
                  OR "lineup_entries"."week" = (
                    SELECT MAX("source"."week") FROM "lineup_entries" AS "source"
                     WHERE "source"."team_id" = "lineup_entries"."team_id"
                       AND "source"."season" = "lineup_entries"."season"
                       AND "source"."week" < "leagues"."current_week"
                  )))` : ''})
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
 * `restoredPlayerIds` names a player an undo is putting back: the stash the
 * undo returns him to (see `fromCurrentIrStashes`) counts even though he is
 * not on the roster yet — without this, undoing the drop of a stashed player
 * on a full roster would be wrongly rejected. Only `undoDrop` passes it; a
 * waiver, trade, commissioner or free-agent add benches the player instead,
 * so his old stash rows grant nothing to the add.
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

/**
 * Would undoing this player's drop return him to a valid stash? True when the
 * entry an undo lands him in (see `fromCurrentIrStashes`) is an IR slot held
 * by an IR-eligible player. `undoDrop` benches him otherwise: a stash that
 * stopped being valid while he was off the roster must not be restored past
 * the placement gate, and the enforcement scan (which only sees rostered
 * players) would never have flagged it. Ask before the roster insert, while
 * the still-rostered join is the relaxed one.
 */
async function undoRestoresStash(client, { teamId, playerId }) {
  const stash = await client.query(
    `SELECT 1${fromCurrentIrStashes('$2')}
        AND "lineup_entries"."team_id" = $1
        AND "lineup_entries"."player_id" = ANY($2::int[])
        AND "players"."injury_status" = ANY($3::text[])
      LIMIT 1`,
    [teamId, [playerId], [...IR_ELIGIBLE_DESIGNATIONS]]
  );
  return stash.rows.length > 0;
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
  undoRestoresStash,
};
