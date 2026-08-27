const pool = require('../modules/pool');

const BATCH_SIZE = 1000;

async function deleteBatch(table, predicate, params = []) {
  const result = await pool.query(
    `DELETE FROM "${table}" WHERE ctid IN (
       SELECT ctid FROM "${table}" WHERE ${predicate} LIMIT ${BATCH_SIZE}
     )`,
    params
  );
  return result.rowCount;
}

/**
 * Delete a batch of chat messages AND the feed positions they own, in one
 * statement (#436, ADR 0015). A deleted message must leave a GAP in the feed -
 * no renumber, no reused position, no retained copy (ADR 0012) - and the shared
 * registry "mirrors positions the record tables still hold" (ADR 0015), so a
 * deleted chat row's registry position must go with it or it becomes an orphan
 * a later reconciliation would (correctly) flag. The counter is untouched, so
 * the freed position is never re-handed-out. Returns the chat rows removed.
 */
async function deleteChatMessagesBatch(predicate, params = [], db = pool) {
  const result = await db.query(
    `WITH doomed AS (
       SELECT "ctid", "id", "league_id" FROM "chat_messages"
        WHERE ${predicate} LIMIT ${BATCH_SIZE}
     ),
     purged_positions AS (
       DELETE FROM "league_feed_positions" pos
        USING doomed d
        WHERE pos."record_kind" = 'league_chat'
          AND pos."league_id" = d."league_id"
          AND pos."source_id" = d."id"
     )
     DELETE FROM "chat_messages"
      WHERE "ctid" IN (SELECT "ctid" FROM doomed)`,
    params
  );
  return result.rowCount;
}

async function enforceRetention() {
  const chatDays = Number(process.env.RETENTION_CHAT_DAYS || 730);
  const notificationDays = Number(process.env.RETENTION_NOTIFICATION_DAYS || 365);
  const counts = {};
  counts.authTokens = await deleteBatch(
    'auth_tokens',
    `("expires_at" < now() - interval '7 days')
      OR ("used" = true AND "updated_at" < now() - interval '7 days')`
  );
  counts.refreshTokens = await deleteBatch(
    'refresh_tokens',
    `("expires_at" < now() - interval '30 days')
      OR ("revoked" = true AND "updated_at" < now() - interval '30 days')`
  );
  counts.notifications = await deleteBatch(
    'notifications',
    `"created_at" < now() - make_interval(days => $1)`,
    [notificationDays]
  );
  counts.chatMessages = await deleteChatMessagesBatch(
    `"created_at" < now() - make_interval(days => $1)`,
    [chatDays]
  );
  return counts;
}

module.exports = { BATCH_SIZE, enforceRetention, deleteChatMessagesBatch };
