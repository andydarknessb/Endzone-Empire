const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, main, resolveWeek, firstOpenWeek, newestBy, rankFpa, rollUp, wsh } = require('./dump-week');

const d = (s) => new Date(s);

/** Fake client: first needle found in the SQL wins; rows are what pg would return. */
function fakeClient(routes) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push(sql);
      const hit = routes.find(([needle]) => sql.includes(needle));
      return { rows: !hit ? [] : typeof hit[1] === 'function' ? hit[1](params) : hit[1] };
    },
  };
}

test('wsh: every exact WSH value becomes WAS, nested, other text and dates untouched', () => {
  const at = d('2026-10-11T17:00:00Z');
  assert.deepEqual(wsh({ a: 'WSH', b: [{ c: 'WSH' }, 'WAS'], d: 'WSH vs DAL', e: at, f: null }),
    { a: 'WAS', b: [{ c: 'WAS' }, 'WAS'], d: 'WSH vs DAL', e: at, f: null });
});

test('newestBy: newest observation per key, whatever the row order', () => {
  const rows = [
    { k: 'g1', at: '2026-10-07T10:00:00Z', v: 'old' },
    { k: 'g1', at: '2026-10-08T10:00:00Z', v: 'new' },
    { k: 'g1', at: '2026-10-06T10:00:00Z', v: 'older' },
    { k: 'g2', at: '2026-10-01T10:00:00Z', v: 'only' },
  ];
  const m = newestBy(rows, 'k', 'at');
  assert.equal(m.get('g1').v, 'new');
  assert.equal(m.get('g2').v, 'only');
});

test('firstOpenWeek: the first week whose last kickoff is still ahead', () => {
  const bounds = [
    { week: 5, lastKickoffAt: d('2026-10-05T01:00:00Z') },
    { week: 6, lastKickoffAt: d('2026-10-12T01:00:00Z') },
    { week: 7, lastKickoffAt: d('2026-10-19T01:00:00Z') },
  ];
  assert.equal(firstOpenWeek(bounds, d('2026-10-08T00:00:00Z')), 6);
  assert.equal(firstOpenWeek(bounds, d('2026-10-20T00:00:00Z')), null);
});

test('resolveWeek: reads the stored schedule through getSeasonWeekBounds', async () => {
  const client = fakeClient([['FROM "nfl_games"', [
    { week: 5, kickoff_at: d('2026-10-04T17:00:00Z') }, { week: 5, kickoff_at: d('2026-10-05T00:20:00Z') },
    { week: 6, kickoff_at: d('2026-10-11T17:00:00Z') }, { week: 6, kickoff_at: d('2026-10-12T00:20:00Z') },
  ]]]);
  assert.equal(await resolveWeek(client, 2026, d('2026-10-08T00:00:00Z')), 6);
  assert.equal(await resolveWeek(client, 2026, d('2026-10-05T00:30:00Z')), 6);
  await assert.rejects(resolveWeek(client, 2026, d('2026-10-13T00:00:00Z')), /no week with a future last kickoff/);
});

test('resolveWeek: exactly at the last kickoff the week is over, the next one is the default', async () => {
  const client = fakeClient([['FROM "nfl_games"', [
    { week: 6, kickoff_at: d('2026-10-11T17:00:00Z') }, { week: 6, kickoff_at: d('2026-10-12T00:20:00Z') },
    { week: 7, kickoff_at: d('2026-10-18T17:00:00Z') }, { week: 7, kickoff_at: d('2026-10-19T00:20:00Z') },
  ]]]);
  assert.equal(await resolveWeek(client, 2026, d('2026-10-12T00:20:00Z')), 7);
  assert.equal(await resolveWeek(client, 2026, d('2026-10-12T00:19:59Z')), 6);
});

