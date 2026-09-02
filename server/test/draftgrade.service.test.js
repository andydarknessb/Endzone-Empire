const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const {
  getOrComputeDraftGrades,
  gradeDraftValues,
  summarizePicks,
  DRAFT_GRADE_ALGORITHM_VERSION,
} = require('../services/draftgrade.service');

// Regression seam for "Draft Grades show no Roster Value and nothing explains
// the grade". Production (league 137, 2026 week 1, cached 2026-08-31) held a
// draft_grades row with rosterValue 0 for all twelve Teams: the pool-wide
// projection producer averages the CURRENT season's played weeks, there were
// none at week 1, so every optimal lineup summed to 0 and that zero was
// cached until the next algorithm bump. Meanwhile the grade itself is ranked
// on the summed market delta (ADP minus pick), which the payload never
// surfaced per Team beyond a raw total.

const league = (overrides = {}) => ({
  id: 137,
  current_season: 2026,
  current_week: 1,
  draft_status: 'complete',
  roster_slots: null,
  ...overrides,
});

const pick = (team_id, pick_number, adp, extra = {}) => ({
  team_id,
  player_id: 1000 + pick_number,
  pick_number,
  position: 'RB',
  adp,
  team_name: `Team ${team_id}`,
  player_name: `Player ${pick_number}`,
  ...extra,
});

// Three Teams, three picks each. Per-pick delta = ADP - pick (negative is a
// steal, positive a reach):
//   245: +9 (pick 3, ADP 12), -1 (pick 4, ADP 3), -7 (pick 9, ADP 2)  total  +1
//   243:  0 (pick 1, ADP 1), -4.5 (pick 6, ADP 1.5), +13 (pick 7, ADP 20) total +8.5
//   244: +28 (pick 2, ADP 30), 0 (pick 5), 0 (pick 8)                 total +28
// Negated z-scores land at A / B / F, best-first order 245, 243, 244.
const picks = [
  pick(243, 1, 1),
  pick(244, 2, 30),
  pick(245, 3, 12),
  pick(245, 4, 3),
  pick(244, 5, 5),
  pick(243, 6, 1.5),
  pick(243, 7, 20),
  pick(244, 8, 8),
  pick(245, 9, 2),
];

const basePool = (overrides = []) =>
  createFakePool([
    ...overrides,
    [select('leagues'), () => ({ rows: [league()] })],
    [select('league_analytics'), () => ({ rows: [] })],
    [select('draft_picks'), () => ({ rows: picks })],
    [select('player_projections'), () => ({ rows: [] })],
    [select('player_stats'), () => ({ rows: [] })],
    [insert('league_analytics'), () => ({ rows: [] })],
  ]);

test('no projections for the season: roster value is null, grades still come from ADP, the row is persisted but flagged', async (t) => {
  let stored = null;
  const fake = basePool([
    [insert('league_analytics'), (_text, params) => {
      stored = JSON.parse(params[2]);
      return { rows: [] };
    }],
  ]).install(t);

  const data = await getOrComputeDraftGrades({ leagueId: 137 });

  assert.equal(data.rosterValueAvailable, false);
  assert.deepEqual(data.grades.map((g) => [g.teamId, g.rank, g.grade]), [
    [245, 1, 'A'],
    [243, 2, 'B'],
    [244, 3, 'F'],
  ]);
  // The symptom: a 0 that looks like data. Null is what the UI's
  // "Not available" path expects.
  assert.ok(data.grades.every((g) => g.rosterValue === null), JSON.stringify(data.grades));
  // Higher is better for the number the card shows beside the grade.
  assert.deepEqual(data.grades.map((g) => g.adpNet), [-1, -8.5, -28]);
  // Persisted (season-end trophies and League History read the row
  // directly) but flagged, so the next request recomputes instead of serving
  // null roster values all season once projections exist.
  assert.equal(fake.matching(insert('league_analytics')).length, 1);
  assert.equal(stored.rosterValueAvailable, false);
  assert.ok(stored.grades.every((g) => g.rosterValue === null));
});

test('a cached row flagged rosterValueAvailable false is a cache miss, even at the current version', async (t) => {
  const fake = basePool([
    [select('league_analytics'), () => ({
      rows: [{ data: { algorithmVersion: DRAFT_GRADE_ALGORITHM_VERSION, rosterValueAvailable: false, grades: [] } }],
    })],
    [insert('league_analytics'), () => ({ rows: [] })],
  ]).install(t);

  const data = await getOrComputeDraftGrades({ leagueId: 137 });

  assert.equal(fake.matching(select('draft_picks')).length, 1, 'recomputed rather than served');
  assert.equal(data.grades.length, 3);
});

