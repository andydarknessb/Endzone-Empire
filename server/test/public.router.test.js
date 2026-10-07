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

// ---- Best available (#142): membership rule + order, no id fallback -------

// (a) has an ADP, (b) no ADP but produced last season, (c) neither — modeled
// directly on the reported bug: Darren Waller and Dawson Knox are TEs with no
// ADP who scored 76.7 and 85.7 in 2025 and were missing from the pool.
const BEST_AVAILABLE_ROWS = [
  {
    id: 10, name: 'Early ADP TE', position: 'TE', nfl_team: 'KC', photo_url: null,
    injury_status: null, adp: '4.2', position_rank: 1, last_season_points: null,
  },
  {
    id: 1342, name: 'Dawson Knox', position: 'TE', nfl_team: 'BUF', photo_url: null,
    injury_status: null, adp: null, position_rank: null, last_season_points: '85.70',
  },
  {
    id: 1310, name: 'Darren Waller', position: 'TE', nfl_team: 'MIA', photo_url: null,
    injury_status: null, adp: null, position_rank: null, last_season_points: '76.70',
  },
  {
    id: 99, name: 'Practice Squad TE', position: 'TE', nfl_team: 'NYJ', photo_url: null,
    injury_status: null, adp: null, position_rank: null, last_season_points: null,
  },
];

test('GET /draft-pool: membership is ADP-or-last-season-production, ordered ADP then points then name, never id', async (t) => {
  installPool(t, draftPoolHandlers({ main: { rows: BEST_AVAILABLE_ROWS } }));

  const res = await request(makeApp()).get('/api/public/draft-pool');

  assert.equal(res.status, 200);
  // The (c)-shaped player (no ADP, no last-season points) never appears.
  assert.equal(res.body.players.some((p) => p.playerId === 99), false);
  // (a) before (b)/(b): ADP first, then the two no-ADP producers by points —
  // Knox (85.7) before Waller (76.7) — id (1342 > 1310) never decides it.
  assert.deepEqual(res.body.players.map((p) => p.playerId), [10, 1342, 1310]);
});

test('GET /draft-pool: Darren Waller and Dawson Knox surface at TE with no ADP', async (t) => {
  installPool(t, draftPoolHandlers({ main: { rows: BEST_AVAILABLE_ROWS } }));

  const res = await request(makeApp()).get('/api/public/draft-pool');

  const waller = res.body.players.find((p) => p.name === 'Darren Waller');
  const knox = res.body.players.find((p) => p.name === 'Dawson Knox');
  assert.ok(waller, 'Darren Waller is in the draft pool');
  assert.ok(knox, 'Dawson Knox is in the draft pool');
  assert.equal(waller.position, 'TE');
  assert.equal(knox.position, 'TE');
  assert.equal(waller.adp, null);
  assert.equal(knox.adp, null);
});