test('rankFpa: 1 = most points allowed, ties share the best rank', () => {
  const r = rankFpa([
    { position: 'QB', defense: 'DAL', points: 50, games: 5 },
    { position: 'QB', defense: 'WAS', points: 70, games: 4 },
    { position: 'QB', defense: 'NYG', points: 50, games: 5 },
    { position: 'QB', defense: 'BUF', points: 80, games: 5 }, // more in total than WAS, fewer per game
  ]);
  assert.deepEqual(r.QB.map((x) => [x.team, x.rank]), [['WAS', 1], ['BUF', 2], ['DAL', 3], ['NYG', 3]]);
  assert.deepEqual(r.QB[0], { team: 'WAS', points: 70, games: 4, perGame: 17.5, rank: 1 });
  assert.deepEqual(r.RB, []);
});

test('rollUp: sums round to 2 decimals, a player with no stat row stays with 0 games', () => {
  const [a, b] = rollUp([
    { id: 1, name: 'A', position: 'DEF', nfl_team: 'DAL', week: 1, fantasy_points: 0.1 },
    { id: 1, name: 'A', position: 'DEF', nfl_team: 'DAL', week: 2, fantasy_points: 0.2 },
    { id: 2, name: 'B', position: 'DEF', nfl_team: 'NYG', week: null, fantasy_points: null },
  ]);
  assert.deepEqual([a.points, a.games], [0.3, 2]);
  assert.deepEqual([b.points, b.games], [0, 0]);
});


const WR_STATS = { receptions: 8, receivingYards: 80, usageTargets: 11, usageTargetShare: 0.31, usageOffenseSnapPct: 0.92 };

