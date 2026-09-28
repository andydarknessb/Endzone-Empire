const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const expectedFinalService = require('../services/expectedFinal.service');
const clock = require('../modules/clock');

/**
 * GET /api/league?include=status (Home v2, contract B): each league row the
 * caller belongs to gains a `status` block (phase, week, record, standing,
 * this week's matchup, lineup, pick'em, draft; each key only where it
 * applies) and a `statusError` flag. Driven through the real route over the
 * fake pool; only the expected-final producer is mocked, at the seam the
 * matchup list suites already use. Without the flag the response is exactly
 * today's list.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-list-status-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const USER_ID = 7;
const authed = () => `Bearer ${signToken({ id: USER_ID, username: 'member' })}`;
// Sunday of week 4, before the early games.
const NOW = '2026-10-04T16:00:00.000Z';

const LEAGUES = {
  fantasy: {
    id: 71, name: 'Winsconsota', pickem_only: false, best_ball: false,
    draft_status: 'complete', season_status: 'regular',
    current_season: 2026, current_week: 4,
    roster_slots: [{ key: 'QB', count: 1 }, { key: 'FLEX', count: 1 }],
    scoring_preset: 'half_ppr', max_teams: 12, draft_date: null, draft_timezone: null,
    my_team_id: 11, my_team_name: 'Cheese Curds', team_count: 4,
    is_owner: true, is_commissioner: true,
  },
  pickem: {
    id: 72, name: 'Office Pool', pickem_only: true, best_ball: false,
    draft_status: 'pending', season_status: 'regular',
    current_season: 2026, current_week: 4,
    max_teams: 20, draft_date: null, draft_timezone: null,
    my_team_id: 21, my_team_name: 'Picker', team_count: 8,
    is_owner: false, is_commissioner: false,
  },
  preDraft: {
    id: 73, name: 'Draft Soon', pickem_only: false, best_ball: false,
    draft_status: 'pending', season_status: 'regular',
    current_season: 2026, current_week: 1,
    max_teams: 12, draft_date: '2026-10-11T00:00:00.000Z', draft_timezone: 'America/Chicago',
    my_team_id: 31, my_team_name: 'Early Bird', team_count: 9,
    is_owner: true, is_commissioner: true,
  },
};

const TEAMS = [
  { id: 11, league_id: 71, name: 'Cheese Curds' },
  { id: 12, league_id: 71, name: 'Frozen Tundra FC' },
  { id: 13, league_id: 71, name: 'Lake Effect' },
  { id: 14, league_id: 71, name: 'Supper Club' },
];

const matchup = (id, week, home, away, hs, as, final = true) => ({
  id, league_id: 71, season: 2026, week, home_team_id: home, away_team_id: away,
  home_score: String(hs), away_score: String(as), final, is_playoff: false,
});
// Cheese Curds (11), Frozen Tundra (12) and Supper Club (14) all go 2-1 and
// split their head to heads, so points for orders them: 12 (331), 11 (318),
// 14 (264). computeStandings' own order, so Cheese Curds are 2 of 4.
const MATCHUPS = [
  matchup(901, 1, 11, 12, 110, 100),
  matchup(902, 1, 13, 14, 90, 95),
  matchup(903, 2, 13, 11, 80, 120),
  matchup(904, 2, 12, 14, 130, 70),
  matchup(905, 3, 11, 14, 88, 99),
  matchup(906, 3, 12, 13, 101, 97),
  matchup(912, 4, 12, 11, 71.2, 87.4, false),
  matchup(913, 4, 13, 14, 0, 0, false),
];

// Team 11's week 4 lineup: a KC quarterback and no FLEX.
const LINEUP_ROWS = [
  { team_id: 11, slot: 'QB', name: 'Quarterback', injury_status: null, ir_attested: false, nfl_team: 'KC', on_bye: false },
  { team_id: 11, slot: 'BENCH', name: 'Late Back', injury_status: null, ir_attested: false, nfl_team: 'GB', on_bye: false },
];
const KICKOFF_ROWS = [
  { season: 2026, week: 4, nfl_team: 'KC', kickoff_at: '2026-10-04T17:00:00.000Z' },
  { season: 2026, week: 4, nfl_team: 'LV', kickoff_at: '2026-10-04T17:00:00.000Z' },
  { season: 2026, week: 4, nfl_team: 'GB', kickoff_at: '2026-10-05T00:20:00.000Z' },
  { season: 2026, week: 4, nfl_team: 'MIN', kickoff_at: '2026-10-05T00:20:00.000Z' },
];
// The pick'em slate reads nfl_games itself (both rows of a pair).
const SLATE_ROWS = [
  { week: 4, nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-04T17:00:00.000Z', game_key: 'g1', roof: null, home_away: 'home' },
  { week: 4, nfl_team: 'LV', opponent: 'KC', kickoff_at: '2026-10-04T17:00:00.000Z', game_key: 'g1', roof: null, home_away: 'away' },
  { week: 4, nfl_team: 'GB', opponent: 'MIN', kickoff_at: '2026-10-05T00:20:00.000Z', game_key: 'g2', roof: null, home_away: 'home' },
  { week: 4, nfl_team: 'MIN', opponent: 'GB', kickoff_at: '2026-10-05T00:20:00.000Z', game_key: 'g2', roof: null, home_away: 'away' },
];

const figures = (expectedFinal, playersRemaining) => ({
  expectedFinal,
  playersRemaining,
  statusReliable: true,
  firstKickoffAt: '2026-10-04T17:00:00.000Z',
  syncedAt: null,
  starters: [{ gameState: 'in_progress', availability: { available: true, reason: null } }],
  bench: [],
});

function world(t, { leagues = Object.values(LEAGUES), overrides = [], matchups = MATCHUPS } = {}) {
  t.mock.method(clock, 'now', () => new Date(NOW));
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async () => new Map([
    [11, figures(118.6, 4)],
    [12, figures(104.1, 3)],
  ]));
  const fake = createFakePool([
    ...overrides,
    [/AS "is_commissioner" FROM "leagues"/, () => ({ rows: leagues.map((l) => ({ ...l })) })],
    [/^SELECT "teams"\."id", "teams"\."league_id", "teams"\."name" FROM "teams"/, () => ({ rows: TEAMS })],
    [/FROM "matchups"/, () => ({ rows: matchups })],
    [/FROM "source"/, () => ({ rows: LINEUP_ROWS })],
    [/FROM "nfl_games" JOIN unnest/, () => ({ rows: KICKOFF_ROWS })],
    [/FROM "pickem_settings"/, () => ({ rows: [] })],
    [/fn_normalize_nfl_team\("opponent"\)/, () => ({ rows: SLATE_ROWS })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "pickem_picks"/, () => ({ rows: [{ league_id: 72, team_pair: 'KC|LV' }] })],
  ]);
  fake.install(t);
  return fake;
}

test('without include=status the list is today\'s response byte for byte, from its one query', async (t) => {
  const fake = world(t);
  const res = await request(app).get('/api/league').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.equal(res.text, JSON.stringify(Object.values(LEAGUES)));
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].params, [USER_ID]);
});

test('a fantasy league in season carries phase, week, record, standing, matchup and lineup, and nothing else', async (t) => {
  world(t);
  const res = await request(app).get('/api/league?include=status').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const row = res.body.find((l) => l.id === 71);
  // Every column the list already carried still rides along.
  assert.equal(row.name, 'Winsconsota');
  assert.equal(row.my_team_id, 11);
  assert.equal(row.statusError, false);
  assert.deepEqual(row.status, {
    phase: 'in-season',
    week: 4,
    record: { wins: 2, losses: 1, ties: 0 },
    standing: { rank: 2, of: 4 },
    matchup: {
      id: 912,
      status: 'live',
      opponent: { teamId: 12, name: 'Frozen Tundra FC' },
      my: { score: 87.4, expectedFinal: 118.6, playersRemaining: 4 },
      opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 3 },
      winProbability: null,
    },
    lineup: {
      emptySlots: ['FLEX'],
      problems: ['1 empty FLEX slot'],
      nextLockAt: '2026-10-04T17:00:00.000Z',
    },
  });
});

test('a pick\'em-only league carries only its pick\'em week; a pre-draft league only its draft', async (t) => {
  world(t);
  const res = await request(app).get('/api/league?include=status').set('Authorization', authed());
  const pickem = res.body.find((l) => l.id === 72);
  assert.deepEqual(pickem.status, {
    phase: 'in-season',
    week: 4,
    pickem: { made: 1, total: 2, nextLockAt: '2026-10-05T00:20:00.000Z' },
  });
  const preDraft = res.body.find((l) => l.id === 73);
  assert.deepEqual(preDraft.status, {
    phase: 'pre-draft',
    draft: { date: '2026-10-11T00:00:00.000Z', timezone: 'America/Chicago', seatsFilled: 9, maxTeams: 12 },
  });
  assert.equal(preDraft.statusError, false);
});

test('a fantasy league with pick\'em on carries both; a bye week carries matchup null', async (t) => {
  world(t, {
    leagues: [LEAGUES.fantasy],
    matchups: MATCHUPS.filter((m) => m.id !== 912),
    overrides: [[/FROM "pickem_settings"/, () => ({ rows: [{ league_id: 71, enabled: true }] })]],
  });
  const res = await request(app).get('/api/league?include=status').set('Authorization', authed());
  const { status } = res.body[0];
  assert.equal(status.matchup, null);
  assert.deepEqual(status.pickem, { made: 0, total: 2, nextLockAt: '2026-10-04T17:00:00.000Z' });
  assert.deepEqual(status.record, { wins: 2, losses: 1, ties: 0 });
});

test('a league whose status fails reads status null and statusError true; the rest of the list still answers', async (t) => {
  world(t, {
    overrides: [[/FROM "nfl_games" JOIN unnest/, () => { throw new Error('schedule read failed'); }]],
  });
  const res = await request(app).get('/api/league?include=status').set('Authorization', authed());
  assert.equal(res.status, 200);
  const fantasy = res.body.find((l) => l.id === 71);
  assert.equal(fantasy.status, null);
  assert.equal(fantasy.statusError, true);
  assert.equal(fantasy.name, 'Winsconsota');
  assert.equal(res.body.find((l) => l.id === 72).statusError, false);
  assert.equal(res.body.find((l) => l.id === 73).status.phase, 'pre-draft');
});

test('status reads are batched: the query count does not grow with the number of leagues', async (t) => {
  const many = Array.from({ length: 10 }, (_, i) => ({ ...LEAGUES.fantasy, id: 100 + i, my_team_id: 11 }));
  const one = world(t, { leagues: [LEAGUES.fantasy] });
  await request(app).get('/api/league?include=status').set('Authorization', authed());
  const oneCount = one.calls.length;
  t.mock.restoreAll();
  const ten = world(t, { leagues: many });
  await request(app).get('/api/league?include=status').set('Authorization', authed());
  assert.equal(ten.calls.length, oneCount);
  // Every read of league data is scoped to the caller (the schedule and
  // slate reads are public NFL facts and carry no user).
  for (const call of ten.calls.filter((c) => /"(teams|matchups|lineup_entries|pickem_picks|pickem_settings)"/.test(c.text))) {
    assert.ok(call.params.includes(USER_ID), call.text);
  }
});