test('GET /draft-pool: membership is not capped at 260 — every eligible row survives', async (t) => {
  // 400 ADP rows + 300 no-ADP-but-productive rows, well past the old LIMIT 260.
  const rows = [];
  for (let i = 0; i < 400; i++) {
    rows.push({
      id: i, name: `Player ${i}`, position: 'WR', nfl_team: 'KC', photo_url: null,
      injury_status: null, adp: String(i + 1), position_rank: i + 1, last_season_points: null,
    });
  }
  for (let i = 400; i < 700; i++) {
    rows.push({
      id: i, name: `Player ${i}`, position: 'WR', nfl_team: 'KC', photo_url: null,
      injury_status: null, adp: null, position_rank: null, last_season_points: String(700 - i),
    });
  }
  installPool(t, draftPoolHandlers({ main: { rows } }));

  const res = await request(makeApp()).get('/api/public/draft-pool');

  assert.equal(res.status, 200);
  assert.equal(res.body.players.length, 700);
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
  // Every strategy slug, not just one. The list is duplicated from the client
  // content module (see #75 for deriving it), and asserting only the first entry
  // is how /strategy/preseason-week-1-recap shipped on 2026-08-18 and stayed out
  // of the sitemap unnoticed. A missing slug is now a red test, not an SEO hole.
  for (const slug of [
    'draft-by-tiers',
    'waiver-priority-vs-faab',
    'reading-trade-value',
    'streaming-defense-and-kicker',
    'playoff-prep',
    'preseason-week-1-recap',
    'preseason-week-2-recap',
    'preseason-week-3-recap',
    'rookie-draft-round-guide',
    'week2-waiver-wire-priority-board',
    'week3-waiver-wire-darkness-report',
    'week3-start-sit-darkness-report',
    'week4-waiver-wire-darkness-report',
    'week4-start-sit-darkness-report',
    'week5-waiver-wire-darkness-report',
  ]) {
    assert.ok(
      res.text.includes(`<loc>https://endzoneempire.gg/strategy/${slug}</loc>`),
      `sitemap is missing /strategy/${slug}`
    );
  }
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

// ---------------------------------------------------------------------------
// GET /waiver-targets: the week's editorial board, gated by Ownership (#1829)
// ---------------------------------------------------------------------------

const waiverBoards = require('../services/waiverBoards');

function scheduleRows(week, home, away, kickoffAt) {
  const key = `${week}_${away}_${home}`;
  return [
    { week, nfl_team: home, opponent: away, kickoff_at: kickoffAt, game_key: key, roof: null, home_away: 'home' },
    { week, nfl_team: away, opponent: home, kickoff_at: kickoffAt, game_key: key, roof: null, home_away: 'away' },
  ];
}

function liveRow(week, home, away, status) {
  return {
    week, tank01_game_id: `${week}_${away}@${home}`, home_team: home, away_team: away,
    game_status: status, current_score_home: 20, current_score_away: 17,
  };
}

// Weeks 1 and 2 are over. Week 3 has two games, and `week3LastStatus` decides
// whether the second (the late one) is final. Week 4 is scheduled with no live rows.
// `newestSnapshot` is the newest Ownership snapshot across the whole feed: its
// date and its age in days (the database computes the age from CURRENT_DATE).
function slateHandlers({
  week3LastStatus, ownership = [], players = [], identity = [],
  newestSnapshot = { newest: '2026-09-29', age_days: 0 },
}) {
  const games = [
    ...scheduleRows(1, 'KC', 'BUF', '2026-09-10T00:20:00Z'),
    ...scheduleRows(2, 'KC', 'BUF', '2026-09-17T00:20:00Z'),
    ...scheduleRows(3, 'KC', 'BUF', '2026-09-24T00:20:00Z'),
    ...scheduleRows(3, 'MIA', 'MIN', '2026-09-28T00:15:00Z'),
    ...scheduleRows(4, 'CHI', 'NYJ', '2026-10-04T17:00:00Z'),
    ...scheduleRows(4, 'MIN', 'MIA', '2026-10-04T17:00:00Z'),
    ...scheduleRows(4, 'ATL', 'NO', '2026-10-06T00:15:00Z'),
    ...scheduleRows(4, 'WAS', 'IND', '2026-10-04T13:30:00Z'),
    ...scheduleRows(4, 'DET', 'CAR', '2026-10-05T00:20:00Z'),
    ...scheduleRows(4, 'CIN', 'JAX', '2026-10-04T17:00:00Z'),
    ...scheduleRows(4, 'SEA', 'LAC', '2026-10-04T20:05:00Z'),
    ...scheduleRows(4, 'NYG', 'ARI', '2026-10-04T17:00:00Z'),
    ...scheduleRows(4, 'BAL', 'TEN', '2026-10-04T17:00:00Z'),
    ...scheduleRows(4, 'BUF', 'NE', '2026-10-04T17:00:00Z'),
  ];
  const live = [
    liveRow(1, 'KC', 'BUF', 'final'),
    liveRow(2, 'KC', 'BUF', 'final'),
    liveRow(3, 'KC', 'BUF', 'final'),
    liveRow(3, 'MIA', 'MIN', week3LastStatus),
  ];
  return [
    ['EXTRACT(MONTH FROM CURRENT_DATE)', { rows: [{ season: 2026 }] }],
    ['FROM "nfl_games"', { rows: games }],
    ['FROM "live_game_states"', { rows: live }],
    ['FROM "private"."game_recaps"', { rows: [] }],
    // The feed-wide freshness read has no player filter, so it matches first.
    ['MAX("captured_date")', { rows: [newestSnapshot] }],
    ['FROM "player_ownership"', (params) => ({
      rows: ownership.filter((row) => params[0].includes(row.player_id)),
    })],
    // The identity read also selects FROM "players", so it must match first.
    ['"identity_id"', { rows: identity }],
    ['FROM "players"', { rows: players }],
  ];
}

// A Week 4 board shaped like the column's: ten priced entries in order, on
// fixture ids. [name, position, team, bidMin, bidMax].
const WEEK4_FIXTURE_ROWS = [
  ['Braelon Allen', 'RB', 'NYJ', 12, 18], ['Ollie Gordon II', 'RB', 'MIA', 12, 15],
  ['Kenyon Sadiq', 'TE', 'NYJ', 8, 12], ['Alvin Kamara', 'RB', 'NO', 5, 8],
  ['Keenan Allen', 'WR', 'IND', 3, 6], ['Jaylen Wright', 'RB', 'MIA', 3, 7],
  ['Darren Waller', 'TE', 'CAR', 2, 4], ['Jakobi Meyers', 'WR', 'JAX', 2, 4],
  ['Sam Darnold', 'QB', 'SEA', 1, 3], ['Jacoby Brissett', 'QB', 'ARI', 1, 3],
];
const WEEK4_FIXTURE_BOARD = {
  season: 2026,
  week: 4,
  entries: WEEK4_FIXTURE_ROWS.map(([name, , , bidMin, bidMax], i) => ({
    playerId: 700 + i, name, bidMin, bidMax, reason: `Reason for ${name}.`,
  })),
};

function playerRowFor(entry, i) {
  const [, position, team] = WEEK4_FIXTURE_ROWS[i];
  return {
    id: entry.playerId, name: entry.name, position, nfl_team: team,
    photo_url: `http://x/${entry.playerId}.png`,
  };
}

function ownershipRow(playerId, percent, date = '2026-09-29') {
  return { player_id: playerId, percent_owned: percent, captured_date: date };
}

const FAKE_BOARD = {
  season: 2026,
  week: 4,
  entries: [
    { playerId: 501, name: 'Kenneth Walker III', bidMin: 12, bidMax: 18, reason: 'Column pick who is rostered almost everywhere.' },
    { playerId: 502, name: 'Braelon Allen', bidMin: 12, bidMax: 18, reason: 'Lead back this week.' },
    { playerId: 503, name: 'Half Owned', bidMin: 5, bidMax: 8, reason: 'Exactly at the cutoff.' },
    { playerId: 504, name: 'No Row', bidMin: 3, bidMax: 6, reason: 'Never captured.' },
    { playerId: 505, name: 'Kenyon Sadiq', bidMin: 8, bidMax: 12, reason: 'Tight end hole.' },
  ],
};

const FAKE_PLAYERS = [
  { id: 501, name: 'Kenneth Walker III', position: 'RB', nfl_team: 'SEA', photo_url: null },
  { id: 502, name: 'Braelon Allen', position: 'RB', nfl_team: 'NYJ', photo_url: 'http://x/502.png' },
  { id: 503, name: 'Half Owned', position: 'WR', nfl_team: 'IND', photo_url: null },
  { id: 504, name: 'No Row', position: 'WR', nfl_team: 'JAX', photo_url: null },
  { id: 505, name: 'Kenyon Sadiq', position: 'TE', nfl_team: 'NYJ', photo_url: null },
];

test('GET /waiver-targets returns the Week 4 board in board order with bid, reason, opponent and Ownership', async (t) => {
  const board = WEEK4_FIXTURE_BOARD;
  t.mock.method(waiverBoards, 'getBoard', () => board);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: board.entries.map(playerRowFor),
    ownership: board.entries.map((entry, i) => ownershipRow(entry.playerId, String(10 + i))),
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=300');
  assert.equal(res.body.week, 4);
  assert.equal(res.body.source, 'editorial');
  assert.equal(res.body.ownershipAsOf, '2026-09-29');
  const expected = board.entries.slice(0, 8);
  assert.deepEqual(res.body.targets.map((x) => x.playerId), expected.map((e) => e.playerId));
  const first = res.body.targets[0];
  assert.equal(first.name, 'Braelon Allen');
  assert.equal(first.position, 'RB');
  assert.equal(first.nflTeam, 'NYJ');
  assert.equal(first.opponent, 'CHI');
  assert.equal(first.ownership, 10);
  assert.equal(first.bidMin, expected[0].bidMin);
  assert.equal(first.bidMax, expected[0].bidMax);
  assert.equal(first.reason, expected[0].reason);
  assert.equal(first.photoUrl, `http://x/${expected[0].playerId}.png`);
  assertNoLeakyKeys(res.body);
});

test('GET /waiver-targets never returns a weekly starter: Kenneth Walker III at 99.8% is hidden', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    ownership: [ownershipRow(501, '99.80'), ownershipRow(502, '18.00'), ownershipRow(505, '17.50')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.targets.map((x) => x.name), ['Braelon Allen', 'Kenyon Sadiq']);
});

test('GET /waiver-targets drops a board entry at exactly 50% and one with no Ownership row', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    ownership: [ownershipRow(502, '49.99'), ownershipRow(503, '50.00'), ownershipRow(505, '17.50')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Braelon Allen', 'Kenyon Sadiq']);
});

test('GET /waiver-targets caps the list at 8 after the cutoff, keeping board order', async (t) => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    playerId: 600 + i, name: `Player ${i}`, bidMin: 1, bidMax: 2, reason: `Reason ${i}`,
  }));
  t.mock.method(waiverBoards, 'getBoard', () => ({ season: 2026, week: 4, entries }));
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: entries.map((e) => ({ id: e.playerId, name: e.name, position: 'WR', nfl_team: 'KC', photo_url: null })),
    // Player 0 is a starter, so the eight come from players 1..8.
    ownership: entries.map((e, i) => ownershipRow(e.playerId, i === 0 ? '90' : '5')),
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.playerId), [601, 602, 603, 604, 605, 606, 607, 608]);
});

