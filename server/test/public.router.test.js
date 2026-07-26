const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const request = require('supertest');
const pool = require('../modules/pool');

function makeApp() {
  // Require the router fresh per app so each test gets its own rate-limiter
  // store (the limiter's Map is module-instance state).
  delete require.cache[require.resolve('../routes/public.router')];
  const publicRouter = require('../routes/public.router');
  const app = express();
  app.use(express.json());
  // Give req.ip a stable value without needing a real socket.
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'ip', { value: '203.0.113.7', configurable: true });
    next();
  });
  app.use('/api/public', publicRouter);
  return app;
}

// Route pool.query by a distinctive SQL substring so one mock can serve a whole
// endpoint's fan-out of reads.
function installPool(t, handlers) {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    for (const [needle, fn] of handlers) {
      if (text.includes(needle)) return typeof fn === 'function' ? fn(params) : fn;
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
}

// Recursively assert no league/user-scoped keys leak into a response body.
function assertNoLeakyKeys(value, path = '$') {
  const banned = ['user_id', 'userId', 'league_id', 'leagueId'];
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoLeakyKeys(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assert.ok(!banned.includes(key), `leaked key ${key} at ${path}`);
      assertNoLeakyKeys(value[key], `${path}.${key}`);
    }
  }
}

const RANKINGS_HANDLERS = [
  ['FROM "player_projections"', { rows: [
    { player_id: 1, projected_points: '22.4', source: 'extrapolated' },
    { player_id: 2, projected_points: '18.1', source: 'extrapolated' },
  ] }],
  ['MAX("season")::int', { rows: [{ season: 2026 }] }],
  ['MAX("week")::int', { rows: [{ week: 3 }] }],
  // Bye lookup: the calendar-season resolver, then computeByeWeeks' normalized
  // schedule join (KC's only 2026 gap is week 10, BUF's is week 7).
  ['EXTRACT(MONTH FROM CURRENT_DATE)', { rows: [{ season: 2026 }] }],
  ['fn_normalize_nfl_team', () => {
    const rows = [];
    for (let week = 1; week <= 18; week++) {
      if (week !== 10) rows.push({ nfl_team: 'KC', week });
      if (week !== 7) rows.push({ nfl_team: 'BUF', week });
    }
    return { rows };
  }],
  ['FROM "players" "p"', { rows: [
    { id: 1, name: 'Alpha Back', position: 'RB', nfl_team: 'KC', photo_url: 'http://x/1.png', injury_status: null, season_points: '120.5' },
    { id: 2, name: 'Bravo Wide', position: 'WR', nfl_team: 'BUF', photo_url: null, injury_status: 'Q', season_points: '90.0' },
  ] }],
  ['"week" <= $3', { rows: [
    { player_id: 1, week: 1, fantasy_points: '10' },
    { player_id: 1, week: 2, fantasy_points: '15' },
    { player_id: 1, week: 3, fantasy_points: '20' },
    { player_id: 2, week: 1, fantasy_points: '12' },
    { player_id: 2, week: 2, fantasy_points: '8' },
  ] }],
];

test('GET /rankings returns ranked rows with Cache-Control and no leaky keys', async (t) => {
  installPool(t, RANKINGS_HANDLERS);
  const res = await request(makeApp()).get('/api/public/rankings');

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=300');
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.week, 3);
  assert.equal(res.body.rankings.length, 2);

  const top = res.body.rankings[0];
  assert.equal(top.rank, 1);
  assert.equal(top.playerId, 1);
  assert.equal(top.projectedPoints, 22.4);
  assert.equal(top.lastWeekPoints, 15); // week 2 (targetWeek - 1)
  assert.equal(top.trend, 'up'); // 15 -> 20
  assert.equal(top.byeWeek, 10); // KC's sole 2026 schedule gap
  assert.equal(res.body.rankings[1].trend, 'down'); // 12 -> 8
  assert.equal(res.body.rankings[1].byeWeek, 7);
  assertNoLeakyKeys(res.body);
});

