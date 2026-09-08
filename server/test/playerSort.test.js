const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const playerRouter = require('../routes/player.router');
const { ACCEPTED_SORT_FIELDS } = require('../services/playerSort');

/**
 * ACCEPTED_SORT_FIELDS is the named authority for the `?sort=` values
 * GET /api/players honours (#951), but the router's ordering branches were not
 * rewritten to derive from it: the if/else chain and the two booleans
 * (projectionSort, byeSort) independently re-encode the same values. The module
 * says so itself ("Keep this list and the router's ordering branches in step"),
 * and until this file nothing tested it (#1000). The client parity test under
 * src/ asserts the SUBSET direction - every Draft-room wire name is in the list
 * - which cannot see a SUPERSET drift: a value added to the list with no branch
 * is accepted, falls through to the stable `ORDER BY "id"`, and every test in
 * the repo stays green while the user's pool silently reshuffles into id order.
 *
 * The ruling on #1000 was TEST, NOT RESTRUCTURE: the chain and the booleans stay
 * exactly as they are, and this file is the guard.
 *
 * WHAT COUNTS AS "HAS A BRANCH". The router settles a sort one of two ways, and
 * both are observable in the SQL it emits:
 *
 *   SQL-sorted   the ORDER BY names the sort's own column, and the query keeps
 *                its LIMIT/OFFSET page.
 *   JS-sorted    projected_points and bye_week are computed, not stored, so
 *                they legitimately emit the fallback `ORDER BY "id"` - but they
 *                take the FULL-POOL path, which drops the LIMIT so the whole
 *                matching pool can be sorted in JS before the page is sliced.
 *
 * The fallback is the pair (`ORDER BY "id"`, LIMIT present). A value that hits
 * neither path emits exactly what an unrecognised value emits, which is why the
 * control below is a nonsense sort value rather than a hard-coded string: the
 * comparison is against the router's own real fallback, measured in the same
 * run.
 *
 * The list is read at runtime, never copied here. A seventh entry with no branch
 * fails the first test, naming the value.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-sort-coverage-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

const TOKEN = () => signToken({ id: 7, username: 'member' });

// Bye weeks: the week each team has no game in 1..18. Deliberately NOT id order
// and not alphabetical, so an output ordering that matches this is evidence the
// JS bye comparator ran rather than the SQL id fallback surviving.
const BYES = { KC: 5, SF: 9, BUF: 12 };
const REG_SEASON_WEEKS = 18;

const playerRows = [
  { id: 1, name: 'Buffalo Back', position: 'RB', nfl_team: 'BUF', adp: 3, total_count: '3' },
  { id: 2, name: 'Kansas Kicker', position: 'K', nfl_team: 'KC', adp: 1, total_count: '3' },
  { id: 3, name: 'Frisco Flanker', position: 'WR', nfl_team: 'SF', adp: 2, total_count: '3' },
];

const nflGameRows = Object.entries(BYES).flatMap(([team, bye]) => Array.from(
  { length: REG_SEASON_WEEKS }, (_, index) => index + 1
).filter((week) => week !== bye).map((week) => ({ nfl_team: team, week })));

// The final ORDER BY of the pool query, normalised. `lastIndexOf` because the
// query also carries ORDER BYs inside its CTEs and a window function; the
// router's `ORDER BY ${orderBy}` is the last one in the text.
function tailOrderBy(sql) {
  const start = sql.lastIndexOf('ORDER BY');
  assert.notEqual(start, -1, 'the pool query has an ORDER BY');
  const tail = sql.slice(start + 'ORDER BY'.length);
  const limit = tail.indexOf('LIMIT');
  return (limit === -1 ? tail : tail.slice(0, limit)).replace(/\s+/g, ' ').trim();
}

const sqlPaginated = (sql) => /LIMIT \$/.test(sql);

// Drives one GET /api/players?sort=<value> through the real router over a mocked
// pool and reports how the emitted pool query settled the ordering.
async function orderingFor(t, sortValue) {
  const poolQueries = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    // The pool query is the one carrying the window count. Matching it on
    // FROM "players" would be wrong: its own idp_ranks CTE also reads
    // player_season_stats, so a bare table-name match picks the wrong handler
    // and the pool query is never recorded at all (found the hard way).
    if (text.includes('COUNT(*) OVER() AS total_count')) {
      poolQueries.push(text);
      return { rows: playerRows };
    }
    if (text.includes('FROM "nfl_games"')) return { rows: nflGameRows };
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const response = await request(app)
    .get(`/api/players?sort=${encodeURIComponent(sortValue)}`)
    .set('Authorization', `Bearer ${TOKEN()}`);
  t.mock.restoreAll();

  assert.equal(response.status, 200, `?sort=${sortValue} answers 200`);
  assert.equal(poolQueries.length, 1, `?sort=${sortValue} runs one pool query`);
  const sql = poolQueries[0];
  return {
    orderBy: tailOrderBy(sql),
    paginatedInSql: sqlPaginated(sql),
    ids: response.body.players.map((player) => player.id),
  };
}

test('every ACCEPTED_SORT_FIELDS value reaches a real ordering branch, not the id fallback', async (t) => {
  // The control: a value the router does not accept. Whatever this emits IS the
  // fallback, measured rather than assumed.
  const fallback = await orderingFor(t, 'not-a-sort-field');
  assert.equal(fallback.orderBy, '"id"', 'the unrecognised-value fallback orders by id');
  assert.equal(fallback.paginatedInSql, true, 'the fallback pages in SQL');

  assert.ok(ACCEPTED_SORT_FIELDS.length > 0, 'the list is not empty');
  for (const field of ACCEPTED_SORT_FIELDS) {
    const settled = await orderingFor(t, field);
    const isFallback = settled.orderBy === fallback.orderBy
      && settled.paginatedInSql === fallback.paginatedInSql;
    assert.equal(
      isFallback,
      false,
      `ACCEPTED_SORT_FIELDS lists "${field}", but GET /api/players?sort=${field} emitted the `
      + `same ordering as an unrecognised value (ORDER BY ${fallback.orderBy}, SQL-paged), so the `
      + `router has no ordering branch and no full-pool boolean for it and the pool comes back in `
      + `id order silently. Add a branch or boolean in player.router.js, or drop "${field}" from `
      + `ACCEPTED_SORT_FIELDS in server/services/playerSort.js.`
    );
  }
});

test('each ACCEPTED_SORT_FIELDS value settles through the path its kind requires', async (t) => {
  // The two computed fields are not columns, so they take the full-pool path and
  // sort in JS; everything else is a stored column the SQL orders by. This is
  // the same invariant as the test above, stated per value so a value that moves
  // between the two kinds without its branch moving is also caught.
  const JS_SORTED = new Set(['projected_points', 'bye_week']);

  for (const field of ACCEPTED_SORT_FIELDS) {
    const settled = await orderingFor(t, field);
    if (JS_SORTED.has(field)) {
      assert.equal(
        settled.paginatedInSql, false,
        `"${field}" is computed, so the route must fetch the full pool (no SQL LIMIT) and sort in JS`
      );
    } else {
      assert.equal(
        settled.paginatedInSql, true,
        `"${field}" is a stored column, so the route should still page in SQL`
      );
      assert.ok(
        settled.orderBy.includes(`"${field}"`),
        `"${field}" is a stored column, so the emitted ORDER BY should name it; got: ${settled.orderBy}`
      );
    }
  }
});

test('bye_week really re-sorts in JS: the returned order is by bye week, not by id', async (t) => {
  // The observable half of the full-pool claim. The rows come back from SQL in
  // id order (BUF, KC, SF -> byes 12, 5, 9); the returned page is bye order.
  const settled = await orderingFor(t, 'bye_week');

  assert.equal(settled.paginatedInSql, false);
  assert.equal(settled.orderBy, '"id"', 'bye is schedule-derived, so SQL legitimately orders by id');
  assert.deepEqual(settled.ids, [2, 3, 1], 'KC (bye 5), SF (bye 9), BUF (bye 12)');
});
