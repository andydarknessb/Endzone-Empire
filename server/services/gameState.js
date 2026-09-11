/**
 * THE GAME STATE QUESTION, once (#1235): is an NFL game 'scheduled', 'in
 * progress', or 'final', given what the live score table, the schedule and a
 * player's own points on the board each say? A pure leaf (no requires, no
 * pool) so it can be shared by every surface that answers this question
 * without either side cycling through the other - `expectedFinal.service.js`
 * (the Matchup surfaces: list, detail, the live score sync's `scores:updated`
 * emit) and `lineup.service.js` (the Lineup entry's Edge line, `pace`/
 * `result`) both require it directly.
 *
 * Before #1235 this lived only in `expectedFinal.service.js`, and
 * `lineup.service.js` could not require it there: that module already
 * requires `lineup.service` (for `optimalLineup`/`parseLineupSettings`), so a
 * reverse require would cycle. Moving the pure rule out to its own leaf - the
 * same move `rosterSlots.js` made for `DEFAULT_ROSTER_SLOTS` - breaks the
 * cycle without either caller importing the other.
 */

/**
 * With no live row, a game is taken as over this long after its scheduled
 * kickoff. NFL games run about three and a half hours; five leaves room for
 * a long overtime and a weather delay. Without this bound a week the live
 * engine never covered would keep every starter "in progress" forever, at
 * his full projection and counted as remaining.
 */
const NO_LIVE_ROW_FINAL_AFTER_MS = 5 * 60 * 60 * 1000;

/**
 * Resolve a game's state, pure. `liveStatus` is the live table's status for
 * the team or null; `kickoffAt` is the schedule's kickoff or null; `onBye`
 * means no game this week. The live table wins when it has a row; otherwise
 * the schedule decides: before kickoff not started, after it in progress, and
 * well after it (NO_LIVE_ROW_FINAL_AFTER_MS) final. Points already on the
 * board prove the game began even when the schedule and the live table both
 * still say otherwise.
 */
function gameStateFor({ liveStatus, kickoffAt, onBye, points, now }) {
  if (onBye) return 'final';
  const actual = Number(points) || 0;
  if (liveStatus === 'final') return 'final';
  if (liveStatus === 'in_progress') return 'in_progress';
  if (liveStatus === 'scheduled') return actual > 0 ? 'in_progress' : 'scheduled';
  const kickoff = kickoffAt && now ? new Date(kickoffAt).getTime() : null;
  const at = now ? new Date(now).getTime() : null;
  if (kickoff != null && Number.isFinite(kickoff) && at != null) {
    if (at - kickoff >= NO_LIVE_ROW_FINAL_AFTER_MS) return 'final';
    if (at >= kickoff) return 'in_progress';
  }
  return actual > 0 ? 'in_progress' : 'scheduled';
}

module.exports = { gameStateFor, NO_LIVE_ROW_FINAL_AFTER_MS };