test('GET /rankings rejects a bad position with 400', async (t) => {
  installPool(t, RANKINGS_HANDLERS);
  const res = await request(makeApp()).get('/api/public/rankings?position=OL');
  assert.equal(res.status, 400);
});

test('GET /rankings rejects a non-integer week with 400', async (t) => {
  installPool(t, RANKINGS_HANDLERS);
  const res = await request(makeApp()).get('/api/public/rankings?week=abc');
  assert.equal(res.status, 400);
});

const PLAYER_ROW = {
  id: 1, name: 'Alpha Back', position: 'RB', nfl_team: 'KC', photo_url: 'http://x/1.png',
  jersey_number: '25', injury_status: null, injury_detail: null, news: null, adp: '12.5',
  // decoy fields that must NOT survive the serializer:
  user_id: 9, league_id: 4,
};

function profileHandlers(overrides = {}) {
  return [
    // Must precede the rollup needle: the rank window query also reads
    // player_season_stats.
    ['RANK() OVER', overrides.posRank || { rows: [{ rank: 3, group_size: 60 }] }],
    ['UNION SELECT DISTINCT "season"', overrides.seasons || { rows: [{ season: 2025 }] }],
    ['EXTRACT(MONTH FROM CURRENT_DATE)', overrides.upcoming || { rows: [{ season: 2026 }] }],
    ['FROM "player_season_stats"', overrides.rollup || { rows: [{
      games_played: 17,
      // a pass-catcher line so PPR > half > standard is observable
      stats: { rushingYards: 200, rushingTDs: 3, receptions: 40, receivingYards: 500, receivingTDs: 2 },
    }] }],
    ['COUNT(*)::int AS "n"', overrides.count || { rows: [{ n: 2 }] }],
    ['LEFT JOIN "nfl_games"', overrides.recent || { rows: [
      { season: 2025, week: 3, fantasy_points: '20', stats: { rushingYards: 100, rushingTDs: 1 }, opponent: 'DEN' },
    ] }],
    ['FROM "players" WHERE "id" = $1', overrides.player || { rows: [PLAYER_ROW] }],
  ];
}

test('GET /players/:id returns a whitelisted profile with per-format points and no leaky keys', async (t) => {
  installPool(t, profileHandlers());

  const res = await request(makeApp()).get('/api/public/players/1');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
  assert.equal(res.body.playerId, 1);
  assert.equal(res.body.adp, 12.5);
  assert.equal(res.body.posRank, 3);
  assert.equal(res.body.posRankOf, 60);
  assert.equal(res.body.season, 2025);

  // Season summary sourced from the complete rollup (17 games), carried in all
  // three formats; PPR > half-PPR > standard because the line has receptions.
  assert.equal(res.body.seasonSummary.gamesPlayed, 17);
  const p = res.body.seasonSummary.points;
  assert.ok(p.ppr > p.halfPpr && p.halfPpr > p.standard, `expected ppr>half>standard, got ${JSON.stringify(p)}`);
  assert.equal(res.body.seasonSummary.fantasyPoints, p.halfPpr); // back-compat default

  // Weekly rows are sparser than games played -> partial-log affordance on.
  assert.equal(res.body.weeklyLogPartial, true);

  // Season dimension exposes the pending upcoming season.
  assert.deepEqual(res.body.seasons, [
    { season: 2026, status: 'pending' },
    { season: 2025, status: 'complete' },
  ]);

  // Per-game points: a rush-only line is identical across formats.
  const g = res.body.recentGames[0];
  assert.equal(g.opponent, 'DEN');
  assert.equal(g.statLine, '100 rush yds, 1 rush TD');
  assert.equal(g.points.standard, g.points.ppr);
  assert.equal(g.fantasyPoints, g.points.halfPpr);

  assertNoLeakyKeys(res.body);
});