test('GET /waiver-targets: the waiver week waits until every game of the previous Slate is final', async (t) => {
  // An empty board falls back to the computed list, which has nothing projected here.
  t.mock.method(require('../services/projection.service'), 'getWeekProjections', async () => new Map());
  t.mock.method(waiverBoards, 'getBoard', (season, week) => {
    assert.equal(season, 2026);
    return { season, week, entries: [] };
  });
  installPool(t, slateHandlers({ week3LastStatus: 'in_progress' }));
  const waiting = await request(makeApp()).get('/api/public/waiver-targets');
  assert.equal(waiting.status, 200);
  assert.equal(waiting.body.week, 3);

  t.mock.restoreAll();
  t.mock.method(require('../services/projection.service'), 'getWeekProjections', async () => new Map());
  t.mock.method(waiverBoards, 'getBoard', (season, week) => ({ season, week, entries: [] }));
  installPool(t, slateHandlers({ week3LastStatus: 'final' }));
  const done = await request(makeApp()).get('/api/public/waiver-targets');
  assert.equal(done.body.week, 4);
});

test('GET /waiver-targets finds a duplicate row\'s Ownership through the identity ids', async (t) => {
  // The board lists 502 (no Ownership row of its own); the ESPN-matched row of the
  // same athlete is 902 and carries the snapshot. 501 (a hidden starter) has an
  // identity row too, and stays hidden.
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    identity: [
      { requested_id: 502, identity_id: 502 }, { requested_id: 502, identity_id: 902 },
      { requested_id: 501, identity_id: 501 }, { requested_id: 501, identity_id: 901 },
    ],
    ownership: [ownershipRow(902, '21.40', '2026-09-28'), ownershipRow(901, '99.80')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Braelon Allen']);
  assert.equal(res.body.targets[0].playerId, 502);
  assert.equal(res.body.targets[0].ownership, 21.4);
  assert.equal(res.body.ownershipAsOf, '2026-09-28');
  assert.ok(!JSON.stringify(res.body).includes('99.8'));
});

test('GET /waiver-targets serves an athlete once when the board lists two of his rows', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => ({
    ...FAKE_BOARD,
    entries: [
      FAKE_BOARD.entries[1],
      { playerId: 902, name: 'Braelon Allen', bidMin: 1, bidMax: 2, reason: 'Duplicate listing.' },
    ],
  }));
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: [...FAKE_PLAYERS, { id: 902, name: 'Braelon Allen', position: 'RB', nfl_team: 'NYJ', photo_url: null }],
    identity: [
      { requested_id: 502, identity_id: 502 }, { requested_id: 502, identity_id: 902 },
      { requested_id: 902, identity_id: 502 }, { requested_id: 902, identity_id: 902 },
    ],
    ownership: [ownershipRow(902, '21.40')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.playerId), [502]);
});

