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
  counts.chatMessages = await deleteBatch(
    'chat_messages',
    `"created_at" < now() - make_interval(days => $1)`,
    [chatDays]
  );
  return counts;
}

module.exports = { BATCH_SIZE, enforceRetention };
