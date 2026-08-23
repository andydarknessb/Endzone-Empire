/**
 * Shared fixtures for autoPick() tests: a single-team league so
 * teamForPick() always resolves to that one team regardless of
 * current_pick/rotation, keeping every test focused on candidate ordering
 * rather than draft-order mechanics.
 *
 * Used by server/test/autopick.service.test.js and
 * server/test/bestAvailable.sharedUsage.test.js — extracted so the two
 * don't hand-roll the same pool-mocking boilerplate (#142 code review).
 */
const pool = require('../../modules/pool');

const AUTOPICK_LEAGUE = {
  id: 1, draft_status: 'active', draft_paused: false, current_pick: 0,
  draft_rotation: 'snake', draft_order_overrides: null,
};

// autodraft:true -> not a "timeout" pick, skips the consecutive_timeouts
// bookkeeping branch so tests don't need to mock that UPDATE too.
const AUTOPICK_TEAM = { id: 55, owner_id: 7, autodraft: true };

/**
 * Installs a mock pool.query covering everything autoPick() reads before
 * its candidate query: the league, the (single) team, and season
 * resolution — then answers the candidate query with `candidates` verbatim,
 * unfiltered/unordered by this mock (autoPick sorts them itself).
 */
function installAutopickPool(t, { candidates, league = AUTOPICK_LEAGUE, team = AUTOPICK_TEAM } = {}) {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues" WHERE "id" = $1')) return { rows: [league] };
    if (text.includes('FROM "teams"')) return { rows: [team] };
    if (text.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) return { rows: [{ season: 2026 }] };
    if (text.includes('FROM "players"')) return { rows: candidates };
    throw new Error(`Unexpected SQL: ${text}`);
  });
}

module.exports = { AUTOPICK_LEAGUE, AUTOPICK_TEAM, installAutopickPool };
