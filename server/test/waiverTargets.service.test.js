const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const projectionService = require('../services/projection.service');
const waiverBoards = require('../services/waiverBoards');
const { getWaiverTargets } = require('../services/waiverTargets.service');

/**
 * The public Waiver Targets' computed list (spec #1830) takes its availability
 * from the Start verdict (ADR 0061), the Weekly projection read's one answer:
 * a candidate is kept only when the verdict's outcome is Recommendable. The
 * service passes no injury designation of its own and re-decides nothing, so a
 * Doubtful player is out because the read says Not recommended, whatever his
 * player row carries.
 */

// Weeks 1 to 3 are over, so the waiver week is 4 (no games listed for it).
const games = [1, 2, 3].flatMap((week) => [
  { week, nfl_team: 'KC', opponent: 'BUF', kickoff_at: `2026-09-0${week}T00:20:00Z`, game_key: `${week}_BUF_KC`, roof: null, home_away: 'home' },
  { week, nfl_team: 'BUF', opponent: 'KC', kickoff_at: `2026-09-0${week}T00:20:00Z`, game_key: `${week}_BUF_KC`, roof: null, home_away: 'away' },
]);
const live = [1, 2, 3].map((week) => ({
  week, tank01_game_id: `${week}_BUF@KC`, home_team: 'KC', away_team: 'BUF', game_status: 'final', current_score_home: 20, current_score_away: 17,
}));

const candidate = (id, points, extra = {}) => ({
  id, points, name: `Cand ${id}`, position: 'WR', nfl_team: 'NYJ', photo_url: null, has_recent_stats: true, ...extra,
});

// The no-board world: Pool projections, the candidate read, Ownership under the
// cutoff for everyone, and a Weekly run whose verdicts come from `verdicts`
// (id -> verdict; any other id is Recommendable).
function install(t, candidates, verdicts) {
  t.mock.method(waiverBoards, 'getBoard', () => null);
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map(
    candidates.map((c) => [c.id, { points: c.points, source: 'extrapolated' }])
  ));
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ league }) => {
    // #2144: the public reader has no league by design and says so.
    assert.equal(league, projectionService.PUBLIC);
    return {
      startVerdictFor: (id) => verdicts[id] || { outcome: 'recommendable', reason: null, numberTrusted: true },
    };
  });
  const handlers = [
    ['EXTRACT(MONTH FROM CURRENT_DATE)', { rows: [{ season: 2026 }] }],
    ['FROM "nfl_games"', { rows: games }],
    ['FROM "live_game_states"', { rows: live }],
    ['FROM "private"."game_recaps"', { rows: [] }],
    ['MAX("captured_date")', { rows: [{ newest: '2026-09-29', age_days: 0 }] }],
    ['FROM "player_ownership"', (params) => ({
      rows: candidates.filter((c) => params[0].includes(c.id)).map((c) => ({ player_id: c.id, percent_owned: '10.00', captured_date: '2026-09-29' })),
    })],
    ['"identity_id"', { rows: [] }],
    ['"has_recent_stats"', (params) => ({ rows: candidates.filter((c) => params[0].includes(c.id)) })],
  ];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    for (const [needle, answer] of handlers) {
      if (text.includes(needle)) return typeof answer === 'function' ? answer(params) : answer;
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
}

const DOUBTFUL = { outcome: 'not_recommended', reason: 'doubtful', numberTrusted: true };

// Red-tell: drop the outcome check in computedTargets and the Doubtful player,
// whose number is trusted and who is available, is served.
test('computed Waiver Targets keep a Doubtful player out by the verdict outcome', async (t) => {
  install(t, [candidate(1, 20, { name: 'Doubtful Guy' }), candidate(2, 10, { name: 'Healthy Guy' })], { 1: DOUBTFUL });

  const result = await getWaiverTargets();

  assert.equal(result.source, 'computed');
  assert.deepEqual(result.targets.map((x) => x.name), ['Healthy Guy']);
});

test('computed Waiver Targets keep an Unavailable player out by the verdict outcome', async (t) => {
  install(t, [candidate(1, 20, { name: 'On Bye' }), candidate(2, 10, { name: 'Healthy Guy' })], {
    1: { outcome: 'unavailable', reason: 'bye', numberTrusted: true },
  });

  const result = await getWaiverTargets();

  assert.deepEqual(result.targets.map((x) => x.name), ['Healthy Guy']);
});

test('computed Waiver Targets pass the read no injury designation: the verdict alone decides', async (t) => {
  // An Out designation on the player row means nothing here; the read says Recommendable.
  install(t, [candidate(1, 20, { name: 'Stale Designation', injury_status: 'O' })], {});

  const result = await getWaiverTargets();

  assert.deepEqual(result.targets.map((x) => x.name), ['Stale Designation']);
});