test('GET /players/:id returns the FULL season game log, not a capped recent slice', async (t) => {
  const fullSeason = Array.from({ length: 18 }, (_, i) => ({
    season: 2025, week: 18 - i, fantasy_points: '10',
    stats: { rushingYards: 100 }, opponent: 'DEN',
  }));
  installPool(t, profileHandlers({
    recent: { rows: fullSeason },
    count: { rows: [{ n: 18 }] },
  }));

  const res = await request(makeApp()).get('/api/public/players/1');
  assert.equal(res.status, 200);
  assert.equal(res.body.recentGames.length, 18); // every week serialized — no LIMIT
  assert.deepEqual(res.body.recentGames.map((g) => g.week).slice(0, 3), [18, 17, 16]);
});

test('GET /players/:id?season= renders the pending upcoming season, not an error', async (t) => {
  installPool(t, profileHandlers());

  const res = await request(makeApp()).get('/api/public/players/1?season=2026');
  assert.equal(res.status, 200);
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.seasonSummary, null);
  assert.deepEqual(res.body.recentGames, []);
  assert.equal(res.body.weeklyLogPartial, false);
  assert.equal(res.body.seasons.find((s) => s.season === 2026).status, 'pending');
  assertNoLeakyKeys(res.body);
});

test('GET /players/:id?season= for a season the player lacks echoes it as not-available, no silent fallback', async (t) => {
  // Player has only 2025 data; upcoming is 2026. 2024 is a real past season the
  // player has no rows for (e.g. a rookie). It must be honored, not swapped.
  installPool(t, profileHandlers());

  const res = await request(makeApp()).get('/api/public/players/1?season=2024');
  assert.equal(res.status, 200);
  assert.equal(res.body.season, 2024); // echoed back — NOT silently swapped to 2025
  assert.equal(res.body.seasonSummary, null);
  assert.deepEqual(res.body.recentGames, []);
  assert.equal(res.body.weeklyLogPartial, false);
  // Represented in seasons[] as not-available; the season the player DOES have stays complete.
  assert.equal(res.body.seasons.find((s) => s.season === 2024).status, 'unavailable');
  assert.equal(res.body.seasons.find((s) => s.season === 2025).status, 'complete');
  assert.equal(res.body.seasons.find((s) => s.season === 2026).status, 'pending');
  assertNoLeakyKeys(res.body);
});

test('GET /players/:id clears the partial-log flag once weekly rows match games played', async (t) => {
  installPool(t, profileHandlers({ count: { rows: [{ n: 17 }] } }));

  const res = await request(makeApp()).get('/api/public/players/1');
  assert.equal(res.status, 200);
  assert.equal(res.body.weeklyLogPartial, false);
});

const DEF_PLAYER_ROW = {
  id: 6721, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
  photo_url: null, jersey_number: null, injury_status: null, injury_detail: null,
  news: null, adp: null,
};

test('GET /players/:id prices a team defense from weekly rows, never the rollup', async (t) => {
  // Two 22-point weeks (2 sacks + shutout + sub-100 yards each). Scoring the
  // season AGGREGATE of the same stats would tier-match once and yield 21.
  const weeks = [
    { season: 2025, week: 2, fantasy_points: '22', stats: { sack: 2, pointsAllowed: 0, yardsAllowed: 95 }, opponent: 'LV' },
    { season: 2025, week: 1, fantasy_points: '22', stats: { sack: 2, pointsAllowed: 0, yardsAllowed: 90 }, opponent: 'NYG' },
  ];
  installPool(t, [
    // The rank query reads player_season_stats too, but only its stored
    // (weekly-summed) fantasy_points — never pricing the aggregate.
    ['RANK() OVER', { rows: [{ rank: 5, group_size: 32 }] }],
    ['UNION SELECT DISTINCT "season"', { rows: [{ season: 2025 }] }],
    ['EXTRACT(MONTH FROM CURRENT_DATE)', { rows: [{ season: 2026 }] }],
    // Present but must be ignored for DEF — an aggregate we could never price.
    ['FROM "player_season_stats"', () => {
      throw new Error('DEF profile must not read the season rollup');
    }],
    ['FROM "player_stats" "agg"', { rows: weeks.map((w) => ({ stats: w.stats })) }],
    ['COUNT(*)::int AS "n"', { rows: [{ n: 2 }] }],
    ['LEFT JOIN "nfl_games"', { rows: weeks }],
    ['FROM "players" WHERE "id" = $1', { rows: [DEF_PLAYER_ROW] }],
  ]);

  const res = await request(makeApp()).get('/api/public/players/6721');
  assert.equal(res.status, 200);
  assert.equal(res.body.seasonSummary.gamesPlayed, 2);
  assert.equal(res.body.seasonSummary.fantasyPoints, 44);
  // All three formats agree — the presets differ only in points per reception.
  const p = res.body.seasonSummary.points;
  assert.equal(p.standard, 44);
  assert.equal(p.ppr, 44);
  assert.equal(res.body.weeklyLogPartial, false);
  assert.equal(res.body.recentGames[0].statLine, '2 Sk, 0 PA, 95 YdA');
  assert.equal(res.body.recentGames[0].opponent, 'LV');
  assert.equal(res.body.adp, null);
  assert.equal(res.body.posRank, 5);
  assert.equal(res.body.posRankOf, 32);
  assertNoLeakyKeys(res.body);
});

