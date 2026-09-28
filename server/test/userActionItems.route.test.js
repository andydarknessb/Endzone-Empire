const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const userRouter = require('../routes/user.router');
const clock = require('../modules/clock');

/**
 * GET /api/user/action-items (Home v2, contract A): the caller's to-do list
 * across every league they belong to. Eight item types, each built from a
 * read the app already runs, ordered blocking > timed > untimed > info
 * (deadline ascending, then newest first), capped at 20 with the true
 * total, and a `partial` list naming any type whose builder threw. Driven
 * through the real route over the fake pool at a pinned instant.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'user-action-items-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/user', userRouter);

const USER_ID = 7;
const authed = () => `Bearer ${signToken({ id: USER_ID, username: 'member' })}`;
// Sunday of week 4, 11:00 in Chicago.
const NOW = '2026-10-04T16:00:00.000Z';

const base = {
  pickem_only: false, best_ball: false, draft_status: 'complete', season_status: 'regular',
  current_season: 2026, current_week: 4, max_teams: 12, draft_date: null, draft_timezone: null,
  join_approval: false, is_owner: false, is_commissioner: false, team_count: 12,
  roster_slots: [{ key: 'QB', count: 1 }, { key: 'FLEX', count: 1 }],
};
const LEAGUES = {
  fantasy: { ...base, id: 71, name: 'Winsconsota', my_team_id: 11 },
  pickem: { ...base, id: 72, name: 'Office Pool', pickem_only: true, draft_status: 'pending', my_team_id: 21 },
  preDraft: {
    ...base, id: 73, name: 'Draft Soon', draft_status: 'pending', current_week: 1, my_team_id: 31,
    team_count: 9, draft_date: '2026-10-11T00:00:00.000Z', draft_timezone: 'America/Chicago',
    join_approval: true, is_owner: true, is_commissioner: true,
  },
  drafting: { ...base, id: 74, name: 'Live Now', draft_status: 'active', current_week: 1, my_team_id: 41 },
};

const LINEUP_ROWS = [
  { team_id: 11, slot: 'QB', name: 'Quarterback', injury_status: null, ir_attested: false, nfl_team: 'KC', on_bye: false },
];
const KICKOFF_ROWS = [
  { season: 2026, week: 4, nfl_team: 'KC', kickoff_at: '2026-10-04T17:00:00.000Z' },
  { season: 2026, week: 4, nfl_team: 'LV', kickoff_at: '2026-10-04T17:00:00.000Z' },
  { season: 2026, week: 4, nfl_team: 'GB', kickoff_at: '2026-10-05T00:20:00.000Z' },
  { season: 2026, week: 4, nfl_team: 'MIN', kickoff_at: '2026-10-05T00:20:00.000Z' },
];
const SLATE_ROWS = [
  { week: 4, nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-04T17:00:00.000Z', game_key: 'g1', roof: null, home_away: 'home' },
  { week: 4, nfl_team: 'LV', opponent: 'KC', kickoff_at: '2026-10-04T17:00:00.000Z', game_key: 'g1', roof: null, home_away: 'away' },
  { week: 4, nfl_team: 'GB', opponent: 'MIN', kickoff_at: '2026-10-05T00:20:00.000Z', game_key: 'g2', roof: null, home_away: 'home' },
  { week: 4, nfl_team: 'MIN', opponent: 'GB', kickoff_at: '2026-10-05T00:20:00.000Z', game_key: 'g2', roof: null, home_away: 'away' },
];
const TRADE_ROWS = [
  {
    id: 501, league_id: 71, status: 'pending', review_ends_at: null, created_at: '2026-10-04T15:48:00.000Z',
    proposing_team_name: 'Frozen Tundra FC', receiving_team_name: 'Cheese Curds',
  },
  {
    id: 502, league_id: 71, status: 'accepted', review_ends_at: '2026-10-05T12:00:00.000Z', created_at: '2026-10-03T12:00:00.000Z',
    proposing_team_name: 'Lake Effect', receiving_team_name: 'Supper Club',
  },
];
const JOIN_ROWS = [
  { league_id: 73, pending: 2, newest_at: '2026-10-04T09:00:00.000Z', team_names: ['Late Arrivals', 'Walk Ons'] },
];
const WAIVER_ROWS = [
  { league_id: 71, pending: 2, next_clear_at: '2026-10-07T08:00:00.000Z', newest_at: '2026-10-04T14:00:00.000Z' },
];

function world(t, { leagues = Object.values(LEAGUES), overrides = [], lineupRows = LINEUP_ROWS, trades = TRADE_ROWS } = {}) {
  t.mock.method(clock, 'now', () => new Date(NOW));
  const fake = createFakePool([
    ...overrides,
    [/AS "is_commissioner" FROM "leagues"/, () => ({ rows: leagues.map((l) => ({ ...l })) })],
    [/FROM "source"/, () => ({ rows: lineupRows })],
    [/FROM "nfl_games" JOIN unnest/, () => ({ rows: KICKOFF_ROWS })],
    [/FROM "pickem_settings"/, () => ({ rows: [] })],
    [/fn_normalize_nfl_team\("opponent"\)/, () => ({ rows: SLATE_ROWS })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "pickem_picks"/, () => ({ rows: [{ league_id: 72, team_pair: 'KC|LV' }] })],
    [/FROM "trades"/, () => ({ rows: trades })],
    [/FROM "join_requests"/, () => ({ rows: JOIN_ROWS })],
    [/FROM "waiver_claims"/, () => ({ rows: WAIVER_ROWS })],
  ]);
  fake.install(t);
  return fake;
}

// get() asks in Chicago; get(undefined) sends no tz at all.
const get = (...args) => {
  const tz = args.length ? args[0] : 'America/Chicago';
  const req = request(app).get('/api/user/action-items').set('Authorization', authed());
  return tz === undefined ? req : req.query({ tz });
};

test('every item type, in severity order and by deadline within a tier', async (t) => {
  world(t);
  const res = await get();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.generatedAt, NOW);
  assert.deepEqual(res.body.partial, []);
  assert.deepEqual(res.body.items.map((i) => i.id), [
    'draft_live:74',
    'lineup_problem:71:2026-4',
    'picks_open:72:2026-4',
    'trade_review:71:502',
    'seats_open:73',
    'trade_offer:71:501',
    'join_requests:73',
    'waiver_claims:71',
  ]);
  assert.deepEqual(res.body.items.map((i) => i.severity), [
    'blocking', 'timed', 'timed', 'timed', 'timed', 'untimed', 'untimed', 'info',
  ]);
  assert.equal(res.body.counts.total, 8);
});

test('each item carries its league, copy, deadline, call to action and progress', async (t) => {
  world(t);
  const { body } = await get();
  const byType = new Map(body.items.map((i) => [i.type, i]));
  assert.deepEqual(byType.get('lineup_problem'), {
    id: 'lineup_problem:71:2026-4',
    type: 'lineup_problem',
    leagueId: 71,
    leagueName: 'Winsconsota',
    title: 'Fill your empty FLEX slot',
    detail: '1 empty FLEX slot',
    severity: 'timed',
    deadlineAt: '2026-10-04T17:00:00.000Z',
    cta: { label: 'Fix lineup', to: '/league/71/lineup' },
    progress: null,
  });
  assert.deepEqual(byType.get('picks_open').progress, { done: 1, total: 2 });
  assert.equal(byType.get('picks_open').deadlineAt, '2026-10-05T00:20:00.000Z');
  assert.equal(byType.get('picks_open').cta.to, '/league/72/pickem');
  assert.equal(byType.get('draft_live').deadlineAt, NOW);
  assert.equal(byType.get('draft_live').cta.to, '/league/74/draft');
  assert.equal(byType.get('trade_review').deadlineAt, '2026-10-05T12:00:00.000Z');
  assert.equal(byType.get('trade_review').cta.to, '/league/71/trades');
  assert.deepEqual(byType.get('seats_open').progress, { done: 9, total: 12 });
  assert.equal(byType.get('seats_open').deadlineAt, '2026-10-11T00:00:00.000Z');
  assert.equal(byType.get('seats_open').cta.to, '/league/73');
  // Offers have no expiry column: untimed, no deadline.
  assert.equal(byType.get('trade_offer').deadlineAt, null);
  assert.match(byType.get('trade_offer').title, /Frozen Tundra FC/);
  assert.equal(byType.get('join_requests').deadlineAt, null);
  assert.match(byType.get('join_requests').title, /^2 join requests/);
  assert.equal(byType.get('waiver_claims').deadlineAt, '2026-10-07T08:00:00.000Z');
  assert.equal(byType.get('waiver_claims').cta.to, '/league/71/waivers');
  // No em-dash in any user-facing string (house style).
  for (const item of body.items) {
    for (const text of [item.title, item.detail, item.cta.label]) assert.doesNotMatch(String(text), /—/);
  }
});

test('dueToday counts deadlines on today\'s date in the caller\'s zone', async (t) => {
  world(t);
  // In Chicago it is 11:00 on the 4th: the draft (now), the 12:00 lineup lock
  // and the 19:20 pick'em lock are all today.
  assert.equal((await get('America/Chicago')).body.counts.dueToday, 3);
  // In UTC the 00:20Z pick'em lock is already tomorrow.
  assert.equal((await get('UTC')).body.counts.dueToday, 2);
});

test('not shown: best ball starters, a league without pick\'em, seats for a non-commissioner', async (t) => {
  world(t, {
    leagues: [
      { ...LEAGUES.fantasy, best_ball: true },
      { ...LEAGUES.preDraft, is_owner: false, is_commissioner: false },
    ],
    trades: [],
  });
  const { body } = await get();
  // Best ball: an empty FLEX is the optimizer's, not a to-do; the fantasy
  // league has no pick'em; a member neither fills seats nor answers join
  // requests (even if a row came back, the builder only reads leagues the
  // caller runs).
  assert.deepEqual(body.items.map((i) => i.type), ['waiver_claims']);
});

test('the list is capped at 20 items; counts.total is the true number', async (t) => {
  const offers = Array.from({ length: 25 }, (_, i) => ({
    ...TRADE_ROWS[0], id: 600 + i, created_at: new Date(Date.parse(NOW) - i * 60000).toISOString(),
  }));
  world(t, { trades: offers });
  const { body } = await get();
  assert.equal(body.items.length, 20);
  assert.equal(body.counts.total, 31);
  // Untimed offers sort newest first among themselves.
  const offerIds = body.items.filter((i) => i.type === 'trade_offer').map((i) => i.id);
  assert.equal(offerIds[0], 'trade_offer:71:600');
});

test('a builder that throws is named in partial and every other item still returns', async (t) => {
  world(t, { overrides: [[/FROM "waiver_claims"/, () => { throw new Error('waivers down'); }]] });
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.partial, ['waiver_claims']);
  assert.equal(res.body.items.length, 7);
  assert.equal(res.body.items.some((i) => i.type === 'waiver_claims'), false);
});

test('tz is required and must be a real IANA zone', async (t) => {
  world(t);
  for (const tz of ['Mars/Olympus_Mons', undefined]) {
    const res = await get(tz);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'tz must be a valid IANA time zone' });
  }
});

test('reads are batched and scoped: the query count is the same for 1 league and 10', async (t) => {
  // A commissioner league with join approval and pick'em on, so every read
  // runs (the slate included).
  const run = { ...LEAGUES.fantasy, is_commissioner: true, join_approval: true };
  const pickemOn = [/FROM "pickem_settings"/, (text, params) => ({
    rows: params[1].map((id) => ({ league_id: id, enabled: true })),
  })];
  const many = Array.from({ length: 10 }, (_, i) => ({ ...run, id: 100 + i, my_team_id: 200 + i }));
  const one = world(t, { leagues: [run], overrides: [pickemOn] });
  await get();
  const oneCount = one.calls.length;
  t.mock.restoreAll();
  const ten = world(t, { leagues: many, overrides: [pickemOn] });
  await get();
  assert.equal(ten.calls.length, oneCount);
  // leagues, lineups, kickoffs, pick'em settings, the slate (games + live),
  // picks, trades, join requests, waiver claims.
  assert.equal(oneCount, 10);
  for (const call of ten.calls.filter((c) => /"(teams|trades|join_requests|waiver_claims|lineup_entries|pickem_picks|pickem_settings)"/.test(c.text))) {
    assert.ok(call.params.includes(USER_ID), call.text);
  }
  // Join requests only for leagues the caller runs.
  assert.match(ten.matching(/FROM "join_requests"/)[0].text, /"league_commissioners"/);
});
