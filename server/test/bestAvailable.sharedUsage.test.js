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
const { autoPick } = require('../services/autopick.service');

test('getDraftPool sorts its main tranche through the shared bestAvailable comparator', async (t) => {
  const spy = t.mock.method(bestAvailable, 'compareBestAvailable');

  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('"market_ranks" AS')) {
      return { rows: [
        { id: 1, name: 'A', position: 'WR', nfl_team: 'KC', photo_url: null, injury_status: null, adp: '5', position_rank: 1, last_season_points: null },
        { id: 2, name: 'B', position: 'WR', nfl_team: 'KC', photo_url: null, injury_status: null, adp: '10', position_rank: 2, last_season_points: null },
      ] };
    }
    if (text.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) return { rows: [{ season: 2026 }] };
    if (text.includes('FROM "player_season_stats" WHERE "player_id" = ANY')) return { rows: [] };
    if (text.includes('fn_normalize_nfl_team')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  await publicRead.getDraftPool({});

  assert.ok(spy.mock.callCount() > 0, 'getDraftPool must sort through bestAvailable.compareBestAvailable');
});

test('autopick sorts unqueued candidates through the shared bestAvailable comparator', async (t) => {
  const spy = t.mock.method(bestAvailable, 'compareBestAvailable');

  const league = {
    id: 1, draft_status: 'active', draft_paused: false, current_pick: 0,
    draft_rotation: 'snake', draft_order_overrides: null,
  };
  const team = { id: 55, owner_id: 7, autodraft: true };

  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues" WHERE "id" = $1')) return { rows: [league] };
    if (text.includes('FROM "teams"')) return { rows: [team] };
    if (text.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) return { rows: [{ season: 2026 }] };
    if (text.includes('FROM "players"')) {
      return { rows: [
        { id: 1, name: 'A', adp: '5', queue_rank: null, last_season_points: null },
        { id: 2, name: 'B', adp: '10', queue_rank: null, last_season_points: null },
      ] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => ({ player: { id: playerId }, draftComplete: false }));

  await autoPick({ leagueId: 1 });

  assert.ok(spy.mock.callCount() > 0, 'autoPick must sort unqueued candidates through bestAvailable.compareBestAvailable');
});