test('GET /players/:id passes the DEF unit\'s raw team through to the normalizing join', async (t) => {
  // nfl_games keys teams by abbreviation; a DEF row's nfl_team is a full name.
  // The SQL normalizes both sides, so the bind stays the raw players value.
  let recentParams = null;
  installPool(t, [
    // No rollup row for this season -> the profile simply carries a null rank.
    ['RANK() OVER', { rows: [] }],
    ['UNION SELECT DISTINCT "season"', { rows: [{ season: 2025 }] }],
    ['EXTRACT(MONTH FROM CURRENT_DATE)', { rows: [{ season: 2026 }] }],
    ['FROM "player_stats" "agg"', { rows: [{ stats: { sack: 1, pointsAllowed: 20, yardsAllowed: 300 } }] }],
    ['COUNT(*)::int AS "n"', { rows: [{ n: 1 }] }],
    ['LEFT JOIN "nfl_games"', (params) => {
      recentParams = params;
      return { rows: [] };
    }],
    ['FROM "players" WHERE "id" = $1', { rows: [DEF_PLAYER_ROW] }],
  ]);

  const res = await request(makeApp()).get('/api/public/players/6721');
  assert.equal(res.status, 200);
  assert.deepEqual(recentParams, [6721, 'Denver Broncos', 2025]);
});

test('GET /players/:id keeps the rollup path for an IDP player (linear rules)', async (t) => {
  installPool(t, profileHandlers({
    player: { rows: [{ ...PLAYER_ROW, id: 900, name: 'Zaire Franklin', position: 'LB', nfl_team: 'IND' }] },
    rollup: { rows: [{ games_played: 17, stats: { soloTackle: 120, assistedTackle: 40, idpSack: 2 } }] },
    recent: { rows: [
      { season: 2025, week: 3, fantasy_points: '11', stats: { soloTackle: 6, assistedTackle: 3, idpSack: 1 }, opponent: 'HOU' },
    ] },
  }));

  const res = await request(makeApp()).get('/api/public/players/900');
  assert.equal(res.status, 200);
  // 120 solo + 40*0.5 assists + 2 sacks*2 = 144, identical in all three formats.
  assert.equal(res.body.seasonSummary.gamesPlayed, 17);
  assert.equal(res.body.seasonSummary.fantasyPoints, 144);
  assert.equal(res.body.seasonSummary.points.standard, 144);
  assert.equal(res.body.recentGames[0].statLine, '6 Solo, 3 Ast, 1 Sk');
  // IDP players rank off the same rollup table (no ADP required).
  assert.equal(res.body.posRank, 3);
});

test('GET /rankings accepts an IDP position so profile peer links resolve', async (t) => {
  installPool(t, RANKINGS_HANDLERS);
  for (const position of ['LB', 'CB', 'DE', 'S']) {
    const res = await request(makeApp()).get(`/api/public/rankings?position=${position}`);
    assert.equal(res.status, 200, `expected 200 for position=${position}`);
  }
});

