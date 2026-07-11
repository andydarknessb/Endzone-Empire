/**
 * Shared helpers for the league transaction log and in-app notifications.
 * Both take the caller's transaction client so activity rows commit (or roll
 * back) atomically with the action they describe.
 */
async function logTransaction(client, { leagueId, teamId = null, type, detail = {} }) {
  await client.query(
    `INSERT INTO "transactions" ("league_id", "team_id", "type", "detail")
     VALUES ($1, $2, $3, $4)`,
    [leagueId, teamId, type, JSON.stringify(detail)]
  );
}

async function notify(client, { userId, leagueId = null, type, message, data = {} }) {
  await client.query(
    `INSERT INTO "notifications" ("user_id", "league_id", "type", "message", "data")
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, leagueId, type, message, JSON.stringify(data)]
  );
}

/** Notify every team owner in a league (optionally excluding some user ids). */
async function notifyLeague(client, { leagueId, type, message, data = {}, excludeUserIds = [] }) {
  const owners = await client.query(
    `SELECT DISTINCT "owner_id" FROM "teams" WHERE "league_id" = $1`,
    [leagueId]
  );
  for (const row of owners.rows) {
    if (excludeUserIds.includes(row.owner_id)) continue;
    await notify(client, { userId: row.owner_id, leagueId, type, message, data });
  }
}

module.exports = { logTransaction, notify, notifyLeague };
