/**
 * The editorial waiver boards: one typed module per week, the week's column
 * picks in the column's order. The public Waiver Wire page reads the board for
 * the waiver week through waiverTargets.service, which gates it by Ownership.
 * Adding a week is adding a module here and listing it below.
 *
 * @typedef {object} WaiverBoardEntry
 * @property {number} playerId `players.id`, the key the endpoint reads by
 * @property {string} name For review only; the served name comes from `players`
 * @property {number} bidMin Low end of the bid, percent of a $100 FAAB budget
 * @property {number} bidMax High end of the bid, percent of a $100 FAAB budget
 * @property {string} reason One line, shown on the card
 *
 * @typedef {object} WaiverBoard
 * @property {number} season
 * @property {number} week
 * @property {WaiverBoardEntry[]} entries Column order; the endpoint keeps it
 */

// No board is seeded yet: the Week 4 2026 board (from the Week 4 Darkness
// Report) needs the real `players.id` values and lands as its own data-only
// change, one module per week required and listed here. Until a week is listed
// the endpoint serves an empty list for it. Prefer the `players.id` row that
// carries the ESPN Ownership (the one with an `external_id`). An id that points
// at a duplicate row of the same athlete still finds that snapshot through the
// athlete's identity rows (same name, position and team), and an athlete listed
// twice is served once. An entry with no Ownership row on any of them is dropped.
/** @type {WaiverBoard[]} */
const BOARDS = [];

/**
 * The board for a season's week, or null when the column has none. Callers
 * must go through this module object (not a destructured copy) so a test can
 * stand in a board.
 *
 * @returns {WaiverBoard | null}
 */
function getBoard(season, week) {
  return BOARDS.find((board) => board.season === season && board.week === week) || null;
}

module.exports = { getBoard };