test('GET /players/:id returns 404 when the player is missing', async (t) => {
  installPool(t, [['FROM "players" WHERE "id" = $1', { rows: [] }]]);
  const res = await request(makeApp()).get('/api/public/players/999');
  assert.equal(res.status, 404);
});

test('GET /players/:id rejects a non-numeric id with 400', async (t) => {
  installPool(t, []);
  const res = await request(makeApp()).get('/api/public/players/abc');
  assert.equal(res.status, 400);
});

test('GET /players/:id rejects zero with 400', async (t) => {
  installPool(t, []);
  const res = await request(makeApp()).get('/api/public/players/0');
  assert.equal(res.status, 400);
});

test('GET /players/:id rejects a zero season with 400', async (t) => {
  installPool(t, []);
  const res = await request(makeApp()).get('/api/public/players/1?season=0');
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// GET /draft-pool — bulk pool for the client-side Draft Simulator
// ---------------------------------------------------------------------------

const POOL_MAIN_ROWS = [
  {
    id: 1, name: 'Alpha Back', position: 'RB', nfl_team: 'KC', photo_url: 'http://x/1.png',
    injury_status: null, adp: '1.4', position_rank: 1,
    // decoys that must NOT survive the serializer:
    user_id: 9, league_id: 4,
  },
  {
    id: 2, name: 'Bravo Wide', position: 'WR', nfl_team: 'BUF', photo_url: null,
    injury_status: 'Q', adp: '8.2', position_rank: 2,
  },
];

const POOL_IDP_ROWS = [
  {
    id: 3, name: 'Charlie Backer', position: 'LB', nfl_team: 'KC', photo_url: null,
    injury_status: null, position_rank: 1,
  },
];

function draftPoolHandlers(overrides = {}) {
  return [
    // Both pool queries carry RANK() OVER, so route on the CTE names.
    ['"market_ranks" AS', overrides.main || { rows: POOL_MAIN_ROWS }],
    ['"idp_ranks" AS', overrides.idp || { rows: POOL_IDP_ROWS }],
    ['EXTRACT(MONTH FROM CURRENT_DATE)', overrides.upcoming || { rows: [{ season: 2026 }] }],
    ['FROM "player_season_stats" WHERE "player_id" = ANY', overrides.rollup || { rows: [
      // 17 games of 10 points => 10 pts/game => 170 projected.
      { player_id: 1, season: 2025, games_played: 17, stats: { rushingYards: 1700 }, fantasy_points: '170' },
      // Below MIN_PROJECTION_GAMES -> null projection, not a fake 0.
      { player_id: 2, season: 2025, games_played: 2, stats: { receivingYards: 100 }, fantasy_points: '10' },
    ] }],
    ['fn_normalize_nfl_team', overrides.bye || (() => {
      const rows = [];
      for (let week = 1; week <= 18; week++) {
        if (week !== 10) rows.push({ nfl_team: 'KC', week });
        if (week !== 7) rows.push({ nfl_team: 'BUF', week });
      }
      return { rows };
    })],
  ];
}

test('GET /draft-pool serves an ADP-ordered pool with a long Cache-Control and no leaky keys', async (t) => {
  installPool(t, draftPoolHandlers());

  const res = await request(makeApp()).get('/api/public/draft-pool');

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.includeIdp, false);
  assert.equal(res.body.players.length, 2); // IDP tranche not requested

  const top = res.body.players[0];
  assert.deepEqual(Object.keys(top).sort(), [
    'adp', 'byeWeek', 'injuryStatus', 'name', 'nflTeam', 'photoUrl',
    'playerId', 'position', 'positionRank', 'projectedPoints',
  ]);
  assert.equal(top.playerId, 1);
  assert.equal(top.adp, 1.4);
  assert.equal(top.positionRank, 1);
  assert.equal(top.projectedPoints, 170);
  assert.equal(top.byeWeek, 10); // KC's sole 2026 schedule gap
  // Too few games to project -> null, never 0.
  assert.equal(res.body.players[1].projectedPoints, null);
  assert.equal(res.body.players[1].byeWeek, 7);

  assertNoLeakyKeys(res.body);
});

test('GET /draft-pool?idp=1 appends individual defenders with a null ADP', async (t) => {
  installPool(t, draftPoolHandlers());

  const res = await request(makeApp()).get('/api/public/draft-pool?idp=1');

  assert.equal(res.status, 200);
  assert.equal(res.body.includeIdp, true);
  assert.equal(res.body.players.length, 3);

  const idp = res.body.players[2];
  assert.equal(idp.playerId, 3);
  assert.equal(idp.position, 'LB');
  // No free redraft IDP market exists — the client owns the effAdp fallback.
  assert.equal(idp.adp, null);
  assert.equal(idp.positionRank, 1);
  assertNoLeakyKeys(res.body);
});

test('GET /draft-pool rejects a non-boolean idp with 400', async (t) => {
  installPool(t, draftPoolHandlers());
  const res = await request(makeApp()).get('/api/public/draft-pool?idp=maybe');
  assert.equal(res.status, 400);
});

test('GET /draft-pool serves the second request from its TTL cache', async (t) => {
  let mainQueries = 0;
  installPool(t, draftPoolHandlers({
    main: () => {
      mainQueries += 1;
      return { rows: POOL_MAIN_ROWS };
    },
  }));

  const app = makeApp();
  const first = await request(app).get('/api/public/draft-pool');
  const second = await request(app).get('/api/public/draft-pool');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(mainQueries, 1);
  assert.deepEqual(second.body, first.body);
  // Cached responses still carry the caching header.
  assert.equal(second.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
});

test('GET /draft-pool caches the IDP variant separately from the base pool', async (t) => {
  let idpQueries = 0;
  installPool(t, draftPoolHandlers({
    idp: () => {
      idpQueries += 1;
      return { rows: POOL_IDP_ROWS };
    },
  }));

  const app = makeApp();
  await request(app).get('/api/public/draft-pool');
  assert.equal(idpQueries, 0); // base pool never runs the IDP query
  const withIdp = await request(app).get('/api/public/draft-pool?idp=1');
  assert.equal(withIdp.body.players.length, 3);
  assert.equal(idpQueries, 1);
});

test('GET /draft-pool degrades to null byes rather than 500ing when the schedule read fails', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installPool(t, draftPoolHandlers({
    bye: () => {
      throw new Error('schedule unavailable');
    },
  }));

  const res = await request(makeApp()).get('/api/public/draft-pool');
  assert.equal(res.status, 200);
  assert.equal(res.body.players[0].byeWeek, null);
  assert.equal(errors.length, 1);
});

test('GET /draft-pool surfaces a real query failure as 500', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installPool(t, draftPoolHandlers({
    main: () => {
      throw new Error('pool read exploded');
    },
  }));

  const res = await request(makeApp()).get('/api/public/draft-pool');
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to fetch the draft pool' });
});

