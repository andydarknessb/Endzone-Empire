const { injuryDesignationName, isValidStash } = require('./irPolicy.service');

/**
 * Home status: the answers the pre-lockout digests, the Home to-do list
 * (GET /api/user/action-items) and the league status cards
 * (GET /api/league?include=status) all ask of a lineup and a Pick'em week -
 * "is a slot empty", "is a starter out", "how many picks are still open",
 * "when does it lock". One module, so an email, a card and a to-do row built
 * from the same rows can never disagree.
 *
 * The builders here are pure over rows the callers already read; the digest
 * keeps its own per-league queries and the Home endpoints batch theirs across
 * the viewer's leagues, but both hand the same row shapes to the same
 * builders.
 */

/**
 * Pure: problems in a lineup that should trigger a pre-lockout reminder.
 * entries: [{ slot, name, onBye, injury_status, ir_attested }] (starter
 * availability and unresolved IR stashes are flagged; BENCH is ignored and a
 * commissioner-attested stash never nags). rosterSlots:
 * [{key,count,...}] detects unfilled slots.
 * Returns human-readable problem strings (empty = lineup looks fine).
 */
function lineupProblems(entries, rosterSlots = []) {
  const problems = [];
  const starters = entries.filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR');

  const filled = {};
  for (const s of starters) filled[s.slot] = (filled[s.slot] || 0) + 1;
  for (const { key: slot, count } of rosterSlots) {
    const have = filled[slot] || 0;
    if (have < count) {
      problems.push(`${count - have} empty ${slot} slot${count - have === 1 ? '' : 's'}`);
    }
  }

  for (const s of starters) {
    if (s.onBye) problems.push(`${s.name} (${s.slot}) is on bye`);
    else if (s.injury_status === 'O' || s.injury_status === 'IR') {
      problems.push(`${s.name} (${s.slot}) is ${s.injury_status === 'O' ? 'Out' : 'on IR'}`);
    }
  }
  for (const stash of entries.filter((entry) => entry.slot === 'IR')) {
    // A commissioner-attested stash is valid by fiat (#100) - never nagged.
    if (!isValidStash(stash)) {
      problems.push(
        `${stash.name} (IR) is no longer IR-eligible (${injuryDesignationName(stash.injury_status)})`
      );
    }
  }
  return problems;
}

/**
 * Pure: one lineup_entries row (joined to players, with the week's bye read
 * off the nfl_games LEFT JOIN as `on_bye`) in the shape `lineupProblems`
 * reads.
 */
function lineupEntryFromRow(row) {
  return {
    slot: row.slot,
    name: row.name,
    onBye: row.on_bye,
    injury_status: row.injury_status,
    ir_attested: row.ir_attested,
  };
}

/**
 * Pure: the league-type rule over `lineupProblems`. A best-ball league has no
 * set lineup (the optimizer picks the starters), so only its unresolved IR
 * stashes are the manager's to fix; every other league is checked in full
 * against its roster slots.
 */
function leagueLineupProblems({ entries, rosterSlots, bestBall }) {
  return bestBall
    ? lineupProblems(entries.filter((entry) => entry.slot === 'IR'), [])
    : lineupProblems(entries, rosterSlots);
}

/**
 * Pure: the slate's game keys that have NOT locked at `now` (a game locks
 * inclusively at kickoff, pickem.service's isGameLocked). Games already past
 * kickoff are excluded: there is nothing left for the manager to do about
 * those.
 */
function openGameKeys(slate, now) {
  // Required lazily, the way the digest always reached pickem.service: this
  // module sits under the digest's own require and needs one pure helper.
  const { isGameLocked } = require('./pickem.service');
  return slate.filter((game) => !isGameLocked(game, now)).map((game) => game.gameKey);
}

/** Pure: pickem_picks rows ({ user_id, team_pair }) -> Map<user_id, Set<team_pair>>. */
function picksMadeByUser(rows) {
  const madeByUser = new Map();
  for (const row of rows) {
    if (!madeByUser.has(row.user_id)) madeByUser.set(row.user_id, new Set());
    madeByUser.get(row.user_id).add(row.team_pair);
  }
  return madeByUser;
}

/** Pure: the open game keys this manager has not picked yet. */
function missingPicks(openKeys, made = new Set()) {
  return openKeys.filter((gameKey) => !made.has(gameKey));
}

module.exports = {
  lineupProblems,
  lineupEntryFromRow,
  leagueLineupProblems,
  openGameKeys,
  picksMadeByUser,
  missingPicks,
};