test('partial projections: a Team none of whose picks is projected reads null, the others numeric, and the row persists as available', async (t) => {
  let stored = null;
  basePool([
    [select('leagues'), () => ({ rows: [league({ current_week: 5 })] })],
    // Only Team 243's players carry a projection.
    [select('player_projections'), () => ({
      rows: picks
        .filter((p) => p.team_id === 243)
        .map((p) => ({ player_id: p.player_id, projected_points: 12, source: 'extrapolated' })),
    })],
    [insert('league_analytics'), (_text, params) => {
      stored = JSON.parse(params[2]);
      return { rows: [] };
    }],
  ]).install(t);

  const data = await getOrComputeDraftGrades({ leagueId: 137 });
  const byTeam = new Map(data.grades.map((g) => [g.teamId, g]));

  assert.equal(data.rosterValueAvailable, true);
  assert.ok(byTeam.get(243).rosterValue > 0);
  assert.equal(byTeam.get(244).rosterValue, null, 'no 0 for an unprojected Team');
  assert.equal(byTeam.get(245).rosterValue, null);
  assert.equal(stored.rosterValueAvailable, true);
});

test('each Team carries its best steal and worst reach so the grade is explainable', async (t) => {
  basePool().install(t);
  const data = await getOrComputeDraftGrades({ leagueId: 137 });
  const byTeam = new Map(data.grades.map((g) => [g.teamId, g]));

  const best = byTeam.get(245);
  assert.deepEqual(best.steal, {
    playerId: 1009, name: 'Player 9', position: 'RB', pickNumber: 9, marketAdp: 2, draftValueScore: -7,
  });
  assert.deepEqual(best.reach, {
    playerId: 1003, name: 'Player 3', position: 'RB', pickNumber: 3, marketAdp: 12, draftValueScore: 9,
  });
  // A Team with no pick below ADP has no steal to show.
  assert.equal(byTeam.get(244).steal, null);
  assert.equal(byTeam.get(244).reach.pickNumber, 2);
  assert.equal(best.pricedPicks, 3);
  // Picks stay in the payload with the player name attached.
  assert.equal(byTeam.get(243).picks[0].name, 'Player 1');
});

test('with projections present: roster value is numeric and the payload is cached under the current version', async (t) => {
  let stored = null;
  const fake = basePool([
    // A stale v2 row (the shape production cached with zeros) must be ignored.
    [select('league_analytics'), () => ({
      rows: [{ data: { algorithmVersion: 2, grades: [{ teamId: 245, rosterValue: 0 }] } }],
    })],
    [select('player_projections'), () => ({
      rows: picks.map((p) => ({ player_id: p.player_id, projected_points: 10 + p.pick_number, source: 'extrapolated' })),
    })],
    [insert('league_analytics'), (_text, params) => {
      stored = JSON.parse(params[2]);
      return { rows: [] };
    }],
  ]).install(t);

  const data = await getOrComputeDraftGrades({ leagueId: 137 });

  assert.equal(DRAFT_GRADE_ALGORITHM_VERSION, 3, 'bump busts the zero-roster-value rows cached under v2');
  assert.equal(data.algorithmVersion, 3);
  assert.equal(data.rosterValueAvailable, true);
  assert.ok(data.grades.every((g) => Number.isFinite(g.rosterValue) && g.rosterValue > 0));
  assert.equal(fake.matching(select('draft_picks')).length, 1, 'v2 cache is not served');
  assert.equal(stored.algorithmVersion, 3);
  assert.equal(stored.grades.length, 3);
});

test('summarizePicks: neutral ADP-fallback picks are never a steal or a reach', () => {
  const summary = summarizePicks([
    { playerId: 1, name: 'A', position: 'QB', pickNumber: 1, marketAdp: 1, draftValueScore: 0, adpFallback: true },
    { playerId: 2, name: 'B', position: 'RB', pickNumber: 2, marketAdp: 2, draftValueScore: 0, adpFallback: true },
  ]);
  assert.deepEqual(summary, { steal: null, reach: null, pricedPicks: 0 });
});

test('gradeDraftValues: adpNet is the negated graded score, never -0, even when picks are absent', () => {
  const graded = gradeDraftValues([
    { teamId: 1, name: 'A', rosterValue: null, draftValueScore: -5 },
    { teamId: 2, name: 'B', rosterValue: null, draftValueScore: 0 },
  ]);
  const byTeam = new Map(graded.map((g) => [g.teamId, g]));
  assert.equal(byTeam.get(1).adpNet, 5);
  assert.ok(Object.is(byTeam.get(2).adpNet, 0));
  assert.equal(byTeam.get(1).rosterValue, null);
  assert.deepEqual([byTeam.get(1).steal, byTeam.get(1).reach], [null, null]);
});