function routes({ snapshot = true } = {}) {
  return [
    ['FROM "game_odds_snapshots"', [
      { game_key: '2026_06_DAL_WSH', spread: '-3.00', total: '44.00', observed_at: d('2026-10-07T12:00:00Z') },
      { game_key: '2026_06_DAL_WSH', spread: '-6.50', total: '47.50', observed_at: d('2026-10-08T12:00:00Z') },
      { game_key: '2026_06_DAL_WSH', spread: '-1.00', total: '40.00', observed_at: d('2026-10-06T12:00:00Z') },
    ]],
    ['FROM "game_weather_snapshots"', [
      { game_key: '2026_06_DAL_WSH', temperature_f: '70.00', wind_speed_mph: '5.00', wind_gust_mph: null, precipitation_probability: 10, short_forecast: 'Sunny', fetched_at: d('2026-10-06T00:00:00Z') },
      { game_key: '2026_06_DAL_WSH', temperature_f: '55.00', wind_speed_mph: '18.00', wind_gust_mph: '27.00', precipitation_probability: 60, short_forecast: 'Rain', fetched_at: d('2026-10-08T00:00:00Z') },
    ]],
    ['FROM "nfl_games" WHERE', [
      { nfl_team: 'WSH', opponent: 'DAL', home_away: 'home', kickoff_at: d('2026-10-11T17:00:00Z'), venue: 'FedEx', roof: 'outdoors', surface: 'grass', rest_days: 7, game_key: '2026_06_DAL_WSH' },
      { nfl_team: 'DAL', opponent: 'WSH', home_away: 'away', kickoff_at: d('2026-10-11T17:00:00Z'), venue: 'FedEx', roof: 'outdoors', surface: 'grass', rest_days: 7, game_key: '2026_06_DAL_WSH' },
    ]],
    ['FROM "projection_snapshots"', snapshot ? [{ id: 9, model_version: 'v', captured_at: d('2026-10-07T00:19:00Z'), capture_not_after: d('2026-10-11T00:00:00Z') }] : []],
    ['FROM "projection_snapshot_players"', [
      { player_id: 1, name: 'A QB', position: 'QB', nfl_team: 'WSH', mean: '18.50', median: '18.00', p10: '8.00', p90: '28.00', active_probability: '0.9500', confidence: 'high', sample_size: 0, injury_status: null, opponent: 'DAL', home_away: 'home', game_kickoff_at: d('2026-10-11T17:00:00Z') },
    ]],
    ['AS "stored"', [
      { position: 'QB', week: 4, stats: { passingYards: 750 }, stored: 'DAL', scheduled: 'DAL' }, // 30 pts, 1 game
      { position: 'QB', week: 4, stats: { passingYards: 250, passingTDs: 2 }, stored: 'WAS', scheduled: 'WAS' }, // 18
      { position: 'QB', week: 5, stats: { passingYards: 250, passingTDs: 2 }, stored: null, scheduled: 'WAS' }, // 18, from the schedule
      { position: 'RB', week: 5, stats: { rushingYards: 100 }, stored: null, scheduled: null },
    ]],
    // The same roll-up query serves DST and IDP; the position list tells them apart.
    ['LEFT JOIN "player_stats"', ([, , positions]) => (positions.includes('DEF') ? [
      { id: 7, name: 'Washington D/ST', position: 'DEF', nfl_team: 'WAS', week: 4, stats: { sack: 3 } },
      { id: 7, name: 'Washington D/ST', position: 'DEF', nfl_team: 'WAS', week: 5, stats: { sack: 1 } },
    ] : [
      { id: 8, name: 'A LB', position: 'LB', nfl_team: 'WSH', week: 4, stats: { sack: 1 } },
      { id: 9, name: 'Idle CB', position: 'CB', nfl_team: 'DAL', week: null, stats: null }, // no games: dropped
    ])],
    ['s."player_id", p."name"', [
      { player_id: 2, name: 'A WR', nfl_team: 'WSH', position: 'WR', week: 5, stats: WR_STATS },
      { player_id: 1, name: 'A QB', nfl_team: 'WSH', position: 'QB', week: 5, stats: { usageCarries: 4, usagePassAttempts: 35, passingYards: 250 } },
    ]],
    ['FROM "player_depth_chart"', [{ player_id: 1, name: 'A QB', team_code: 'WAS', position_group: 'QB', rank: 1, captured_date: '2026-10-07' }]],
    ['p."injury_detail"', [
      { id: 1, name: 'A QB', position: 'QB', nfl_team: 'WSH', injury_status: 'Questionable', injury_detail: 'Knee' },
      { id: 2, name: 'A WR', position: 'WR', nfl_team: 'WSH', injury_status: null, injury_detail: null }, // observed, no status
    ]],
    ['ORDER BY "player_id", "observed_at"', [
      { player_id: 1, practice_status: 'Limited', practice_primary_injury: 'Knee', report_status: null, report_primary_injury: null, observed_at: d('2026-10-07T20:00:00Z') },
      { player_id: 1, practice_status: 'Full', practice_primary_injury: 'Knee', report_status: 'Questionable', report_primary_injury: 'Knee', observed_at: d('2026-10-08T20:00:00Z') },
      { player_id: 2, practice_status: 'DNP', practice_primary_injury: 'Hamstring', report_status: null, report_primary_injury: null, observed_at: d('2026-10-07T20:00:00Z') },
    ]],
  ];
}

// writes anything? every statement any client sees must be a read
const WRITES = /\b(insert|update|delete|truncate|drop|alter|create|merge|copy|grant)\b/i;

