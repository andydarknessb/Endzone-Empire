const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const svc = require('../services/publicRead.service');

// ---- pure helpers -----------------------------------------------------------

test('statLine skips zeros and orders/labels known stat keys', () => {
  assert.equal(
    svc.statLine({ passingYards: 305, passingTDs: 3, interceptions: 0, rushingYards: 12 }),
    '305 pass yds, 3 pass TD, 12 rush yds'
  );
  assert.equal(svc.statLine(null), '');
  assert.equal(svc.statLine({}), '');
});

test('trendFromWeeks compares the last two played weeks', () => {
  assert.equal(svc.trendFromWeeks([]), 'flat');
  assert.equal(svc.trendFromWeeks([{ week: 1, fantasy_points: 10 }]), 'flat');
  assert.equal(svc.trendFromWeeks([
    { week: 2, fantasy_points: 8 }, { week: 3, fantasy_points: 20 },
  ]), 'up');
  assert.equal(svc.trendFromWeeks([
    { week: 3, fantasy_points: 20 }, { week: 2, fantasy_points: 8 }, // unordered input
  ]), 'up');
  assert.equal(svc.trendFromWeeks([
    { week: 2, fantasy_points: 20 }, { week: 3, fantasy_points: 8 },
  ]), 'down');
  assert.equal(svc.trendFromWeeks([
    { week: 2, fantasy_points: 8 }, { week: 3, fantasy_points: 8 },
  ]), 'flat');
});

test('firstSentence extracts the leading sentence for list hooks', () => {
  assert.equal(svc.firstSentence('KC won 27-24. It was close.'), 'KC won 27-24.');
  assert.equal(svc.firstSentence('No terminal punctuation'), 'No terminal punctuation');
  assert.equal(svc.firstSentence(''), '');
  assert.equal(svc.firstSentence(null), '');
});

// ---- serializers whitelist fields ------------------------------------------

test('serializeRankingRow rounds and exposes only whitelisted fields', () => {
  const out = svc.serializeRankingRow({
    rank: 1,
    row: { id: 4, name: 'X', position: 'RB', nfl_team: 'KC', photo_url: 'p', injury_status: null,
      // decoy fields that must NOT survive the serializer:
      user_id: 99, league_id: 7 },
    projectedPoints: 22.44,
    seasonPoints: 120.55,
    lastWeekPoints: 15.06,
    trend: 'up',
  });
  assert.deepEqual(Object.keys(out).sort(), [
    'injuryStatus', 'lastWeekPoints', 'name', 'nflTeam', 'photoUrl',
    'playerId', 'position', 'projectedPoints', 'rank', 'seasonPoints', 'trend',
  ]);
  assert.equal(out.projectedPoints, 22.4);
  assert.equal(out.lastWeekPoints, 15.1);
});

test('serializeRecapDetail defaults missing structured fields safely', () => {
  const out = svc.serializeRecapDetail({
    tank01_game_id: 'g1', season: 2026, week: 1, home_team: 'A', away_team: 'B',
    home_score: 10, away_score: 7, final_at: null, data: null,
  });
  assert.deepEqual(out.scoringPlays, []);
  assert.deepEqual(out.topPerformers, []);
  assert.equal(out.lineScore, null);
  assert.equal(out.narrative, '');
});

test('recap serializers expose version metadata and recursively whitelist stored JSON', () => {
  const row = {
    tank01_game_id: 'g1', season: 2026, week: 1, home_team: 'A', away_team: 'B',
    home_score: 10, away_score: 7, final_at: '2026-09-01T00:00:00Z',
    generated_at: '2026-09-01T00:01:00Z', data_version: 1, generator_version: '1.0.0',
    user_id: 1, league_id: 2,
    data: {
      narrative: 'A won.', userId: 3, leagueId: 4,
      lineScore: { home: [3, 7], away: [0, 7], user_id: 5 },
      scoringPlays: [{
        quarter: 1, clock: '3:00', team: 'A', description: 'TD',
        homeScore: 10, awayScore: 7, league_id: 6,
      }],
      topPerformers: [{
        playerId: 8, name: 'Player', position: 'RB', nflTeam: 'A',
        photoUrl: null, fantasyPoints: 17.2, statLine: '100 rush yds', userId: 7,
      }],
    },
  };

  const detail = svc.serializeRecapDetail(row);
  const list = svc.serializeRecapListRow(row);

  assert.equal(detail.generatedAt, row.generated_at);
  assert.equal(detail.dataVersion, 1);
  assert.equal(detail.generatorVersion, '1.0.0');
  assert.deepEqual(detail.lineScore, { home: [3, 7], away: [0, 7] });
  assert.deepEqual(Object.keys(detail.scoringPlays[0]).sort(), [
    'awayScore', 'clock', 'description', 'homeScore', 'quarter', 'team',
  ]);
  assert.deepEqual(Object.keys(detail.topPerformers[0]).sort(), [
    'fantasyPoints', 'name', 'nflTeam', 'photoUrl', 'playerId', 'position', 'statLine',
  ]);
  assert.equal(list.generatedAt, row.generated_at);
  assert.equal(list.dataVersion, 1);
  assert.equal(list.generatorVersion, '1.0.0');
  assert.equal(list.topPerformer.name, 'Player');
  assert.doesNotMatch(JSON.stringify({ detail, list }), /user_id|userId|league_id|leagueId/);
});

// ---- getRankings integration (stubbed pool) --------------------------------

test('getRankings ranks by projected points and caps at the limit', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "player_projections"')) {
      return { rows: [
        { player_id: 1, projected_points: '10', source: 'extrapolated' },
        { player_id: 2, projected_points: '30', source: 'extrapolated' },
        { player_id: 3, projected_points: '20', source: 'extrapolated' },
      ] };
    }
    if (text.includes('FROM "players" "p"')) {
      return { rows: [
        { id: 1, name: 'A', position: 'RB', nfl_team: 'KC', photo_url: null, injury_status: null, season_points: '50' },
        { id: 2, name: 'B', position: 'RB', nfl_team: 'BUF', photo_url: null, injury_status: null, season_points: '40' },
        { id: 3, name: 'C', position: 'RB', nfl_team: 'SF', photo_url: null, injury_status: null, season_points: '60' },
      ] };
    }
    if (text.includes('"week" <= $3')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const { rankings } = await svc.getRankings({ position: 'RB', season: 2026, week: 5, limit: 2 });
  assert.equal(rankings.length, 2);
  assert.deepEqual(rankings.map((r) => r.playerId), [2, 3]); // 30 then 20
  assert.deepEqual(rankings.map((r) => r.rank), [1, 2]);
});

test('getRankings returns empty when there is no stat data', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('MAX("season")::int')) return { rows: [{ season: null }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const out = await svc.getRankings({});
  assert.deepEqual(out, { season: null, week: null, rankings: [] });
});

test('getPlayerProfile returns null for a missing player', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  assert.equal(await svc.getPlayerProfile(123), null);
});
