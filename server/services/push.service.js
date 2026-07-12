const pool = require('../modules/pool');

/**
 * Web push (VAPID). Depends on the optional `web-push` package plus
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars (VAPID_SUBJECT optional,
 * mailto: or https: URL). Without either, every send silently no-ops —
 * the same graceful-degradation contract as SMTP and the LLM recap.
 *
 * Opt-in is the existence of a push_subscriptions row: the client only
 * creates one after the user grants browser permission, and unsubscribing
 * deletes it. Expired/revoked endpoints (404/410 from the push service)
 * are pruned automatically on send.
 */

function webPushOrNull() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return null;
  try {
    // Optional dependency — only required when VAPID keys are configured
    // eslint-disable-next-line global-require
    const webPush = require('web-push');
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@endzone-empire.local',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    return webPush;
  } catch (err) {
    console.error('web-push unavailable:', err.message);
    return null;
  }
}

/** Is push configured server-side? (Public key for the client, or null.) */
function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/** Store (or refresh) a browser subscription for a user. */
async function saveSubscription({ userId, subscription }) {
  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    !subscription.keys ||
    typeof subscription.keys.p256dh !== 'string' ||
    typeof subscription.keys.auth !== 'string'
  ) {
    const err = new Error('subscription must include endpoint and keys.p256dh/auth');
    err.statusCode = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO "push_subscriptions" ("user_id", "endpoint", "keys")
     VALUES ($1, $2, $3)
     ON CONFLICT ("endpoint")
     DO UPDATE SET "user_id" = EXCLUDED."user_id", "keys" = EXCLUDED."keys",
                   "updated_at" = now()`,
    [userId, subscription.endpoint, JSON.stringify(subscription.keys)]
  );
  return { ok: true };
}

/** Remove a subscription (by endpoint when given, else all of the user's). */
async function removeSubscription({ userId, endpoint }) {
  if (endpoint) {
    await pool.query(
      `DELETE FROM "push_subscriptions" WHERE "user_id" = $1 AND "endpoint" = $2`,
      [userId, endpoint]
    );
  } else {
    await pool.query(`DELETE FROM "push_subscriptions" WHERE "user_id" = $1`, [userId]);
  }
  return { ok: true };
}

/**
 * Send a push to every subscription a set of users holds. payload:
 * { title, body, url }. Dead endpoints are deleted; other errors are logged
 * and skipped. Returns { sent }.
 */
async function sendPushToUsers(userIds, payload) {
  const webPush = webPushOrNull();
  if (!webPush) return { sent: 0 };
  const ids = [...new Set(userIds)].filter((id) => id != null);
  if (ids.length === 0) return { sent: 0 };

  const subs = await pool.query(
    `SELECT "id", "endpoint", "keys" FROM "push_subscriptions" WHERE "user_id" = ANY($1::int[])`,
    [ids]
  );
  let sent = 0;
  for (const sub of subs.rows) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query(`DELETE FROM "push_subscriptions" WHERE "id" = $1`, [sub.id]);
      } else {
        console.error('push send failed:', err.message);
      }
    }
  }
  return { sent };
}

module.exports = {
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushToUsers,
};