test('GET /waiver-targets prefers the board id\'s own Ownership row over an identity row', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    identity: [{ requested_id: 502, identity_id: 502 }, { requested_id: 502, identity_id: 902 }],
    ownership: [ownershipRow(502, '18.00'), ownershipRow(902, '40.00')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.body.targets[0].ownership, 18);
});

test('deriveWaiverWeek: week 1 with no games, partial finals, a Tuesday game and the week 18 clamp', () => {
  const { deriveWaiverWeek } = require('../services/waiverTargets.service');
  assert.equal(deriveWaiverWeek([]), 1);
  assert.equal(deriveWaiverWeek(undefined), 1);
  // Week 1 partly final: still week 1.
  assert.equal(deriveWaiverWeek([
    { week: 1, status: 'final' }, { week: 1, status: 'in_progress' },
  ]), 1);
  // A Tuesday game that has not finished holds the week; once final it advances.
  const monday = [{ week: 1, status: 'final' }, { week: 2, status: 'final' }, { week: 2, status: 'final' }];
  assert.equal(deriveWaiverWeek([...monday, { week: 2, status: 'scheduled' }]), 2);
  assert.equal(deriveWaiverWeek([...monday, { week: 2, status: 'final' }]), 3);
  // Weeks 1 and 2 over, week 3 not started: waiver week is 3.
  assert.equal(deriveWaiverWeek([
    { week: 1, status: 'final' }, { week: 2, status: 'final' }, { week: 3, status: 'scheduled' },
  ]), 3);
  // After week 18 is over it stays 18; weeks outside 1..18 are ignored.
  assert.equal(deriveWaiverWeek([{ week: 18, status: 'final' }, { week: 19, status: 'final' }]), 18);
});

