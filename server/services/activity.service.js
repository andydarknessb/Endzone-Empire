/**
 * Shared helpers for the league transaction log and in-app notifications.
 * Both take the caller's transaction client so activity rows commit (or roll
 * back) atomically with the action they describe.
 */

// ADR 0008's SCREAMING_SNAKE spelling applies to error CODES, not to these -
// `"type"` here is a database value (a `transactions` column), the same
// category the ADR's Scope section carves out for `draft_status` and the
// like, so it stays as every call site already spells it.
//
// The one place this app declares which types it will ever write. Every
// `logTransaction(` call site passes a literal from this list (#1134 found
// the seventh, `recap`, reaching the client with no matching case because
// nothing pinned the two sides together). `server/test/activity.service.test.js`
// asserts this array's exact shape, so an eighth type added here turns that
// suite red before it can ship - that's the tripwire. The client's
// `src/entities/activity/model/activityModel.test.js` keeps a hard-coded
// copy of this exact array as the required follow-through: once the server
// test sends someone here, updating the client list is what then proves the
// new type renders a real sentence instead of a blank row.
const TRANSACTION_TYPES = ['add', 'commissioner', 'drop', 'recap', 'stat_correction', 'trade', 'waiver'];

class ActivityError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function logTransaction(client, { leagueId, teamId = null, type, detail = {} }) {
  if (!TRANSACTION_TYPES.includes(type)) {
    throw new ActivityError(400, `unknown transaction type: ${type}`, 'UNKNOWN_TRANSACTION_TYPE');
  }
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

module.exports = { logTransaction, notify, notifyLeague, TRANSACTION_TYPES, ActivityError };
