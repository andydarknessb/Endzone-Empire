const pool = require('../modules/pool');
const { usersWanting } = require('./prefs.service');

// web-push sets no request timeout; a hung endpoint would hold the scheduler tick (and its advisory lock) forever.
const SEND_TIMEOUT_MS = 10_000;
// `timeout` is a socket idle timer: an endpoint trickling a byte at a time never trips it. This is the wall clock.
const SEND_DEADLINE_MS = 15_000;

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`push send timed out after ${ms} ms`)), ms);
    timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

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

// The send POSTs to whatever endpoint is stored, so only a real push service is
// accepted: an https URL on one of these hosts.
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
// WNS gives each device its own hostname, e.g. wns2-par02p.notify.windows.com.
const WNS_HOST = 'notify.windows.com';

const MAX_SUBSCRIPTIONS_PER_USER = 10;

function isPushServiceEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return PUSH_HOSTS.includes(url.hostname)
    || url.hostname === WNS_HOST
    || url.hostname.endsWith(`.${WNS_HOST}`);
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
  if (!isPushServiceEndpoint(subscription.endpoint)) {
    const err = new Error('endpoint must be an https URL on a push service');
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
  // Each send is one POST: an unbounded collection of endpoints is a way to
  // stall the sending path, so a Manager keeps only the ten most recently saved.
  await pool.query(
    `DELETE FROM "push_subscriptions"
     WHERE "user_id" = $1 AND "id" NOT IN (
       SELECT "id" FROM "push_subscriptions" WHERE "user_id" = $1
       ORDER BY "updated_at" DESC, "id" DESC LIMIT $2
     )`,
    [userId, MAX_SUBSCRIPTIONS_PER_USER]
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
 * { title, body, url, banter? }. A `banter` string (pushBanter.js) is appended
 * as a second body line for users whose `banter` preference is on, and is never
 * part of the delivered JSON. The prefs lookup runs only when `banter` is a
 * non-empty string and the users hold at least one subscription; if it fails,
 * the error is logged and every user gets the plain body. Dead endpoints are
 * deleted; other errors are logged and skipped. Returns { sent }.
 */
async function sendPushToUsers(userIds, payload) {
  const webPush = webPushOrNull();
  if (!webPush) return { sent: 0 };
  const ids = [...new Set(userIds)].filter((id) => id != null);
  if (ids.length === 0) return { sent: 0 };

  const subs = await pool.query(
    `SELECT "id", "user_id", "endpoint", "keys" FROM "push_subscriptions" WHERE "user_id" = ANY($1::int[])`,
    [ids]
  );
  const { banter, ...plain } = payload;
  const hasBanter = typeof banter === 'string' && banter !== '';
  let bantering = new Set();
  if (hasBanter && subs.rows.length > 0) {
    try {
      bantering = new Set(await usersWanting(ids, 'banter'));
    } catch (err) {
      console.error('banter prefs lookup failed, sending plain:', err.message);
    }
  }
  let sent = 0;
  for (const sub of subs.rows) {
    try {
      const out = hasBanter && bantering.has(sub.user_id)
        ? { ...plain, body: `${plain.body}\n${banter}` }
        : plain;
      await withDeadline(
        webPush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(out),
          { timeout: SEND_TIMEOUT_MS }
        ),
        SEND_DEADLINE_MS
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
