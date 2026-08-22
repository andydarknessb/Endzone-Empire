const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const {
  aggregateSeasonStats,
  buildPlayerSummary,
  projectSeasonPoints,
  hasTeamDefenseTiers,
  getSeasonPositionRank,
  SCORING_PRESETS,
} = require('../services/scoring.service');

// --- getSeasonPositionRank --------------------------------------------------

test('getSeasonPositionRank ranks within the literal position by stored points', async (t) => {
  let captured = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    captured = { sql: String(sql), params };
    return { rows: [{ rank: '4', group_size: 320 }] };
  });
  const out = await getSeasonPositionRank(900, 'LB', 2025);
  assert.deepEqual(out, { rank: 4, groupSize: 320 });
  assert.deepEqual(captured.params, [900, 'LB', 2025]);
  // Ranks on the stored (weekly-summed for DEF) points — never re-scores stats.
  assert.match(captured.sql, /RANK\(\) OVER \(ORDER BY "pss"\."fantasy_points" DESC\)/);
  assert.match(captured.sql, /"p"\."position" = \$2/);
});

test('getSeasonPositionRank is null without a rollup row, position, or season', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  assert.equal(await getSeasonPositionRank(900, 'LB', 2025), null); // no row
  assert.equal(await getSeasonPositionRank(900, null, 2025), null);
  assert.equal(await getSeasonPositionRank(900, 'LB', 'not-a-year'), null);
});

// --- projectSeasonPoints ----------------------------------------------------

test('projectSeasonPoints extrapolates last completed season per-game over 17', () => {
  const proj = projectSeasonPoints({
    seasonRows: [{ season: 2025, games_played: 17, stats: { rushingYards: 1700, rushingTDs: 17 } }],
    currentSeasonYear: 2026,
  });
  // 1700 * 0.1 + 17 * 6 = 170 + 102 = 272 over 17 games = 16 pt/g -> 272 season
  assert.equal(proj, 272);
});

test('projectSeasonPoints returns null below the minimum games sample', () => {
  const proj = projectSeasonPoints({
    seasonRows: [{ season: 2025, games_played: 2, stats: { rushingYards: 400, rushingTDs: 4 } }],
    currentSeasonYear: 2026,
  });
  assert.equal(proj, null);
});

test('projectSeasonPoints ignores the current (in-progress) season and empty history', () => {
  assert.equal(
    projectSeasonPoints({ seasonRows: [{ season: 2026, games_played: 17, stats: {} }], currentSeasonYear: 2026 }),
    null
  );
  assert.equal(projectSeasonPoints({ seasonRows: [], currentSeasonYear: 2026 }), null);
});

const PLAYER = {
  id: 7,
  name: 'Justin Jefferson',
  position: 'WR',
  nfl_team: 'MIN',
  jersey_number: '18',
  external_id: '4262921',
  injury_status: null,
  injury_detail: null,
  news: null,
  photo_url: 'https://img/jj.png',
};

// --- aggregateSeasonStats ---------------------------------------------------

test('aggregateSeasonStats sums weekly stat lines and counts games', () => {
  const { games, stats } = aggregateSeasonStats([
    { receivingYards: 100, receptions: 8, receivingTDs: 1 },
    { receivingYards: 75, receptions: 6, receivingTDs: 0 },
    { receivingYards: 120, receptions: 9, receivingTDs: 2 },
  ]);
  assert.equal(games, 3);
  assert.equal(stats.receivingYards, 295);
  assert.equal(stats.receptions, 23);
  assert.equal(stats.receivingTDs, 3);
});

test('aggregateSeasonStats parses stringified jsonb and ignores junk rows', () => {
  const { games, stats } = aggregateSeasonStats([
    JSON.stringify({ rushingYards: 50 }),
    null,
    'not-json',
    { rushingYards: 30 },
  ]);
  assert.equal(games, 2); // only the two valid stat objects count
  assert.equal(stats.rushingYards, 80);
});

