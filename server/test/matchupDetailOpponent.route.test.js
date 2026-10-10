const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const scoringService = require('../services/scoringRules');
const decisionService = require('../services/decision.service');
const lineupOverrideService = require('../services/lineupOverride.service');

/**
 * #425: GET /api/league/:id/matchups/:matchupId keys its `nfl_team -> opponent`
 * schedule map off raw `nfl_games.nfl_team` and looks it up with raw
 * `players.nfl_team`. That agrees for a skill player (both Tank01 codes) but
 * not for a DEF unit, whose `players.nfl_team` is a full team name
 * (`syncTeamDefenses` seeds it that way) - so every DEF's `opponent` came back
 * null. The fix (`decision.service`'s #423 pattern) normalizes both sides of
 * the JS-side comparison through `normalizeNflTeam`.
 *
 * #1136: the map's VALUE (`nfl_games.opponent`) is folded too now, not left
 * raw. A starter row's `opponent` is a Team code once it leaves the server
 * (CONTEXT.md, Team code), the same vocabulary the client keys kits and
 * colours by, so a raw WSH never sits beside a folded WAS on one starter row
 * again.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-detail-opponent-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const LEAGUE_ID = 1;
const VIEWER = { userId: 42, teamId: 11 };
const OTHER = { userId: 43, teamId: 12 };
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

const MATCHUP_ROW = {
  id: 7,
  league_id: LEAGUE_ID,
  season: 2026,
  week: 1,
  home_team_id: VIEWER.teamId,
  away_team_id: OTHER.teamId,
  home_score: '0',
  away_score: '0',
  status: 'scheduled',
  home_team_name: 'Gridiron Ghosts',
  away_team_name: 'Sunday Scaries',
  home_owner_id: VIEWER.userId,
  away_owner_id: OTHER.userId,
  home_team_avatar_url: null,
  away_team_avatar_url: null,
  home_team_avatar_static_url: null,
  away_team_avatar_static_url: null,
};

/**
 * Drives the real route with one starter row on the home team (`starterRow`)
 * and one week of schedule (`scheduleRows`); everything else (bench, the away
 * team's lineup) comes back empty. Returns the home team's lone starter.
 */
async function getDetail(t, {
  starterRow, scheduleRows, readFails = false, verdict = { outcome: 'recommendable', reason: null, numberTrusted: true },
}) {
  t.mock.method(scoringService, 'rulesForLeague', () => ({}));
  // The route reads the weekly (league-aware) run through expectedFinal.service
  // (every row, starter and bench, since #883); it does not matter to the
  // opponent question. A row the producer did not price gets its availability
  // from the same run's Start verdict (ADR 0061), `verdict` here.
  t.mock.method(projectionService, 'getWeeklyProjections', async () => {
    if (readFails) throw new Error('projection store down');
    return {
      modelVersion: 'test',
      projections: new Map(),
      pointsFor: () => null,
      startVerdictFor: () => verdict,
    };
  });
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr' }] })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: scheduleRows })],
    [/"lineup_entries"\."slot" = \$4/, () => ({ rows: [] })], // BENCH, both teams
    [/"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === VIEWER.teamId ? [starterRow] : [], // starters; only the home team has one
    })],
    // The producer's own read (every non-IR row for both teams); it does not
    // matter to the opponent question.
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(VIEWER.userId));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function getHomeStarter(t, args) {
  const [starter] = (await getDetail(t, args)).home.starters;
  assert.ok(starter, 'expected exactly one home starter');
  return starter;
}

