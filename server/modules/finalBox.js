/**
 * The Final box handoff timer (#1186, ADR 0035).
 *
 * When the scoreboard poll moves a game to `final`, the Final box (one Tank01
 * `/getNFLBoxScore` at essential priority, applied with no Scoring plays, then
 * `final_stats_synced_at` stamped) is due FINAL_BOX_GRACE_MS later (default 15
 * min), so Tank01's box has settled and one call is enough. The due action is
 * gameRecap.enqueueRecap: generateForGame is the Final box path (it fetches at
 * essential priority, ingests, stamps, then builds the recap from the same box).
 *
 * The recap reconciliation sweep can enqueue a fresh final before its grace is
 * up; generateForGame asks `isWithinGrace` and declines, so the sweep cannot
 * jump the queue. A worker restart inside the grace loses the timer, and the
 * sweep (every 5 minutes) is what heals that; the box is then read on the
 * sweep's schedule rather than at T+15, which is the accepted cost.
 */
const pending = new Map(); // gameId -> due epoch ms

function graceMs() {
  const parsed = Number(process.env.FINAL_BOX_GRACE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000;
}

function defaultOnDue(gameId) {
  // Lazy: gameRecap requires scoring.service, which requires modules this file
  // must not pull in at load time.
  require('../services/gameRecap.service').enqueueRecap(gameId);
}

/**
 * Arm the Final box for a game that just went final. Deduped: a second call
 * for a game already pending arms nothing and returns false.
 *
 * @param {string} gameId tank01_game_id
 * @param {{ now?: number, setTimer?: Function, onDue?: Function }} [deps]
 * @returns {boolean} whether a timer was armed
 */
function scheduleFinalBox(gameId, { now = Date.now(), setTimer = setTimeout, onDue = defaultOnDue } = {}) {
  if (pending.has(gameId)) return false;
  const delay = graceMs();
  pending.set(gameId, now + delay);
  const timer = setTimer(() => {
    pending.delete(gameId);
    try {
      onDue(gameId);
    } catch (err) {
      console.error('finalBox: due action failed for %s:', gameId, err && err.message);
    }
  }, delay);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return true;
}

/** When the Final box for this game is due, or null when none is pending. */
function finalBoxDueAt(gameId) {
  return pending.has(gameId) ? pending.get(gameId) : null;
}

/** True while a Final box is pending for the game and its grace has not run out. */
function isWithinGrace(gameId, now = Date.now()) {
  const due = pending.get(gameId);
  return due != null && now < due;
}

module.exports = {
  scheduleFinalBox,
  finalBoxDueAt,
  isWithinGrace,
  graceMs,
  __resetFinalBoxState() {
    pending.clear();
  },
};