test('GET /recaps lists recaps with version metadata and no leaky keys', async (t) => {
  installPool(t, [['FROM "private"."game_recaps"', { rows: [{
    tank01_game_id: '20260112_KC@BUF', season: 2026, week: 19, home_team: 'BUF', away_team: 'KC',
    home_score: 24, away_score: 27, final_at: '2026-01-12T23:00:00Z',
    generated_at: '2026-01-13T00:00:00Z', data_version: 1, generator_version: '1.0.0',
    data: {
      narrative: 'Kansas City edged Buffalo 27-24. A late field goal decided it.',
      user_id: 1,
      topPerformers: [{
        playerId: 9, name: 'Star Back', position: 'RB', nflTeam: 'KC',
        photoUrl: null, fantasyPoints: 28.4, statLine: '130 rush yds', leagueId: 2,
      }],
    },
  }] }]]);

  const res = await request(makeApp()).get('/api/public/recaps');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=300');
  assert.equal(res.body.recaps.length, 1);
  assert.equal(res.body.recaps[0].gameId, '20260112_KC@BUF');
  assert.equal(res.body.recaps[0].hook, 'Kansas City edged Buffalo 27-24.');
  assert.equal(res.body.recaps[0].generatedAt, '2026-01-13T00:00:00Z');
  assert.equal(res.body.recaps[0].dataVersion, 1);
  assert.equal(res.body.recaps[0].generatorVersion, '1.0.0');
  assert.equal(res.body.recaps[0].topPerformer.name, 'Star Back');
  assertNoLeakyKeys(res.body);
});