test('GET /waiver-targets returns an empty computed list when no board exists and nothing is projected', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => null);
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  installPool(t, slateHandlers({ week3LastStatus: 'in_progress' }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.equal(res.body.week, 3);
  assert.equal(res.body.source, 'computed');
  assert.deepEqual(res.body.targets, []);
  assert.equal(res.body.ownershipAsOf, null);
});

test('GET /waiver-targets exposes Ownership only for the returned targets', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    ownership: [
      ownershipRow(501, '99.80'), ownershipRow(502, '18.00'), ownershipRow(503, '50.00'),
      ownershipRow(505, '17.50'),
      // Not on the board at all: the query never asks for him, and he must not surface.
      ownershipRow(999, '57.30'),
    ],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  const body = JSON.stringify(res.body);
  assert.equal(res.body.targets.length, 2);
  assert.ok(!body.includes('99.8'), 'a hidden starter percentage never appears');
  assert.ok(!body.includes('57.3'), 'a non-board player percentage never appears');
  assert.ok(!body.includes('"ownership":50'), 'a dropped entry percentage never appears');
  assert.deepEqual(res.body.targets.map((x) => x.ownership), [18, 17.5]);
});

// ---------------------------------------------------------------------------
// GET /waiver-targets stale Ownership snapshot (#1831)
// ---------------------------------------------------------------------------

test('GET /waiver-targets with a 4-day-old snapshot returns the whole board without the cutoff and with Ownership null', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    newestSnapshot: { newest: '2026-09-25', age_days: 4 },
    ownership: [ownershipRow(501, '60.00', '2026-09-25'), ownershipRow(502, '18.00', '2026-09-25')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'editorial');
  assert.equal(res.body.ownershipAsOf, '2026-09-25');
  assert.deepEqual(res.body.targets.map((x) => x.playerId), [501, 502, 503, 504, 505]);
  assert.ok(res.body.targets.every((x) => x.ownership === null), 'every Ownership % is null');
  assert.ok(!/"ownership":\d/.test(JSON.stringify(res.body)), 'a stale percentage never appears');
  assert.equal(res.body.targets[0].bidMin, 12);
  assert.equal(res.body.targets[0].reason, FAKE_BOARD.entries[0].reason);
  assertNoLeakyKeys(res.body);
});

test('GET /waiver-targets with a 4-day-old snapshot and no board returns an empty list, not a computed one', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => null);
  const projected = t.mock.method(projectionService, 'getWeekProjections', async () => new Map([
    [1, { points: 20, source: 'extrapolated' }],
  ]));
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    newestSnapshot: { newest: '2026-09-25', age_days: 4 },
    ownership: [ownershipRow(1, '10.00', '2026-09-25')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.targets, []);
  assert.equal(res.body.ownershipAsOf, '2026-09-25');
  assert.equal(projected.mock.callCount(), 0, 'no computed fallback is attempted');
});

