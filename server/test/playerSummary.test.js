const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aggregateSeasonStats,
  buildPlayerSummary,
  SCORING_PRESETS,
} = require('../services/scoring.service');

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
});

test('buildPlayerSummary perGame is zero-safe when a season has zero games', () => {
  const out = buildPlayerSummary({
    player: PLAYER,
    weeklyRows: [],
    seasonRows: [{ season: 2023, games_played: 0, stats: {} }],
  });
  assert.equal(out.previousSeasons[0].perGame, 0);
});