test('build: nine sections, newest odds and weather per game_key, WSH spelled WAS, PPR pricing', async () => {
  const client = fakeClient(routes());
  const doc = await build(client, { season: 2026, week: 6, now: d('2026-10-08T15:00:00Z') });

  assert.deepEqual(Object.keys(doc).sort(),
    ['depthChart', 'dst', 'fpa', 'games', 'idp', 'injuries', 'meta', 'projections', 'usage']);
  assert.deepEqual(doc.meta, { season: 2026, week: 6, scoring: 'ppr', generatedAt: '2026-10-08T15:00:00.000Z', teamCodeNote: 'WAS in stats/depth chart, WSH in nfl_games/players/snapshot' });

  // newest odds (spread = home line) and newest weather, on both team rows
  assert.equal(doc.games.length, 2);
  for (const g of doc.games) {
    assert.equal(g.spread, -6.5);
    assert.equal(g.total, 47.5);
    assert.equal(g.short_forecast, 'Rain');
    assert.equal(g.wind_gust_mph, 27);
    assert.equal(g.game_key, '2026_06_DAL_WSH'); // opaque key keeps WSH
  }
  assert.deepEqual(doc.games.map((g) => g.nfl_team), ['WAS', 'DAL']);
  assert.equal(doc.projections.players[0].nfl_team, 'WAS');
  assert.equal(doc.projections.players[0].sample_size, 0);
  assert.equal(doc.projections.players[0].mean, 18.5);

  // 8 receptions / 80 yards is 16.0 under PPR, not the stored half-PPR 12.0
  const wr = doc.usage.find((u) => u.name === 'A WR');
  assert.equal(wr.fantasy_points, 16);
  assert.equal(wr.usageTargetShare, 0.31);
  assert.equal(doc.usage.find((u) => u.name === 'A QB').usageTargetShare, null);
  assert.equal(doc.usage[0].nfl_team, 'WAS');

  // every practice observation in order; a player with observations but no status is included
  assert.deepEqual(doc.injuries.map((p) => p.name), ['A QB', 'A WR']);
  assert.deepEqual(doc.injuries[0].practice.map((o) => o.practice_status), ['Limited', 'Full']);
  assert.equal(doc.injuries[0].practice[1].report_primary_injury, 'Knee');
  assert.equal(doc.injuries[1].practice[0].practice_status, 'DNP');

  assert.deepEqual([doc.dst[0].nfl_team, doc.dst[0].games], ['WAS', 2]);
  assert.deepEqual(doc.idp.map((p) => [p.name, p.nfl_team, p.games]), [['A LB', 'WAS', 1]]);

  // DAL allowed 30 in one game, WAS 36 in two: per-game puts DAL first
  assert.deepEqual(doc.fpa.QB.map((x) => [x.team, x.points, x.games, x.perGame, x.rank]), [['DAL', 30, 1, 30, 1], ['WAS', 36, 2, 18, 2]]);
  assert.deepEqual(doc.fpa.source, { gameOpponentRows: 2, scheduleRows: 1, unplacedRows: 1 });

  assert.equal(JSON.stringify(doc).includes('"WSH"'), false);
  for (const sql of client.seen) assert.doesNotMatch(sql, WRITES);
});

test('main: BEGIN READ ONLY first, ROLLBACK last, --season/--week win over the defaults', async () => {
  const client = fakeClient(routes());
  client.release = () => {};
  const pool = { connect: async () => client, end: async () => {} };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dump-week-')), 'dump.json');
  assert.equal(await main(['--season', '2031', '--week', '3', '--out', out], pool), 0);
  assert.equal(client.seen[0], 'BEGIN READ ONLY');
  assert.equal(client.seen[client.seen.length - 1], 'ROLLBACK');
  assert.ok(client.seen.length > 10);
  for (const sql of client.seen) assert.doesNotMatch(sql, WRITES);
  assert.ok(!client.seen.some((sql) => sql.includes('SELECT DISTINCT "week"'))); // no default-week lookup
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(doc.meta.season, 2031);
  assert.equal(doc.meta.week, 3);
});

test('main: no scheduled snapshot still writes the document, warns on stderr, exits 2', async (t) => {
  const warn = t.mock.method(console, 'error', () => {});
  const client = fakeClient(routes({ snapshot: false }));
  client.release = () => {};
  const pool = { connect: async () => client, end: async () => {} };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dump-week-')), 'dump.json');
  assert.equal(await main(['--season', '2026', '--week', '6', '--out', out], pool), 2);
  assert.match(warn.mock.calls[0].arguments[0], /no on-time scheduled PPR projection snapshot/);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(doc.projections, { snapshot: null, players: [] });
  assert.equal(client.seen[client.seen.length - 1], 'ROLLBACK');
});