test('GET /recaps/:gameId returns the full recap or 404', async (t) => {
  installPool(t, [['FROM "private"."game_recaps" WHERE "tank01_game_id" = $1', (params) => (
    params[0] === '20260112_KC@BUF'
      ? { rows: [{
          tank01_game_id: '20260112_KC@BUF', season: 2026, week: 19, home_team: 'BUF', away_team: 'KC',
          home_score: 24, away_score: 27, final_at: '2026-01-12T23:00:00Z',
          generated_at: '2026-01-13T00:00:00Z', data_version: 1, generator_version: '1.0.0',
          data: {
            narrative: 'Kansas City edged Buffalo 27-24.',
            user_id: 10, userId: 11, league_id: 12, leagueId: 13,
            lineScore: { home: [7, 10, 0, 7], away: [3, 14, 3, 7], user_id: 14 },
            scoringPlays: [{
              quarter: 1, clock: '5:00', team: 'BUF', description: 'TD', homeScore: 7,
              awayScore: 0, leagueId: 15,
            }],
            topPerformers: [{
              playerId: 1, name: 'Alpha Back', position: 'RB', nflTeam: 'KC',
              fantasyPoints: 28.4, userId: 16,
            }],
          },
        }] }
      : { rows: [] }
  )]]);

  const app = makeApp();
  const ok = await request(app).get('/api/public/recaps/20260112_KC@BUF');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
  assert.equal(ok.body.scoringPlays.length, 1);
  assert.equal(ok.body.topPerformers[0].playerId, 1);
  assert.equal(ok.body.generatedAt, '2026-01-13T00:00:00Z');
  assert.equal(ok.body.dataVersion, 1);
  assert.equal(ok.body.generatorVersion, '1.0.0');
  assertNoLeakyKeys(ok.body);

  const missing = await request(app).get('/api/public/recaps/20260112_NE@NYJ');
  assert.equal(missing.status, 404);
});

test('GET /recaps/:gameId rejects a malformed game id with 400', async (t) => {
  installPool(t, []);
  const res = await request(makeApp()).get('/api/public/recaps/bad%20id!');
  assert.equal(res.status, 400);
});

// Only absent schema/table SQLSTATEs degrade to no data; permission errors are
// real server failures and must never masquerade as an empty public response.
function pgErrorThrower(code) {
  return () => {
    const err = new Error(`recap storage error ${code}`);
    err.code = code;
    throw err;
  };
}

test('GET /recaps returns 200 + empty list when game_recaps table is absent', async (t) => {
  installPool(t, [['FROM "private"."game_recaps"', pgErrorThrower('42P01')]]);
  const res = await request(makeApp()).get('/api/public/recaps');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { recaps: [] });
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=300');
});

test('GET /recaps/:gameId returns a clean 404 when game_recaps table is absent', async (t) => {
  installPool(t, [['FROM "private"."game_recaps" WHERE "tank01_game_id" = $1', pgErrorThrower('42P01')]]);
  const res = await request(makeApp()).get('/api/public/recaps/20260112_KC@BUF');
  assert.equal(res.status, 404);
});

test('GET /recaps returns 200 + empty list when the private schema is absent', async (t) => {
  installPool(t, [['FROM "private"."game_recaps"', pgErrorThrower('3F000')]]);
  const res = await request(makeApp()).get('/api/public/recaps');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { recaps: [] });
});

