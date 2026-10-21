const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakePool, select } = require('./helpers/fakePool');
const { getMatchupDetail } = require('../services/matchupDetail.service');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const decisionService = require('../services/decision.service');
const lineupOverrideService = require('../services/lineupOverride.service');
const clock = require('../modules/clock');

/**
 * #2231: the matchup detail body, pinned byte for byte by one golden fixture
 * (fixtures/matchupDetail.golden.json). One seed drives a live (unsettled)
 * week with every body key populated: a viewer who owns the home team (so
 * viewerTeamId and viewerWhatIf), starters and bench, a game in progress (the
 * game_clock key), an Out and a bye row, a row the producer did not price
 * (the Weekly projection verdict), game ids, and a called shot on each side.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-detail-service-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const GOLDEN = path.join(__dirname, 'fixtures', 'matchupDetail.golden.json');
const LEAGUE_ID = 1;
const SEASON = 2026;
const WEEK = 8;
const HOME = 11;
const AWAY = 12;
const NOW = '2026-10-25T18:00:00.000Z'; // Sunday afternoon, after the 17:00Z kickoffs

const OUT = { available: false, activeProbability: 0, reason: 'out', status: 'O' };
const BYE = { available: false, activeProbability: 0, reason: 'bye', status: null };

const MATCHUP_ROW = {
  id: 7,
  league_id: LEAGUE_ID,
  season: SEASON,
  week: WEEK,
  home_team_id: HOME,
  away_team_id: AWAY,
  home_score: '0',
  away_score: '0',
  final: false,
  home_team_name: 'Gridiron Ghosts',
  away_team_name: 'Sunday Scaries',
  home_owner_id: 42,
  away_owner_id: 43,
  home_team_avatar_url: null,
  away_team_avatar_url: null,
  home_team_avatar_static_url: null,
  away_team_avatar_static_url: null,
};

const player = (id, name, position, nfl_team, injury_status, slot, stats, photo_url = null) => ({
  id, player_id: id, name, position, nfl_team, injury_status, slot, stats, photo_url,
});
const HOME_STARTERS = [
  player(101, 'Some Passer', 'QB', 'KC', null, 'QB', { passingYards: 250, passingTouchdowns: 2 }),
  player(102, 'Some Wideout', 'WR', 'PHI', 'O', 'WR', null),
];
const HOME_BENCH = [
  player(103, 'Some Runner', 'RB', 'DAL', null, 'BENCH', null, 'https://a.espncdn.com/i/headshots/nfl/players/full/103.png'),
  player(105, 'Unpriced Reserve', 'TE', 'DAL', 'O', 'BENCH', null), // in no producer read: the verdict path
];
const AWAY_STARTERS = [
  player(201, 'Resting Back', 'RB', 'Ghosts', null, 'RB', null),
  player(202, 'Chiefs Defense', 'DEF', 'Kansas City Chiefs', null, 'DEF', { sacks: 3 }),
];
const PRODUCER_ROWS = [
  ...[...HOME_STARTERS, ...HOME_BENCH.slice(0, 1)].map((p) => [HOME, p]),
  ...AWAY_STARTERS.map((p) => [AWAY, p]),
].map(([team_id, p]) => ({
  team_id, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats,
}));

const PROJECTIONS = new Map([
  [101, { points: 19 }],
  [102, { points: 11.3, availability: OUT }],
  [103, { points: 7.7 }],
  [105, { points: 5.5, availability: OUT }],
  [201, { points: 9, availability: BYE }],
  [202, { points: 8.25 }],
]);
const LIVE = [
  { home_team: 'KC', away_team: 'LV', game_status: 'in_progress', quarter: 'Q3', time_remaining: '6:42', updated_at: '2026-10-25T17:58:00.000Z' },
  { home_team: 'DAL', away_team: 'SF', game_status: 'final', quarter: 'Final', time_remaining: '0:00', updated_at: '2026-10-25T17:55:00.000Z' },
];
const SCHEDULE = [
  { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-25T17:00:00.000Z' },
  { nfl_team: 'PHI', opponent: 'NYG', kickoff_at: '2026-10-25T20:25:00.000Z' },
  { nfl_team: 'DAL', opponent: 'SF', kickoff_at: '2026-10-25T13:00:00.000Z' },
];
const BYE_ROWS = [];
for (let w = 1; w <= 18; w++) {
  for (const team of ['KC', 'PHI', 'DAL']) BYE_ROWS.push({ nfl_team: team, week: w });
  if (w !== WEEK) BYE_ROWS.push({ nfl_team: 'Ghosts', week: w });
}
const WHAT_IF = { benchPlayerId: 103, delta: 1.5 };
const SHOT = { starter: { playerId: 101, name: 'Some Passer', points: 11.4 }, benched: { playerId: 103, name: 'Some Runner', points: 6.2 }, outcome: null };

function fakeWeeklyResult(projections) {
  return {
    modelVersion: 'test',
    projections,
    pointsFor(id) {
      const entry = projections.get(id);
      return entry == null ? null : Number(entry.points);
    },
    startVerdictFor(id) {
      const entry = projections.get(id);
      const availability = (entry && entry.availability) || {};
      return projectionService
        .toWeeklyProjectionResult({ projections: new Map([[id, { factors: { availability } }]]) })
        .startVerdictFor(id);
    },
  };
}

// Installs every seam the detail read crosses and returns the fake pool.
// #2388: `dropped` is a starter whose row was spared after his kickoff (#627)
// and who is no longer on team_players: only a starters read that no longer
// joins the current roster returns him, as the table would.
// `notHeld` is what playersNotHeldAtKickoff's tenure read reports: the ids settle excludes.
function seed(t, { dropped = null, droppedBench = null, bestBall = false, notHeld = [] } = {}) {
  t.mock.method(clock, 'now', () => new Date(NOW));
  t.mock.method(projectionService, 'getWeeklyProjections', async () => fakeWeeklyResult(PROJECTIONS));
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => WHAT_IF);
  t.mock.method(lineupOverrideService, 'loadPublicCalledShot', async (db, args) => (args.teamId === HOME ? SHOT : null));
  return createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: bestBall }] })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: BYE_ROWS })],
    [/FROM "nfl_games"/, () => ({ rows: SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: LIVE })],
    [/FROM "view_matchup_nfl_games"/, () => ({
      rows: [{ tank01_game_id: '20261025_LV@KC' }, { tank01_game_id: '20261025_SF@DAL' }, { tank01_game_id: '20261025_LV@KC' }],
    })],
    // Off-roster rows come back only from a statement with no team_players join, as the table would.
    [/"lineup_entries"\."slot" = \$4/, (text, params) => ({
      rows: params[0] === HOME
        ? [...HOME_BENCH, ...(droppedBench && !/JOIN "team_players"/.test(text) ? [droppedBench] : [])]
        : [],
    })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME
        ? [...HOME_STARTERS.map((r) => ({ on_roster: true, ...r })), ...(dropped && !/JOIN "team_players"/.test(text) ? [{ ...dropped, on_roster: false }] : [])]
        : AWAY_STARTERS.map((r) => ({ on_roster: true, ...r })),
    })],
    [/FROM unnest/, () => ({ rows: notHeld.map((player_id) => ({ player_id })) })],
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({ rows: PRODUCER_ROWS })],
  ]).install(t);
}

async function fetchDetail(t) {
  const fake = seed(t);
  const client = await fake.connect();
  try {
    const detail = await getMatchupDetail({ leagueId: LEAGUE_ID, matchupId: 7, viewerUserId: 42, client });
    // The live path opens exactly one transaction and closes it by COMMIT.
    assert.equal(fake.matching(/^BEGIN$/).length, 1);
    assert.equal(fake.matching(/^COMMIT$/).length, 1);
    assert.equal(fake.matching(/^ROLLBACK$/).length, 0);
    return detail;
  } finally {
    client.release();
    fake.assertClean(); // no transaction left open on the released client
  }
}

test('the matchup detail body equals the golden fixture byte for byte', async (t) => {
  const detail = await fetchDetail(t);
  assert.ok(detail, 'the matchup is in the league');
  const body = JSON.parse(JSON.stringify(detail)); // the wire form: Dates and undefined as the route sends them
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(body, golden);
  assert.equal(JSON.stringify(body), JSON.stringify(golden));
});

test('a matchup that is not in the league is null, which the route maps to 404', async (t) => {
  const fake = seed(t);
  const client = await fake.connect();
  try {
    t.mock.method(client, 'query', async (sql) => {
      if (/FROM "matchups"/.test(sql)) return { rows: [] };
      throw new Error(`unexpected query after the empty matchup read: ${sql}`);
    });
    assert.equal(await getMatchupDetail({ leagueId: LEAGUE_ID, matchupId: 999, viewerUserId: 42, client }), null);
  } finally {
    client.release();
  }
});

test('a throw inside the live path rolls the transaction back in the module and rethrows (#839)', async (t) => {
  const fake = seed(t);
  lineupService.materializeLineup.mock.mockImplementation(async () => { throw new Error('lineup read failed'); });
  const client = await fake.connect();
  try {
    await assert.rejects(
      getMatchupDetail({ leagueId: LEAGUE_ID, matchupId: 7, viewerUserId: 42, client }),
      /lineup read failed/
    );
    assert.equal(fake.matching(/^BEGIN$/).length, 1);
    assert.equal(fake.matching(/^COMMIT$/).length, 0);
    assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the module closed its own transaction');
  } finally {
    client.release();
    fake.assertClean();
  }
});

// #2388: a standard league's live starters read without the current-roster
// join, so a starter dropped after kickoff stays at his slot until settle. The
// bench and best ball keep the join. The real-Postgres test in
// lineupFollowsRoster.pg.test.js covers the semantics; these pin which reads join.
const droppedStarter = () => player(106, 'Dropped Flex', 'WR', 'KC', null, 'FLEX', { receivingYards: 100 });
const droppedBench = () => player(107, 'Dropped Reserve', 'RB', 'DAL', null, 'BENCH', null);
async function liveDetail(t, opts) {
  const fake = seed(t, opts);
  const client = await fake.connect();
  try {
    return await getMatchupDetail({ leagueId: LEAGUE_ID, matchupId: 7, viewerUserId: 42, client });
  } finally {
    client.release();
  }
}

test('a live standard week lists a starter dropped after kickoff at his slot, but not a dropped bench player (#2388)', async (t) => {
  const detail = await liveDetail(t, { dropped: droppedStarter(), droppedBench: droppedBench() });
  const row = detail.home.starters.find((s) => s.id === 106);
  assert.ok(row, 'the dropped starter is still a starter');
  assert.equal(row.slot, 'FLEX');
  assert.equal(row.points, 10);
  assert.equal(detail.home.bench.some((b) => b.id === 107), false, 'the bench keeps the roster join');
});

test('a live standard week drops an off-roster starter that settle would exclude (#2391)', async (t) => {
  const detail = await liveDetail(t, { dropped: droppedStarter(), notHeld: [106] });
  assert.equal(detail.home.starters.some((s) => s.id === 106), false, 'live matches settle: not held at his kickoff, not listed');
});

test('a live best-ball week does not list a starter dropped after kickoff (#2388)', async (t) => {
  const detail = await liveDetail(t, { dropped: droppedStarter(), bestBall: true });
  // Best-ball starters are the optimizer's chosen set over the joined rows, so
  // a row that leaked past the join would surface on the bench instead.
  const listed = [...detail.home.starters, ...detail.home.bench].map((p) => p.id);
  assert.equal(listed.includes(106), false);
});