test('aggregateSeasonStats on empty input is zero games / no stats', () => {
  assert.deepEqual(aggregateSeasonStats([]), { games: 0, stats: {} });
});

// --- buildPlayerSummary -----------------------------------------------------

const WEEKLY = [
  { season: 2026, week: 1, stats: { receivingYards: 100, receptions: 8, receivingTDs: 1 } },
  { season: 2026, week: 2, stats: { receivingYards: 60, receptions: 5, receivingTDs: 0 } },
];
const SEASONS = [
  { season: 2025, games_played: 17, stats: { receivingYards: 1500, receptions: 100, receivingTDs: 10 } },
  { season: 2024, games_played: 16, stats: { receivingYards: 1400, receptions: 90, receivingTDs: 8 } },
];

test('buildPlayerSummary shapes bio, current season, and previous seasons', () => {
  const out = buildPlayerSummary({
    player: PLAYER,
    weeklyRows: WEEKLY,
    seasonRows: SEASONS,
    rules: SCORING_PRESETS.ppr,
    byeWeek: 6,
  });
  assert.equal(out.player.name, 'Justin Jefferson');
  assert.equal(out.player.bye_week, 6);
  assert.equal(out.player.photo_url, 'https://img/jj.png');
  assert.equal(out.currentSeason.season, 2026);
  assert.equal(out.currentSeason.games, 2);
  // PPR: wk1 = 100*0.1 + 8*1 + 1*6 = 24; wk2 = 60*0.1 + 5*1 = 11 -> total 35
  assert.equal(out.currentSeason.points, 35);
  assert.equal(out.currentSeason.perGame, 17.5);
  assert.equal(out.previousSeasons.length, 2);
  assert.equal(out.previousSeasons[0].season, 2025); // newest first
});

test('buildPlayerSummary re-scores under league rules (PPR vs standard differ)', () => {
  const ppr = buildPlayerSummary({ player: PLAYER, weeklyRows: WEEKLY, seasonRows: SEASONS, rules: SCORING_PRESETS.ppr });
  const std = buildPlayerSummary({ player: PLAYER, weeklyRows: WEEKLY, seasonRows: SEASONS, rules: SCORING_PRESETS.standard });
  // Standard drops the per-reception points, so both current and prior totals fall.
  assert.ok(ppr.currentSeason.points > std.currentSeason.points);
  assert.ok(ppr.previousSeasons[0].points > std.previousSeasons[0].points);
  // 2025 standard: 1500*0.1 + 10*6 = 210; PPR adds 100 receptions -> 310
  assert.equal(std.previousSeasons[0].points, 210);
  assert.equal(ppr.previousSeasons[0].points, 310);
});

test('buildPlayerSummary with no prior data yields an empty previousSeasons array', () => {
  const out = buildPlayerSummary({ player: PLAYER, weeklyRows: WEEKLY, seasonRows: [] });
  assert.deepEqual(out.previousSeasons, []);
  assert.equal(out.currentSeason.games, 2);
});

test('buildPlayerSummary with no stats at all: null current season, empty previous', () => {
  const out = buildPlayerSummary({ player: PLAYER, weeklyRows: [], seasonRows: [], byeWeek: null });
  assert.equal(out.currentSeason, null);
  assert.deepEqual(out.previousSeasons, []);
  assert.equal(out.player.bye_week, null);
});

test('buildPlayerSummary excludes the current season from previousSeasons', () => {
  const out = buildPlayerSummary({
    player: PLAYER,
    weeklyRows: WEEKLY, // latest season 2026
    seasonRows: [{ season: 2026, games_played: 2, stats: { receivingYards: 160 } }, ...SEASONS],
    rules: SCORING_PRESETS.ppr,
  });
  assert.deepEqual(out.previousSeasons.map((s) => s.season), [2025, 2024]);
});