test('GET /waiver-targets on a stale feed reads no Ownership, keeps the cap of 8 and serves a duplicated athlete once', async (t) => {
  const board = WEEK4_FIXTURE_BOARD;
  const duplicate = { playerId: 902, name: board.entries[0].name, bidMin: 1, bidMax: 2, reason: 'Duplicate listing.' };
  t.mock.method(waiverBoards, 'getBoard', () => ({ ...board, entries: [board.entries[0], duplicate, ...board.entries.slice(1)] }));
  const ownershipReads = [];
  installPool(t, [
    ['DISTINCT ON ("player_id")', (params) => { ownershipReads.push(params); return { rows: [] }; }],
    ...slateHandlers({
      week3LastStatus: 'final',
      players: [...board.entries.map(playerRowFor), { ...playerRowFor(board.entries[0], 0), id: 902 }],
      identity: [
        { requested_id: 700, identity_id: 700 }, { requested_id: 700, identity_id: 902 },
        { requested_id: 902, identity_id: 700 }, { requested_id: 902, identity_id: 902 },
      ],
      newestSnapshot: { newest: '2026-09-25', age_days: 4 },
    }),
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(ownershipReads.length, 0, 'no percentage is read on a stale feed');
  assert.deepEqual(res.body.targets.map((x) => x.playerId), [700, 701, 702, 703, 704, 705, 706, 707]);
  assert.ok(res.body.targets.every((x) => x.ownership === null));
});

test('GET /waiver-targets with an empty Ownership feed is not stale: the cutoff still applies', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    newestSnapshot: { newest: null, age_days: null },
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.targets, []);
  assert.equal(res.body.ownershipAsOf, null);
});

test('GET /waiver-targets with a 3-day-old snapshot still applies the Ownership cutoff', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    newestSnapshot: { newest: '2026-09-26', age_days: 3 },
    ownership: [
      ownershipRow(501, '60.00', '2026-09-26'), ownershipRow(502, '18.00', '2026-09-26'),
      ownershipRow(505, '17.50', '2026-09-26'),
    ],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.playerId), [502, 505]);
  assert.deepEqual(res.body.targets.map((x) => x.ownership), [18, 17.5]);
  assert.equal(res.body.ownershipAsOf, '2026-09-26');
});

// ---------------------------------------------------------------------------
// GET /waiver-targets computed fallback when no board exists (#1830)
// ---------------------------------------------------------------------------

const projectionService = require('../services/projection.service');

// One candidate: `points` is the Pool projection; the rest are the facts the
// candidate read returns for the player row.
function candidate(id, points, over = {}) {
  return {
    id, points, name: `Cand ${id}`, position: 'WR', nfl_team: 'NYJ', photo_url: null,
    injury_status: null, has_recent_stats: true, ownership: '10.00', ...over,
  };
}

// Installs the no-board world: Pool projections, the candidate read, Ownership,
// and a Weekly run whose Position-baseline / Unavailable verdicts come from
// `baseline` and `unavailable` (sets of ids).
function installComputed(t, candidates, { baseline = [], backup = [], unavailable = [], identity = [], week3LastStatus = 'final' } = {}) {
  t.mock.method(waiverBoards, 'getBoard', () => null);
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map(
    candidates.map((c) => [c.id, { points: c.points, source: 'extrapolated' }])
  ));
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => ({
    pointsFor: () => null,
    startVerdictFor: (id) => {
      if (unavailable.includes(id)) return { outcome: 'unavailable', reason: 'bye', numberTrusted: true };
      if (backup.includes(id)) return { outcome: 'not_recommended', reason: 'backup', numberTrusted: false };
      if (baseline.includes(id)) return { outcome: 'not_recommended', reason: 'no_history', numberTrusted: false };
      return { outcome: 'recommendable', reason: null, numberTrusted: true };
    },
    playerIds,
  }));
  const seen = { candidateParams: null };
  installPool(t, [
    ['"has_recent_stats"', (params) => {
      seen.candidateParams = params;
      return { rows: candidates.filter((c) => params[0].includes(c.id)) };
    }],
    ...slateHandlers({
      week3LastStatus,
      identity,
      ownership: candidates.filter((c) => c.ownership != null).map((c) => ownershipRow(c.id, c.ownership)),
    }),
  ]);
  return seen;
}