test('a DEF unit resolves its real-game opponent even though players.nfl_team is a full team name (#425)', async (t) => {
  const starterRow = {
    id: 101, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
    injury_status: null, slot: 'DST', stats: null,
  };
  const scheduleRows = [{ nfl_team: 'DEN', opponent: 'KC' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, 'KC');
});

test('a skill player raw-coded WSH still resolves against a raw-coded WSH schedule row (#425)', async (t) => {
  const starterRow = {
    id: 102, name: 'Some Wideout', position: 'WR', nfl_team: 'WSH',
    injury_status: null, slot: 'WR', stats: null,
  };
  const scheduleRows = [{ nfl_team: 'WSH', opponent: 'DAL' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, 'DAL');
});

test("the opponent value now folds ('WSH' becomes 'WAS') (#1136)", async (t) => {
  const starterRow = {
    id: 103, name: 'Some Runner', position: 'RB', nfl_team: 'DAL',
    injury_status: null, slot: 'RB', stats: null,
  };
  const scheduleRows = [{ nfl_team: 'DAL', opponent: 'WSH' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, 'WAS');
});

test('a starter with no game row in the week\'s schedule carries opponent: null (#1136)', async (t) => {
  const starterRow = {
    id: 104, name: 'Bye Week Back', position: 'RB', nfl_team: 'CHI',
    injury_status: null, slot: 'RB', stats: null,
  };
  // No nfl_games row for CHI this week (a bye, or an unsynced slate).
  const scheduleRows = [{ nfl_team: 'DAL', opponent: 'WSH' }];
  const starter = await getHomeStarter(t, { starterRow, scheduleRows });
  assert.equal(starter.opponent, null);
});

// ADR 0061: a row the producer did not price (here: its read returns no candidate
// rows) still reads its availability from the Weekly projection read's Start
// verdict. The deleted fallback built a verdict by hand with `onBye: false`
// ("a bye is unknown then"), so a player on bye read available.
test('a starter with no priced row and a bye in the read still reads on bye', async (t) => {
  const starterRow = {
    id: 106, name: 'Bye Week Back', position: 'RB', nfl_team: 'CHI',
    injury_status: null, slot: 'RB', stats: null,
  };
  const starter = await getHomeStarter(t, {
    starterRow,
    scheduleRows: [],
    verdict: { outcome: 'unavailable', reason: 'bye', numberTrusted: true },
  });
  assert.deepEqual(starter.availability, { available: false, reason: 'bye' });
});

test('a starter with no priced row and a healthy verdict in the read reads available', async (t) => {
  const starterRow = {
    id: 107, name: 'Healthy Back', position: 'RB', nfl_team: 'CHI',
    injury_status: null, slot: 'RB', stats: null,
  };
  const starter = await getHomeStarter(t, { starterRow, scheduleRows: [] });
  assert.deepEqual(starter.availability, { available: true, reason: null });
});

test('a starter with no priced row and no read at all carries availability: null, never a guessed verdict', async (t) => {
  t.mock.method(console, 'error', () => {});
  const starterRow = {
    id: 108, name: 'Unknown Back', position: 'RB', nfl_team: 'CHI',
    injury_status: 'O', slot: 'RB', stats: null,
  };
  // The producer's own read fails the same way, so nothing priced him either.
  const starter = await getHomeStarter(t, { starterRow, scheduleRows: [], verdict: undefined, readFails: true });
  assert.equal(starter.availability, null);
});

// #1857: each team's called shot rides on its side of the detail body once the
// service says both of its players have locked (the visibility rule lives in
// lineupOverride.service and is tested there).
const SHOT_INPUT = {
  starterRow: { id: 105, name: 'Some Runner', position: 'RB', nfl_team: 'DAL', injury_status: null, slot: 'RB', stats: null },
  scheduleRows: [{ nfl_team: 'DAL', opponent: 'NYG' }],
};
const SHOT = { starter: { playerId: 105, name: 'Some Runner', points: 11.4 }, benched: { playerId: 9, name: 'Bench Guy', points: 6.2 }, outcome: null };

test('each side carries the called shot the service reveals, and null otherwise (#1857)', async (t) => {
  const asked = [];
  t.mock.method(lineupOverrideService, 'loadPublicCalledShot', async (db, args) => {
    asked.push(args);
    return args.teamId === VIEWER.teamId ? SHOT : null;
  });
  const body = await getDetail(t, SHOT_INPUT);
  assert.deepEqual(body.home.calledShot, SHOT);
  assert.equal(body.away.calledShot, null);
  assert.deepEqual(asked.map((a) => [a.teamId, a.season, a.week]), [[11, 2026, 1], [12, 2026, 1]]);
});

test('a failed called-shot read is no shot, never a failed page (#1857)', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(lineupOverrideService, 'loadPublicCalledShot', async () => { throw new Error('db down'); });
  const body = await getDetail(t, SHOT_INPUT);
  assert.equal(body.home.calledShot, null);
  assert.equal(body.away.calledShot, null);
});
