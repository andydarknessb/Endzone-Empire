const pool = require('../modules/pool');

class PrefsError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Notification delivery preferences. Opt-out model: a missing row, or a
 * missing key within a stored row, means the preference is ON.
 */
const DEFAULT_PREFS = {
  lineupReminder: true,
  waiverResults: true,
  weeklyRecap: true,
  tradeOffers: true,
};

/** Pure: merge a stored prefs object onto the defaults. Unknown stored keys are ignored. */
function mergePrefs(stored) {
  const merged = { ...DEFAULT_PREFS };
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (typeof stored[key] === 'boolean') merged[key] = stored[key];
    }
  }
  return merged;
}

/** Pure: validate a prefs patch — only known keys, boolean values. Returns error strings (empty = valid). */
function validatePrefs(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
    return ['prefs must be an object'];
  }
  const errors = [];
  for (const [key, value] of Object.entries(prefs)) {
    if (!(key in DEFAULT_PREFS)) {
      errors.push(`unknown preference "${key}"`);
      continue;
    }
    if (typeof value !== 'boolean') {
      errors.push(`preference "${key}" must be a boolean`);
    }
  }
  return errors;
}

/** The caller's notification preferences, with defaults filled in for anything unset. */
async function getPrefs({ userId }) {
  const result = await pool.query(
    `SELECT "prefs" FROM "notification_prefs" WHERE "user_id" = $1`,
    [userId]
  );
  return mergePrefs(result.rows[0] && result.rows[0].prefs);
}

/**
 * Upsert the caller's preferences from a partial patch. Only known boolean
 * keys are accepted; anything else throws a 400-style PrefsError. Existing
 * preferences not named in the patch are left as they were.
 */
async function setPrefs({ userId, prefs }) {
  const errors = validatePrefs(prefs);
  if (errors.length > 0) throw new PrefsError(400, errors.join('; '));

  const current = await getPrefs({ userId });
  const merged = { ...current, ...prefs };
  await pool.query(
    `INSERT INTO "notification_prefs" ("user_id", "prefs")
     VALUES ($1, $2)
     ON CONFLICT ("user_id")
     DO UPDATE SET "prefs" = $2, "updated_at" = now()`,
    [userId, JSON.stringify(merged)]
  );
  return merged;
}

/**
 * Filter a list of user ids down to those with `key` enabled. Missing rows
 * default to enabled (opt-out model). Single query regardless of list size.
 */
async function usersWanting(userIds, key) {
  const ids = [...new Set(userIds)].filter((id) => id != null);
  if (ids.length === 0) return [];
  const result = await pool.query(
    `SELECT "user_id", "prefs" FROM "notification_prefs" WHERE "user_id" = ANY($1::int[])`,
    [ids]
  );
  const stored = new Map(result.rows.map((r) => [r.user_id, r.prefs]));
  return ids.filter((id) => mergePrefs(stored.get(id))[key]);
}

module.exports = {
  PrefsError,
  DEFAULT_PREFS,
  mergePrefs,
  validatePrefs,
  getPrefs,
  setPrefs,
  usersWanting,
};