test('buildPlayerSummary builds the draft-facing fantasy summary (adp, last-season total, projection)', () => {
  const out = buildPlayerSummary({
    player: { ...PLAYER, adp: 4.2 },
    weeklyRows: [],
    seasonRows: SEASONS, // 2025: 17 games
    rules: SCORING_PRESETS.ppr,
    currentSeasonYear: 2026,
  });
  // 2025 PPR: 1500*0.1 + 100 + 10*6 = 310 over 17 games -> 18.2/g -> proj 18.2*17
  assert.equal(out.fantasy.adp, 4.2);
  assert.equal(out.player.adp, 4.2);
  assert.equal(out.fantasy.previousSeasonYear, 2025);
  assert.equal(out.fantasy.previousSeasonTotal, 310);
  assert.equal(out.fantasy.projectionSeason, 2026);
  assert.equal(out.fantasy.projectedPoints, Math.round(out.previousSeasons[0].perGame * 17 * 10) / 10);
});

test('buildPlayerSummary reframes last-season-only data as previous (current is null pre-season)', () => {
  // Weekly data only in 2025; league is on 2026 -> current tab empty, 2025 is previous.
  const out = buildPlayerSummary({
    player: PLAYER,
    weeklyRows: [{ season: 2025, week: 1, stats: { receivingYards: 90 } }],
    seasonRows: [{ season: 2025, games_played: 17, stats: { receivingYards: 1500, receptions: 100 } }],
    rules: SCORING_PRESETS.ppr,
    currentSeasonYear: 2026,
  });
  assert.equal(out.currentSeason, null);
  assert.deepEqual(out.previousSeasons.map((s) => s.season), [2025]);
  assert.equal(out.fantasy.previousSeasonYear, 2025);
});

test('buildPlayerSummary does not project from a tiny (1-2 game) sample', () => {
  const out = buildPlayerSummary({
    player: { ...PLAYER, adp: 1.4 },
    weeklyRows: [],
    seasonRows: [{ season: 2025, games_played: 1, stats: { rushingYards: 100, rushingTDs: 2 } }],
    rules: SCORING_PRESETS.ppr,
    currentSeasonYear: 2026,
  });
  assert.equal(out.fantasy.projectedPoints, null); // guarded — no 1-game extrapolation
  assert.ok(out.fantasy.previousSeasonTotal > 0); // the real 1-game total is still reported
});

test('buildPlayerSummary fantasy fields are null with no prior data', () => {
  const out = buildPlayerSummary({ player: PLAYER, weeklyRows: [], seasonRows: [] });
  assert.equal(out.fantasy.adp, null);
  assert.equal(out.fantasy.previousSeasonTotal, null);
  assert.equal(out.fantasy.projectedPoints, null);
  assert.equal(out.fantasy.posRank, null);
  assert.equal(out.fantasy.posRankOf, null);
  assert.equal(out.fantasy.posRankSeason, null);
});

test('buildPlayerSummary passes a supplied position rank through to fantasy', () => {
  const out = buildPlayerSummary({
    player: PLAYER,
    weeklyRows: [],
    seasonRows: SEASONS,
    currentSeasonYear: 2026,
    posRank: { season: 2025, rank: 4, groupSize: 320 },
  });
  assert.equal(out.fantasy.posRank, 4);
  assert.equal(out.fantasy.posRankOf, 320);
  assert.equal(out.fantasy.posRankSeason, 2025);
});

test('buildPlayerSummary perGame is zero-safe when a season has zero games', () => {
  const out = buildPlayerSummary({
    player: PLAYER,
    weeklyRows: [],
    seasonRows: [{ season: 2023, games_played: 0, stats: {} }],
  });
  assert.equal(out.previousSeasons[0].perGame, 0);
});

// --- team defense: per-game tiers can't be scored as a season aggregate ------

const DEF_PLAYER = {
  id: 6721, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
  jersey_number: null, external_id: null, injury_status: null, injury_detail: null,
  news: null, photo_url: null,
};

