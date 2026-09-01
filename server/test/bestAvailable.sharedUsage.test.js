/**
 * Drift guard for #142: the Draft Sim's pool (publicRead.service.js
 * getDraftPool) and the real draft's autopick fallback (autopick.service.js)
 * must both order candidates through bestAvailable.service.js's
 * compareBestAvailable — never their own reimplementation. This test spies on
 * the shared comparator and fails if either consumer stops calling it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const bestAvailable = require('../services/bestAvailable.service');
const draftService = require('../services/draft.service');
const publicRead = require('../services/publicRead.service');
const { autoPick } = require('../services/pickClock.service');
const { installAutopickPool } = require('./helpers/autopickFixtures');

test('getDraftPool sorts its main tranche through the shared bestAvailable comparator', async (t) => {
  const spy = t.mock.method(bestAvailable, 'compareBestAvailable');

  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('"market_ranks" AS')) {
      // Seeded OUT of best-available order (B before A) — if a consumer
      // called the comparator and then ignored its result (or re-sorted by
      // something else), this would still be wrong, catching the "wiring but
      // not behavior" gap a bare call-count assertion misses.
      return { rows: [
        { id: 2, name: 'B', position: 'WR', nfl_team: 'KC', photo_url: null, injury_status: null, adp: '10', position_rank: 2, last_season_points: null },
        { id: 1, name: 'A', position: 'WR', nfl_team: 'KC', photo_url: null, injury_status: null, adp: '5', position_rank: 1, last_season_points: null },
      ] };
    }
    if (text.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) return { rows: [{ season: 2026 }] };
    if (text.includes('FROM "player_season_stats" WHERE "player_id" = ANY')) return { rows: [] };
    if (text.includes('fn_normalize_nfl_team')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const { players } = await publicRead.getDraftPool({});

  assert.ok(spy.mock.callCount() > 0, 'getDraftPool must sort through bestAvailable.compareBestAvailable');
  // Not just "was it called" — its result must be what actually shipped.
  assert.deepEqual(players.map((p) => p.playerId), [1, 2]);
});

test('autopick sorts unqueued candidates through the shared bestAvailable comparator', async (t) => {
  const spy = t.mock.method(bestAvailable, 'compareBestAvailable');

  // Seeded OUT of best-available order (B before A) — same "wiring but not
  // behavior" guard as the getDraftPool case above.
  installAutopickPool(t, { candidates: [
    { id: 2, name: 'B', adp: '10', queue_rank: null, last_season_points: null },
    { id: 1, name: 'A', adp: '5', queue_rank: null, last_season_points: null },
  ] });
  const attempts = [];
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => {
    attempts.push(playerId);
    return { player: { id: playerId }, draftComplete: false };
  });

  await autoPick({ leagueId: 1 });

  assert.ok(spy.mock.callCount() > 0, 'autoPick must sort unqueued candidates through bestAvailable.compareBestAvailable');
  // Not just "was it called" — its result must be what actually got picked.
  assert.deepEqual(attempts, [1]);
});