test('GET /recaps/:gameId returns 404 when the private schema is absent', async (t) => {
  installPool(t, [['FROM "private"."game_recaps" WHERE "tank01_game_id" = $1', pgErrorThrower('3F000')]]);
  const res = await request(makeApp()).get('/api/public/recaps/20260112_KC@BUF');
  assert.equal(res.status, 404);
});

test('recap list permission failures are logged and surfaced as 500', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installPool(t, [['FROM "private"."game_recaps"', pgErrorThrower('42501')]]);
  const res = await request(makeApp()).get('/api/public/recaps');
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to fetch recaps' });
  assert.equal(errors.length, 1);
});

test('recap detail permission failures are logged and surfaced as 500', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installPool(t, [['FROM "private"."game_recaps" WHERE "tank01_game_id" = $1', pgErrorThrower('42501')]]);
  const res = await request(makeApp()).get('/api/public/recaps/20260112_KC@BUF');
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to fetch recap' });
  assert.equal(errors.length, 1);
});

test('GET /sitemap.xml serves static, player, and recap public URLs', async (t) => {
  installPool(t, [
    ['SELECT "id" FROM "players"', { rows: [{ id: 1 }, { id: 42 }] }],
    ['FROM "private"."game_recaps"', { rows: [{
      tank01_game_id: '20260112_KC@BUF',
      final_at: '2026-01-12T23:00:00Z',
    }] }],
  ]);

  const res = await request(makeApp()).get('/api/public/sitemap.xml');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/xml/);
  assert.equal(res.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/rankings/);
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/draft-simulator/);
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/strategy\/draft-by-tiers/);
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/players\/42/);
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/recaps\/20260112_KC%40BUF/);
  assert.match(res.text, /<lastmod>2026-01-12T23:00:00\.000Z<\/lastmod>/);
});

test('GET /sitemap.xml stays valid before the game_recaps migration', async (t) => {
  installPool(t, [
    ['SELECT "id" FROM "players"', { rows: [{ id: 1 }] }],
    ['FROM "private"."game_recaps"', pgErrorThrower('42P01')],
  ]);

  const res = await request(makeApp()).get('/api/public/sitemap.xml');

  assert.equal(res.status, 200);
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/players\/1/);
  assert.doesNotMatch(res.text, /\/recaps\/2026/);
});

test('GET /sitemap.xml stays valid when the private schema is absent', async (t) => {
  installPool(t, [
    ['SELECT "id" FROM "players"', { rows: [{ id: 1 }] }],
    ['FROM "private"."game_recaps"', pgErrorThrower('3F000')],
  ]);

  const res = await request(makeApp()).get('/api/public/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.text, /https:\/\/endzoneempire\.gg\/players\/1/);
  assert.doesNotMatch(res.text, /\/recaps\/2026/);
});

test('sitemap permission failures are logged and surfaced as 500', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installPool(t, [
    ['SELECT "id" FROM "players"', { rows: [{ id: 1 }] }],
    ['FROM "private"."game_recaps"', pgErrorThrower('42501')],
  ]);

  const res = await request(makeApp()).get('/api/public/sitemap.xml');
  assert.equal(res.status, 500);
  assert.match(res.text, /failed to build sitemap/);
  assert.equal(errors.length, 1);
});

test('robots.txt is served with public-route allowances and the apex sitemap', async () => {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '..', '..', 'public')));

  const res = await request(app).get('/robots.txt');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/plain/);
  assert.match(res.text, /Allow: \/rankings/);
  assert.match(res.text, /Allow: \/players\//);
  assert.match(res.text, /Sitemap: https:\/\/endzoneempire\.gg\/sitemap\.xml/);
});

test('public limiter returns 429 after 120 requests in the window', async (t) => {
  installPool(t, RANKINGS_HANDLERS);
  const app = makeApp();
  // First 120 allowed, 121st blocked.
  for (let i = 0; i < 120; i++) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await request(app).get('/api/public/rankings');
    assert.equal(ok.status, 200);
  }
  const blocked = await request(app).get('/api/public/rankings');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['retry-after']);
});