// Two shutout-ish weeks: each is 2 sacks (2) + 0 PA (10) + sub-100 yards (10) = 22.
const DEF_WEEKLY = [
  { season: 2025, week: 1, stats: { sack: 2, pointsAllowed: 0, yardsAllowed: 90 } },
  { season: 2025, week: 2, stats: { sack: 2, pointsAllowed: 0, yardsAllowed: 95 } },
];
// The aggregate of those weeks: 4 sacks, 0 PA, 185 yards -> 4 + 10 + 7 = 21,
// which is NOT 44. That gap is the whole point of the weekly-sum path.
const DEF_SEASON_STATS = { sack: 4, pointsAllowed: 0, yardsAllowed: 185 };

test('hasTeamDefenseTiers flags rows carrying per-game tier stats only', () => {
  assert.equal(hasTeamDefenseTiers({ pointsAllowed: 0 }), true);
  assert.equal(hasTeamDefenseTiers({ yardsAllowed: 300 }), true);
  assert.equal(hasTeamDefenseTiers({ soloTackle: 6, idpSack: 1 }), false);
  assert.equal(hasTeamDefenseTiers({ receivingYards: 100 }), false);
  assert.equal(hasTeamDefenseTiers(null), false);
});

test('buildPlayerSummary prices a DEF season from its weekly lines, not the aggregate', () => {
  const out = buildPlayerSummary({
    player: DEF_PLAYER,
    weeklyRows: DEF_WEEKLY,
    seasonRows: [{ season: 2025, games_played: 2, stats: DEF_SEASON_STATS, fantasy_points: 44 }],
    currentSeasonYear: 2026,
  });
  assert.equal(out.previousSeasons[0].points, 44); // 22 + 22, tiers hit once per game
  assert.equal(out.previousSeasons[0].perGame, 22);
  assert.equal(out.fantasy.previousSeasonTotal, 44);
});

test('buildPlayerSummary falls back to aggregate scoring for a DEF season with no weeklies', () => {
  const out = buildPlayerSummary({
    player: DEF_PLAYER,
    weeklyRows: [],
    seasonRows: [{ season: 2025, games_played: 2, stats: DEF_SEASON_STATS, fantasy_points: 44 }],
    currentSeasonYear: 2026,
  });
  assert.equal(out.previousSeasons[0].points, 21); // aggregate-scored, all we can do
});

test('buildPlayerSummary scores an IDP season from the aggregate (linear rules, no tiers)', () => {
  const out = buildPlayerSummary({
    player: { ...DEF_PLAYER, id: 900, name: 'Zaire Franklin', position: 'LB', nfl_team: 'IND' },
    weeklyRows: [
      { season: 2025, week: 1, stats: { soloTackle: 6, assistedTackle: 4, idpSack: 1 } },
      { season: 2025, week: 2, stats: { soloTackle: 8, assistedTackle: 2, idpSack: 0 } },
    ],
    seasonRows: [{ season: 2025, games_played: 2, stats: { soloTackle: 14, assistedTackle: 6, idpSack: 1 }, fantasy_points: 19 }],
    currentSeasonYear: 2026,
  });
  // 14 solo + 6*0.5 assists + 1 sack*2 = 19 either way — the aggregate is safe.
  assert.equal(out.previousSeasons[0].points, 19);
});

test('projectSeasonPoints uses the stored total for DEF instead of scoring the aggregate', () => {
  const proj = projectSeasonPoints({
    seasonRows: [{ season: 2025, games_played: 17, stats: { sack: 40, pointsAllowed: 340, yardsAllowed: 5600 }, fantasy_points: 170 }],
    currentSeasonYear: 2026,
  });
  assert.equal(proj, 170); // 170/17 = 10/g over 17 games
});

test('projectSeasonPoints returns null for a DEF row with no stored total', () => {
  // Guards the pre-backfill state: a tiered row we cannot price yields no
  // projection rather than the wildly negative one aggregate scoring gives.
  assert.equal(
    projectSeasonPoints({
      seasonRows: [{ season: 2025, games_played: 17, stats: { pointsAllowed: 340, yardsAllowed: 5600 } }],
      currentSeasonYear: 2026,
    }),
    null
  );
});