test('GET /waiver-targets with no board returns computed targets ranked by this week\'s projection', async (t) => {
  const seen = installComputed(t, [
    candidate(1, 8.2, { name: 'Low', position: 'WR' }),
    candidate(2, 15.4, { name: 'High', position: 'RB', nfl_team: 'MIA' }),
    candidate(3, 11.0, { name: 'Mid', position: 'TE', nfl_team: 'NYJ' }),
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.equal(res.body.week, 4);
  assert.equal(res.body.source, 'computed');
  assert.deepEqual(res.body.targets.map((x) => x.name), ['High', 'Mid', 'Low']);
  const first = res.body.targets[0];
  assert.equal(first.position, 'RB');
  assert.equal(first.nflTeam, 'MIA');
  assert.equal(first.opponent, 'MIN');
  assert.equal(first.ownership, 10);
  assert.equal(first.projection, 15.4);
  assert.ok(!('bidMin' in first) && !('bidMax' in first) && !('reason' in first), 'no bid range or reason on a computed target');
  assert.equal(res.body.ownershipAsOf, '2026-09-29');
  // The stats window is the last two completed weeks of the waiver week's season.
  assert.equal(seen.candidateParams[1], 2026);
  assert.deepEqual([...seen.candidateParams[2]].sort(), [2, 3]);
  assertNoLeakyKeys(res.body);
});

test('GET /waiver-targets computed: a Position-baseline player with the highest projection is not returned', async (t) => {
  installComputed(t, [
    candidate(1, 30, { name: 'Baseline Star' }),
    candidate(2, 9, { name: 'Real Evidence' }),
  ], { baseline: [1] });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Real Evidence']);
});

test('GET /waiver-targets computed: a Backup quarterback (ADR 0057) with the highest projection is not returned', async (t) => {
  installComputed(t, [
    candidate(1, 30, { name: 'Keenum', position: 'QB' }),
    candidate(2, 9, { name: 'Real Evidence' }),
  ], { backup: [1] });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Real Evidence']);
});

test('GET /waiver-targets computed: a player with no stats in the last two completed weeks is not returned', async (t) => {
  installComputed(t, [
    candidate(1, 20, { name: 'No Recent Stats', has_recent_stats: false }),
    candidate(2, 9, { name: 'Played' }),
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Played']);
});

test('GET /waiver-targets computed: Out, IR and Doubtful are not returned; Questionable is', async (t) => {
  installComputed(t, [
    candidate(1, 20, { name: 'Out Guy', injury_status: 'O' }),
    candidate(2, 19, { name: 'IR Guy', injury_status: 'IR' }),
    candidate(3, 18, { name: 'Doubtful Guy', injury_status: 'D' }),
    candidate(4, 17, { name: 'Questionable Guy', injury_status: 'Q' }),
    candidate(5, 16, { name: 'Healthy Guy', injury_status: null }),
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Questionable Guy', 'Healthy Guy']);
});

test('GET /waiver-targets computed: a player with No NFL team and an Unavailable player are not returned', async (t) => {
  installComputed(t, [
    candidate(1, 20, { name: 'No Team', nfl_team: null }),
    candidate(2, 19, { name: 'On Bye' }),
    candidate(3, 9, { name: 'Available' }),
  ], { unavailable: [2] });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Available']);
});

test('GET /waiver-targets computed: 99.8% Ownership (Kenneth Walker III), exactly 50% and no Ownership row are not returned', async (t) => {
  installComputed(t, [
    candidate(1, 25, { name: 'Kenneth Walker III', position: 'RB', ownership: '99.80' }),
    candidate(2, 24, { name: 'Half Owned', ownership: '50.00' }),
    candidate(3, 23, { name: 'No Row', ownership: null }),
    candidate(4, 9, { name: 'Under Half', ownership: '49.99' }),
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Under Half']);
  assert.ok(!JSON.stringify(res.body).includes('99.8'));
});

test('GET /waiver-targets computed: only QB, RB, WR and TE are returned', async (t) => {
  installComputed(t, [
    candidate(1, 20, { name: 'Kicker', position: 'K' }),
    candidate(2, 19, { name: 'Defense', position: 'DEF' }),
    candidate(3, 9, { name: 'Passer', position: 'QB' }),
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Passer']);
});

test('GET /waiver-targets computed: at most 2 per position, and never more than 8 targets', async (t) => {
  const rbs = Array.from({ length: 5 }, (_, i) => candidate(10 + i, 20 - i, { name: `RB ${i}`, position: 'RB' }));
  installComputed(t, rbs);
  const onlyRbs = await request(makeApp()).get('/api/public/waiver-targets');
  assert.deepEqual(onlyRbs.body.targets.map((x) => x.name), ['RB 0', 'RB 1']);

  t.mock.restoreAll();
  const many = ['QB', 'RB', 'WR', 'TE'].flatMap((position, p) => Array.from({ length: 4 }, (_, i) => (
    candidate(100 + p * 10 + i, 30 - p - i * 4, { name: `${position} ${i}`, position })
  )));
  installComputed(t, many);
  const full = await request(makeApp()).get('/api/public/waiver-targets');
  assert.equal(full.body.targets.length, 8);
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    assert.equal(full.body.targets.filter((x) => x.position === position).length, 2);
  }
  const projections = full.body.targets.map((x) => x.projection);
  assert.deepEqual(projections, [...projections].sort((a, b) => b - a));
});

test('GET /waiver-targets computed: a Position-baseline player does not use up a position slot', async (t) => {
  installComputed(t, [
    candidate(1, 30, { name: 'Baseline RB', position: 'RB' }),
    candidate(2, 20, { name: 'RB A', position: 'RB' }),
    candidate(3, 19, { name: 'RB B', position: 'RB' }),
    candidate(4, 18, { name: 'RB C', position: 'RB' }),
  ], { baseline: [1] });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['RB A', 'RB B']);
});

test('GET /waiver-targets computed: keeps filling past a first batch of 24 that is all Position-baseline', async (t) => {
  const baselineRbs = Array.from({ length: 24 }, (_, i) => candidate(200 + i, 50 - i, { name: `Baseline ${i}`, position: 'RB' }));
  const real = [candidate(300, 5, { name: 'Real RB', position: 'RB' }), candidate(301, 4, { name: 'Real WR', position: 'WR' })];
  installComputed(t, [...baselineRbs, ...real], { baseline: baselineRbs.map((c) => c.id) });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.name), ['Real RB', 'Real WR']);
  assert.equal(projectionService.getWeeklyProjections.mock.callCount(), 2);
});

test('GET /waiver-targets computed: serves an athlete once when two of his player rows are candidates', async (t) => {
  installComputed(t, [
    candidate(1, 20, { name: 'Twin', position: 'RB' }),
    candidate(2, 19, { name: 'Twin', position: 'RB' }),
    candidate(3, 9, { name: 'Other RB', position: 'RB' }),
  ], {
    identity: [
      { requested_id: 1, identity_id: 1 }, { requested_id: 1, identity_id: 2 },
      { requested_id: 2, identity_id: 1 }, { requested_id: 2, identity_id: 2 },
    ],
  });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.deepEqual(res.body.targets.map((x) => x.playerId), [1, 3]);
});

test('GET /waiver-targets with a board for the waiver week returns the board, not the fallback', async (t) => {
  installComputed(t, [candidate(1, 30, { name: 'Computed Star' })]);
  t.mock.method(waiverBoards, 'getBoard', () => FAKE_BOARD);
  installPool(t, slateHandlers({
    week3LastStatus: 'final',
    players: FAKE_PLAYERS,
    ownership: [ownershipRow(502, '18.00')],
  }));

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.body.source, 'editorial');
  assert.deepEqual(res.body.targets.map((x) => x.name), ['Braelon Allen']);
  assert.equal(projectionService.getWeekProjections.mock.callCount(), 0);
});

test('GET /waiver-targets computed: waiver week 3 looks back at completed weeks 1 and 2', async (t) => {
  const seen = installComputed(t, [candidate(1, 30, { name: 'Anyone' })], { week3LastStatus: 'in_progress' });

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.body.week, 3);
  assert.equal(res.body.source, 'computed');
  assert.deepEqual(res.body.targets.map((x) => x.name), ['Anyone']);
  assert.deepEqual([...seen.candidateParams[2]].sort(), [1, 2]);
});

test('GET /waiver-targets computed: no completed week (waiver week 1) has nothing to compute from', async (t) => {
  t.mock.method(waiverBoards, 'getBoard', () => null);
  t.mock.method(projectionService, 'getWeekProjections', async () => { throw new Error('should not be read'); });
  installPool(t, [
    ['EXTRACT(MONTH FROM CURRENT_DATE)', { rows: [{ season: 2026 }] }],
    ['FROM "nfl_games"', { rows: scheduleRows(1, 'KC', 'BUF', '2026-09-10T00:20:00Z') }],
    ['FROM "live_game_states"', { rows: [] }],
    ['FROM "private"."game_recaps"', { rows: [] }],
    ['MAX("captured_date")', { rows: [{ newest: '2026-09-29', age_days: 0 }] }],
  ]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 200);
  assert.equal(res.body.week, 1);
  assert.equal(res.body.source, 'computed');
  assert.deepEqual(res.body.targets, []);
});

test('GET /waiver-targets surfaces a failed read as 500', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installPool(t, [['EXTRACT(MONTH FROM CURRENT_DATE)', () => { throw new Error('db down'); }]]);

  const res = await request(makeApp()).get('/api/public/waiver-targets');

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to fetch waiver targets' });
  assert.equal(errors.length, 1);
});
